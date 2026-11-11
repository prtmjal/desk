import { index, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, updatedAt } from "./common";

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  /** URL-safe handle, also used for the per-tenant inbound address (orders+slug@...). */
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("trial"),
  status: text("status").notNull().default("active"),
  ...timestamps(),
});

/** `tenant_id uuid not null references tenants(id)` for every tenant-scoped table. */
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

/** Feature flags and per-tenant knobs (plan §7.3 #6). Kept loose on purpose. */
export type TenantSettings = {
  /** Master switch for auto-posting (plan §6.2 rules engine). Default off. */
  autoPost?: boolean;
  /** Shadow mode: evaluate everything, post nothing (plan §6.6). Default on for new tenants. */
  shadowMode?: boolean;
  /** Minimum line match score for auto-post (0..1). */
  autoPostThreshold?: number;
  /** Allowed |PO price - list price| in percent before a line is flagged. */
  priceTolerancePct?: number;
  /** Treat short stock as a blocking error instead of a backorder warning. */
  holdOnStockShort?: boolean;
  /** Send the customer acknowledgment email after posting. */
  ackEnabled?: boolean;
  /** Send it without a human click when the order was touchless. */
  ackAutoSend?: boolean;
  ackSubject?: string;
  ackBody?: string;
  /** Reply-to address printed on acknowledgments. */
  ackReplyTo?: string;
  /** Recipients of the weekly digest. */
  digestRecipients?: string[];
  /** Minutes of manual entry one order replaces; drives "time saved". */
  minutesPerOrder?: number;
  modules?: Record<string, boolean>;
  [key: string]: unknown;
};

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    settings: jsonb("settings").$type<TenantSettings>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [index("tenant_settings_tenant_idx").on(t.tenantId)],
);

/**
 * Global lookup from an external key to a tenant. NOT tenant-scoped and has no RLS,
 * because it is read before a tenant context exists (inbound email address, auth
 * organization, Stripe customer, ERP company id). It holds identifiers only, never
 * tenant data. See docs/DECISIONS.md D-003.
 */
export const tenantRoutes = pgTable(
  "tenant_routes",
  {
    /** auth_org | inbound_slug | stripe_customer | qbo_realm */
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] }), index("tenant_routes_tenant_idx").on(t.tenantId)],
);
