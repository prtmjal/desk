import { boolean, date, index, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { items } from "./items.js";
import { tenantId } from "./tenants.js";

export const priceLists = pgTable(
  "price_lists",
  {
    id: id(),
    tenantId: tenantId(),
    erpId: text("erp_id"),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("price_lists_tenant_idx").on(t.tenantId),
    unique("price_lists_tenant_erp_uq").on(t.tenantId, t.erpId),
  ],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    id: id(),
    tenantId: tenantId(),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** Selling UoM the price applies to; null = item base UoM. */
    uom: text("uom"),
    price: numeric("price", { precision: 14, scale: 4 }).notNull(),
    minQty: numeric("min_qty", { precision: 14, scale: 4 }),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    ...timestamps(),
  },
  (t) => [index("price_list_items_tenant_idx").on(t.tenantId, t.priceListId, t.itemId)],
);
