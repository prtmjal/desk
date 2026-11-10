import "server-only";
import Stripe from "stripe";
import { invoices, subscriptions, tenants, withTenant, type Db } from "@desk/db";
import { ensureTenant, resolveRoute, routeKeyFor, setRoute, type ServiceDeps, type UsageReporter } from "@desk/service";
import { desc, eq } from "drizzle-orm";
import { appUrl, isStripeConfigured } from "@/lib/env";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!isStripeConfigured()) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY)");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY as string);
  return client;
}

/** Price ids for the §8.2 price card. Each plan = a flat platform price + a metered overage price. */
export const PLAN_PRICES = {
  starter: () => ({ platform: process.env.STRIPE_PRICE_STARTER, overage: process.env.STRIPE_PRICE_STARTER_OVERAGE }),
  growth: () => ({ platform: process.env.STRIPE_PRICE_GROWTH, overage: process.env.STRIPE_PRICE_GROWTH_OVERAGE }),
  scale: () => ({ platform: process.env.STRIPE_PRICE_SCALE, overage: process.env.STRIPE_PRICE_SCALE_OVERAGE }),
} as const;
export type PlanKey = keyof typeof PLAN_PRICES;

/** Stripe Billing meter event name; the meter aggregates `value` per customer per period. */
export const METER_EVENT = () => process.env.STRIPE_METER_EVENT || "desk_order_posted";

export function stripeCustomerId(db: Db, tenantId: string): Promise<string | null> {
  return routeKeyFor(db, tenantId, "stripe_customer");
}

/**
 * Usage metering (plan §8.1): one meter event per order that reached the ERP, never for
 * failed or rejected documents. `identifier` makes the event idempotent on the order id.
 */
export function stripeUsageReporter(db: Db): UsageReporter | null {
  if (!isStripeConfigured()) return null;
  return {
    async orderPosted({ tenantId, orderId, at }) {
      const customer = await stripeCustomerId(db, tenantId);
      if (!customer) return;
      await stripe().billing.meterEvents.create({
        event_name: METER_EVENT(),
        identifier: `order-${orderId}`,
        timestamp: Math.floor(at.getTime() / 1000),
        payload: { stripe_customer_id: customer, value: "1" },
      });
    },
  };
}

// ---- Checkout, portal and webhook sync --------------------------------------------------


/** One Stripe customer per tenant, found through tenant_routes. Creates it on first use. */
export async function ensureStripeCustomer(deps: Pick<ServiceDeps, "db">, tenantId: string, hint: { name: string; email?: string | null }): Promise<string> {
  const existing = await routeKeyFor(deps.db, tenantId, "stripe_customer");
  if (existing) return existing;
  const customer = await stripe().customers.create({ name: hint.name, email: hint.email ?? undefined, metadata: { tenantId } }, { idempotencyKey: `desk-tenant-${tenantId}` });
  await setRoute(deps.db, tenantId, "stripe_customer", customer.id);
  return customer.id;
}

export function configuredPlans(): PlanKey[] {
  return (Object.keys(PLAN_PRICES) as PlanKey[]).filter((k) => PLAN_PRICES[k]().platform);
}

export async function createCheckoutUrl(deps: Pick<ServiceDeps, "db">, tenantId: string, plan: PlanKey, hint: { name: string; email?: string | null }): Promise<string> {
  const prices = PLAN_PRICES[plan]();
  if (!prices.platform) throw new Error(`No Stripe price is configured for the ${plan} plan`);
  const customer = await ensureStripeCustomer(deps, tenantId, hint);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    // Platform fee plus the metered per-order overage price (plan §8.2 hybrid pricing).
    line_items: [{ price: prices.platform, quantity: 1 }, ...(prices.overage ? [{ price: prices.overage }] : [])],
    subscription_data: { metadata: { tenantId, plan } },
    success_url: `${appUrl()}/app/settings?billing=success#billing`,
    cancel_url: `${appUrl()}/app/settings?billing=cancelled#billing`,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

export async function createPortalUrl(deps: Pick<ServiceDeps, "db">, tenantId: string): Promise<string> {
  const customer = await routeKeyFor(deps.db, tenantId, "stripe_customer");
  if (!customer) throw new Error("There is no billing account yet. Choose a plan first.");
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: `${appUrl()}/app/settings#billing` });
  return session.url;
}

const ts = (s: number | null | undefined) => (typeof s === "number" ? new Date(s * 1000) : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));

async function tenantForCustomer(deps: Pick<ServiceDeps, "db">, customerId: string | null, metaTenantId?: string | null): Promise<string | null> {
  if (customerId) {
    const routed = await resolveRoute(deps.db, "stripe_customer", customerId);
    if (routed) return routed;
  }
  return metaTenantId ?? null;
}

/** Mirror a Stripe subscription into `subscriptions` and the tenant's plan. Idempotent. */
export async function syncSubscription(deps: Pick<ServiceDeps, "db">, sub: Stripe.Subscription): Promise<void> {
  const customerId = idOf(sub.customer);
  const tenantId = await tenantForCustomer(deps, customerId, sub.metadata?.tenantId);
  if (!tenantId) return;
  if (customerId && !(await routeKeyFor(deps.db, tenantId, "stripe_customer"))) await setRoute(deps.db, tenantId, "stripe_customer", customerId);
  // Newer Stripe API versions carry the billing period on the subscription item.
  const item = sub.items?.data?.[0] as unknown as { current_period_start?: number; current_period_end?: number } | undefined;
  const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const plan = sub.metadata?.plan ?? "starter";
  const values = {
    tenantId,
    provider: "stripe",
    providerCustomerId: customerId,
    providerSubscriptionId: sub.id,
    plan,
    status: sub.status,
    currentPeriodStart: ts(item?.current_period_start ?? legacy.current_period_start),
    currentPeriodEnd: ts(item?.current_period_end ?? legacy.current_period_end),
    cancelAt: ts(sub.cancel_at),
  };
  await withTenant(deps.db, tenantId, async (tx) => {
    await tx.insert(subscriptions).values(values).onConflictDoUpdate({ target: subscriptions.providerSubscriptionId, set: { ...values, updatedAt: new Date() } });
    const live = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
    await tx.update(tenants).set({ plan: live ? plan : "trial" }).where(eq(tenants.id, tenantId));
  });
}

export async function syncInvoice(deps: Pick<ServiceDeps, "db">, inv: Stripe.Invoice): Promise<void> {
  const tenantId = await tenantForCustomer(deps, idOf(inv.customer));
  if (!tenantId || !inv.id) return;
  const values = {
    tenantId,
    providerInvoiceId: inv.id,
    status: inv.status ?? "open",
    currency: (inv.currency ?? "usd").toUpperCase(),
    amountDue: (inv.amount_due / 100).toFixed(2),
    amountPaid: (inv.amount_paid / 100).toFixed(2),
    periodStart: ts(inv.period_start),
    periodEnd: ts(inv.period_end),
    issuedAt: ts(inv.status_transitions?.finalized_at ?? inv.created),
    paidAt: ts(inv.status_transitions?.paid_at),
    hostedUrl: inv.hosted_invoice_url ?? null,
  };
  await withTenant(deps.db, tenantId, (tx) => tx.insert(invoices).values(values).onConflictDoUpdate({ target: invoices.providerInvoiceId, set: { ...values, updatedAt: new Date() } }));
}

export async function billingSummary(deps: Pick<ServiceDeps, "db">, tenantId: string) {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
    const recent = await tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.issuedAt)).limit(6);
    return { subscription: sub ?? null, invoices: recent };
  });
}

/** Clerk organization.created → tenant + Stripe customer (plan §7.5 Phase 0). */
export async function provisionOrganization(deps: Pick<ServiceDeps, "db">, org: { id: string; name: string }): Promise<string> {
  const { tenantId } = await ensureTenant(deps.db, { kind: "auth_org", key: org.id, name: org.name });
  if (isStripeConfigured()) await ensureStripeCustomer(deps, tenantId, { name: org.name });
  return tenantId;
}
