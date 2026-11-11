import { boolean, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { priceLists } from "./pricing";
import { tenantId } from "./tenants";

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    erpId: text("erp_id").notNull(),
    name: text("name").notNull(),
    /** Sender email domains used for deterministic customer identification. */
    domains: text("domains").array().notNull().default([]),
    accountNumber: text("account_number"),
    /** Alternate names / DBAs seen on POs. */
    aka: text("aka").array().notNull().default([]),
    terms: text("terms"),
    priceListId: uuid("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    creditHold: boolean("credit_hold").notNull().default(false),
    active: boolean("active").notNull().default(true),
    extra: jsonb("extra").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => [
    unique("customers_tenant_erp_uq").on(t.tenantId, t.erpId),
    index("customers_tenant_name_idx").on(t.tenantId, t.name),
    index("customers_tenant_account_idx").on(t.tenantId, t.accountNumber),
  ],
);

export type Address = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export const shipTos = pgTable(
  "ship_tos",
  {
    id: id(),
    tenantId: tenantId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    erpId: text("erp_id"),
    name: text("name"),
    address: jsonb("address").$type<Address>().notNull().default({}),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [index("ship_tos_tenant_customer_idx").on(t.tenantId, t.customerId)],
);
