import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { tenantId } from "./tenants";

/**
 * One row per inbound email (or upload session). (tenant_id, message_id) is the
 * idempotency key for at-least-once processing (plan §6.4).
 */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: id(),
    tenantId: tenantId(),
    /** RFC 5322 Message-ID (or provider message id for uploads). */
    messageId: text("message_id").notNull(),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Object-storage key of the raw MIME message. */
    rawRef: text("raw_ref"),
    /** order | quote_request | status_inquiry | remittance | spam | unknown (set by the classifier). */
    classification: text("classification"),
    /** received | processing | processed | ignored | failed */
    status: text("status").notNull().default("received"),
    /** email | upload */
    source: text("source").notNull().default("email"),
    /** Why processing failed or the message was ignored. */
    error: text("error"),
    /** Model cost for this message in USD (plan §6.4 cost budget). */
    costUsd: text("cost_usd"),
    ...timestamps(),
  },
  (t) => [
    unique("inbound_messages_tenant_message_uq").on(t.tenantId, t.messageId),
    index("inbound_messages_tenant_received_idx").on(t.tenantId, t.receivedAt),
  ],
);

/** Attachments / uploaded files. (tenant_id, hash) dedupes the same PO sent twice. */
export const documents = pgTable(
  "documents",
  {
    id: id(),
    tenantId: tenantId(),
    messageId: uuid("message_id").references(() => inboundMessages.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    /** sha256 hex of the file bytes. */
    hash: text("hash").notNull(),
    pages: integer("pages"),
    /** Object-storage key of the OCR / text-extraction output. */
    ocrRef: text("ocr_ref"),
    /** Object-storage key of the original file. */
    storageRef: text("storage_ref"),
    ...timestamps(),
  },
  (t) => [
    unique("documents_tenant_hash_uq").on(t.tenantId, t.hash),
    index("documents_tenant_message_idx").on(t.tenantId, t.messageId),
  ],
);
