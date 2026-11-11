import { index, integer, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { customers } from "./customers";
import { items } from "./items";
import { orderLines } from "./orders";
import { tenantId } from "./tenants";

/**
 * Learned per-customer part-number / description aliases (plan §4.5 moat #1, L1 in §6.6).
 * Keys are normalized by @desk/core (`normalizePartNumber`, `normalizeDescription`).
 */
export const aliases = pgTable(
  "aliases",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    rawPartKey: text("raw_part_key"),
    rawDescriptionKey: text("raw_description_key"),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    uomFactor: numeric("uom_factor", { precision: 14, scale: 4 }),
    hits: integer("hits").notNull().default(1),
    createdFromOrderLineId: uuid("created_from_order_line_id").references(() => orderLines.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    index("aliases_tenant_customer_part_idx").on(t.tenantId, t.customerId, t.rawPartKey),
    index("aliases_tenant_customer_desc_idx").on(t.tenantId, t.customerId, t.rawDescriptionKey),
    // NULLS NOT DISTINCT so learnAlias can upsert on (part|desc) -> item; PG15+.
    unique("aliases_tenant_customer_keys_item_uq")
      .on(t.tenantId, t.customerId, t.rawPartKey, t.rawDescriptionKey, t.itemId)
      .nullsNotDistinct(),
  ],
);
