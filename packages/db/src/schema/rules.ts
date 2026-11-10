import { boolean, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { customers } from "./customers.js";
import { tenantId } from "./tenants.js";

/** Tenant-wide (customer_id null) or per-customer validation / auto-post rules. */
export const rules = pgTable(
  "rules",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
    /** e.g. auto_post_threshold | require_po_number | block_credit_hold | default_ship_to | uom_override */
    type: text("type").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    priority: integer("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("rules_tenant_customer_idx").on(t.tenantId, t.customerId, t.type)],
);
