/**
 * What a tenant may do under its plan (plan §8). Only one thing is gated: posting to the ERP.
 * Reading, matching, review and shadow mode always work, so a prospect sees the product's value
 * before paying and a lapsed customer never loses an inbound order.
 */
import { orders, subscriptions, tenants, withTenant } from "@desk/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { ServiceDeps } from "./context";

export type BillingPolicy = {
  /** False when no billing provider is configured: nothing is gated. */
  enforce: boolean;
  /** Orders a tenant may post before choosing a plan. */
  trialPostedLimit: number;
};

export type PostingAllowance = {
  allowed: boolean;
  plan: string;
  /** Present on trial: how many posts are left. */
  trialRemaining: number | null;
  reason: string | null;
};

/** Subscription states that keep posting on. `past_due` is a grace period while Stripe retries the card. */
const LIVE = new Set(["active", "trialing", "past_due"]);

export async function postingAllowance(deps: Pick<ServiceDeps, "db" | "billing">, tenantId: string): Promise<PostingAllowance> {
  const policy = deps.billing;
  return withTenant(deps.db, tenantId, async (tx) => {
    const [t] = await tx.select({ plan: tenants.plan, status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    const plan = t?.plan ?? "trial";
    if (!policy?.enforce) return { allowed: true, plan, trialRemaining: null, reason: null };
    if (t && t.status !== "active") return { allowed: false, plan, trialRemaining: null, reason: "This workspace is suspended. Contact support." };

    const [sub] = await tx.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).orderBy(desc(subscriptions.updatedAt)).limit(1);
    if (sub && LIVE.has(sub.status)) return { allowed: true, plan, trialRemaining: null, reason: null };
    if (sub) return { allowed: false, plan, trialRemaining: null, reason: `Your subscription is ${sub.status.replace(/_/g, " ")}. Update billing in Settings to resume posting; confirmed orders are held, not lost.` };

    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.status, "posted")));
    const remaining = Math.max(0, policy.trialPostedLimit - (c?.n ?? 0));
    return remaining > 0
      ? { allowed: true, plan, trialRemaining: remaining, reason: null }
      : { allowed: false, plan, trialRemaining: 0, reason: `The trial includes ${policy.trialPostedLimit} posted orders and you have used them. Choose a plan in Settings to keep posting; confirmed orders are held, not lost.` };
  });
}
