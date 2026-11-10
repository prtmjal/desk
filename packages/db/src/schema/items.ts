import type { PackDefinition } from "@desk/core";
import { boolean, index, jsonb, numeric, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, timestamps, vector } from "./common";
import { tenantId } from "./tenants";

/**
 * Item master mirrored from the ERP (plan §6.7).
 *
 * `sku_key` / `upc_key` / `mpn_key` are the L0 exact-match keys: the part number
 * collapsed by `normalizePartNumber` (@desk/core). They are populated in
 * application code on insert/update (see `withItemKeys` in src/catalog.ts).
 */
export const items = pgTable(
  "items",
  {
    id: id(),
    tenantId: tenantId(),
    erpId: text("erp_id"),
    sku: text("sku").notNull(),
    upc: text("upc"),
    mpn: text("mpn"),
    description: text("description").notNull(),
    /** Extra searchable text: long description, brand, category, keywords. */
    extra: text("extra"),
    skuKey: text("sku_key"),
    upcKey: text("upc_key"),
    mpnKey: text("mpn_key"),
    /** Stocking (base) unit of measure in the ERP, e.g. EA. */
    uom: text("uom").notNull().default("EA"),
    /** Selling units in base units, min qty, multiple-of (PackDefinition from @desk/core). */
    pack: jsonb("pack").$type<PackDefinition>().notNull().default({ baseUom: "EA" }),
    listPrice: numeric("list_price", { precision: 14, scale: 4 }),
    active: boolean("active").notNull().default(true),
    /** Available-to-promise in base UoM from the last ERP stock check; null = not tracked. */
    stockAvailable: numeric("stock_available", { precision: 14, scale: 4 }),
    stockCheckedAt: timestamp("stock_checked_at", { withTimezone: true }),
    /** L3 description embedding (plan §6.6). Nullable; populated by a backfill job. */
    embedding: vector("embedding", 1024),
    ...timestamps(),
  },
  (t) => [
    unique("items_tenant_sku_uq").on(t.tenantId, t.sku),
    index("items_tenant_sku_key_idx").on(t.tenantId, t.skuKey),
    index("items_tenant_upc_key_idx").on(t.tenantId, t.upcKey),
    index("items_tenant_mpn_key_idx").on(t.tenantId, t.mpnKey),
    index("items_tenant_erp_idx").on(t.tenantId, t.erpId),
  ],
);
