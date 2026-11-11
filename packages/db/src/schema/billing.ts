import { index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { tenantId } from "./tenants";

/** Monthly usage, the basis for the per-order meter in Stripe (plan §8). */
export const usageMeters = pgTable(
  "usage_meters",
  {
    id: id(),
    tenantId: tenantId(),
    /** 'YYYY-MM' */
    period: text("period").notNull(),
    ordersReceived: integer("orders_received").notNull().default(0),
    ordersPosted: integer("orders_posted").notNull().default(0),
    ordersTouchless: integer("orders_touchless").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("usage_meters_tenant_period_uq").on(t.tenantId, t.period)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    tenantId: tenantId(),
    provider: text("provider").notNull().default("stripe"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id").unique(),
    plan: text("plan").notNull(),
    /** trialing | active | past_due | canceled | paused */
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("subscriptions_tenant_idx").on(t.tenantId, t.status)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    tenantId: tenantId(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    providerInvoiceId: text("provider_invoice_id").unique(),
    status: text("status").notNull(),
    currency: text("currency").notNull().default("USD"),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    hostedUrl: text("hosted_url"),
    ...timestamps(),
  },
  (t) => [index("invoices_tenant_issued_idx").on(t.tenantId, t.issuedAt)],
);
