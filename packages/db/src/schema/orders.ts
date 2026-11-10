import type { OrderDraft } from "@desk/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { customers, shipTos } from "./customers";
import { documents, inboundMessages } from "./inbound";
import { items } from "./items";
import { tenantId } from "./tenants";
import { users } from "./users";

export const orderStatus = pgEnum("order_status", ["new", "needs_review", "confirmed", "posted", "rejected"]);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => inboundMessages.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    shipToId: uuid("ship_to_id").references(() => shipTos.id, { onDelete: "set null" }),
    status: orderStatus("status").notNull().default("new"),
    poNumber: text("po_number"),
    orderDate: date("order_date"),
    requestedDate: date("requested_date"),
    currency: text("currency"),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
    tax: numeric("tax", { precision: 14, scale: 2 }),
    shipping: numeric("shipping", { precision: 14, scale: 2 }),
    total: numeric("total", { precision: 14, scale: 2 }),
    /** Overall draft confidence 0..1. */
    confidence: real("confidence"),
    /** The full OrderDraft (plan §7.3 #1): the contract between extraction, matching, UI and connectors. */
    draft: jsonb("draft").$type<OrderDraft>(),
    erpOrderId: text("erp_order_id"),
    erpOrderNumber: text("erp_order_number"),
    erpUrl: text("erp_url"),
    /** Posted by the rules engine with no human action. */
    autoPosted: boolean("auto_posted").notNull().default(false),
    /** Posted without any human edit (the touchless metric, plan §6.4). */
    touchless: boolean("touchless").notNull().default(false),
    /** Shadow mode: the rules engine would have posted this order. */
    shadowEligible: boolean("shadow_eligible").notNull().default(false),
    /** Number of human edits applied in review. */
    editCount: integer("edit_count").notNull().default(0),
    rejectReason: text("reject_reason"),
    /** Last ERP posting error; cleared on success. */
    postError: text("post_error"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("orders_tenant_status_idx").on(t.tenantId, t.status, t.createdAt),
    index("orders_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("orders_tenant_document_idx").on(t.tenantId, t.documentId),
    // Duplicate-PO detection: one live order per (tenant, customer, PO). Rejected orders don't block a resubmission.
    uniqueIndex("orders_tenant_customer_po_uq")
      .on(t.tenantId, t.customerId, t.poNumber)
      // Only confirmed/posted orders hold the PO number: a duplicate may sit in review
      // (flagged DUPLICATE_PO) but can never be confirmed twice (plan §6.4, no duplicate posts).
      .where(sql`${t.status} IN ('confirmed', 'posted') AND ${t.poNumber} IS NOT NULL AND ${t.customerId} IS NOT NULL`),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull().default(0),
    rawText: text("raw_text"),
    rawPartNumber: text("raw_part_number"),
    rawDescription: text("raw_description"),
    qty: numeric("qty", { precision: 14, scale: 4 }),
    rawUom: text("raw_uom"),
    rawPrice: numeric("raw_price", { precision: 14, scale: 4 }),
    matchedItemId: uuid("matched_item_id").references(() => items.id, { onDelete: "set null" }),
    /** MatchMethod from @desk/core: L0_exact | L1_alias | L2_trigram | L3_vector | L4_llm | manual */
    matchMethod: text("match_method"),
    confidence: real("confidence"),
    /** Quantity in the item's base UoM after pack/UoM resolution. */
    qtyBase: numeric("qty_base", { precision: 14, scale: 4 }),
    uomFactor: numeric("uom_factor", { precision: 14, scale: 4 }),
    /** 'auto' or the user id who resolved the line in review. */
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("order_lines_tenant_order_idx").on(t.tenantId, t.orderId, t.lineNo),
    index("order_lines_tenant_item_idx").on(t.tenantId, t.matchedItemId),
  ],
);
