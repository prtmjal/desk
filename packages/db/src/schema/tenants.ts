import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, updatedAt } from "./common.js";

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
  autoPost?: boolean;
  shadowMode?: boolean;
  autoPostThreshold?: number;
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
