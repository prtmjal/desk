import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common.js";
import { tenantId } from "./tenants.js";

/** ERP / email / storage connections. Secrets live in a vault; we store only a reference. */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    tenantId: tenantId(),
    /** quickbooks | netsuite | acumatica | odoo | csv | postmark_inbound | ... */
    type: text("type").notNull(),
    name: text("name"),
    /** Opaque key into the secrets vault, never the credential itself. */
    credentialsRef: text("credentials_ref"),
    /** pending | connected | error | disabled */
    status: text("status").notNull().default("pending"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...timestamps(),
  },
  (t) => [index("integrations_tenant_idx").on(t.tenantId, t.type)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    tenantId: tenantId(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    /** items | customers | prices | stock | full */
    kind: text("kind").notNull(),
    /** running | succeeded | failed */
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsChanged: integer("records_changed").notNull().default(0),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    error: text("error"),
  },
  (t) => [index("sync_runs_tenant_idx").on(t.tenantId, t.integrationId, t.startedAt)],
);
