import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id } from "./common";
import { tenantId } from "./tenants";

/**
 * Append-only audit log (plan §6.4 "audit log immutability"). Migration 0001
 * grants app_user INSERT/SELECT only on this table, never UPDATE/DELETE.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    tenantId: tenantId(),
    /** 'user:<uuid>' | 'system' | 'integration:<id>' */
    actor: text("actor").notNull(),
    /** created | updated | confirmed | posted | rejected | alias_learned | ... */
    action: text("action").notNull(),
    /** Table / aggregate name, e.g. 'order', 'item', 'alias'. */
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_tenant_entity_idx").on(t.tenantId, t.entity, t.entityId),
    index("events_tenant_at_idx").on(t.tenantId, t.at),
  ],
);
