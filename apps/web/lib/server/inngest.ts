import "server-only";
import { integrations, tenantRoutes, tenants, withTenant } from "@desk/db";
import { confirmOrder, processMessage, runSync, sendWeeklyDigest, SYSTEM } from "@desk/service";
import { eq } from "drizzle-orm";
import { Inngest } from "inngest";
import { getDeps } from "./deps";

export const inngest = new Inngest({ id: "desk" });

type MessageReceived = { tenantId: string; messageRowId: string };

/** Inbound message → drafts. Retries are safe: receive and process are both idempotent. */
const processInbound = inngest.createFunction(
  { id: "process-inbound-message", retries: 4, concurrency: { limit: 4, key: "event.data.tenantId" }, triggers: [{ event: "desk/message.received" }] },
  async ({ event, step }) => {
    const { tenantId, messageRowId } = event.data as MessageReceived;
    return step.run("process", async () => {
      const r = await processMessage(await getDeps(), tenantId, messageRowId);
      // A model or network failure is worth retrying; an unreadable message is not.
      if (r.status === "failed" && r.error && /timeout|rate|overloaded|ECONN|fetch failed|5\d\d/i.test(r.error)) throw new Error(r.error);
      return r;
    });
  },
);

/** Retry posting of an order that was confirmed while the ERP was unreachable. */
const postOrder = inngest.createFunction(
  { id: "post-confirmed-order", retries: 5, triggers: [{ event: "desk/order.post" }] },
  async ({ event, step }) => {
    const { tenantId, orderId } = event.data as { tenantId: string; orderId: string };
    return step.run("post", async () => {
      const r = await confirmOrder(await getDeps(), tenantId, orderId, SYSTEM);
      if (r.status === "confirmed" && r.error && !r.shadow) throw new Error(r.error);
      return r;
    });
  },
);

async function allTenantIds(): Promise<string[]> {
  const deps = await getDeps();
  // tenant_routes is the global index of tenants (the tenants table itself is RLS-scoped).
  const rows = await deps.db.selectDistinct({ tenantId: tenantRoutes.tenantId }).from(tenantRoutes);
  return rows.map((r) => r.tenantId);
}

/** Hourly: refresh items, customers, prices and stock for every connected ERP. */
const scheduledSync = inngest.createFunction({ id: "scheduled-erp-sync", triggers: [{ cron: "7 * * * *" }] }, async ({ step }) => {
  const ids = await step.run("tenants", allTenantIds);
  let synced = 0;
  for (const tenantId of ids) {
    synced += await step.run(`sync-${tenantId}`, async () => {
      const deps = await getDeps();
      const rows = await withTenant(deps.db, tenantId, (tx) => tx.select().from(integrations).where(eq(integrations.status, "connected")));
      let n = 0;
      for (const i of rows.filter((r) => r.type === "quickbooks_online")) {
        try {
          await runSync(deps, tenantId, i.id, SYSTEM);
          n++;
        } catch (err) {
          console.warn(`[desk] scheduled sync failed for tenant ${tenantId}`, err);
        }
      }
      return n;
    });
  }
  return { tenants: ids.length, synced };
});

/** Mondays 13:00 UTC: "you saved 31 hours; touchless 74%" (plan §9.5). */
const weeklyDigest = inngest.createFunction({ id: "weekly-digest", triggers: [{ cron: "0 13 * * 1" }] }, async ({ step }) => {
  const ids = await step.run("tenants", allTenantIds);
  let sent = 0;
  for (const tenantId of ids) {
    sent += await step.run(`digest-${tenantId}`, async () => {
      const deps = await getDeps();
      const active = await withTenant(deps.db, tenantId, async (tx) => (await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId)))[0]?.status === "active");
      return active ? sendWeeklyDigest(deps, tenantId) : 0;
    });
  }
  return { tenants: ids.length, sent };
});

export const functions = [processInbound, postOrder, scheduledSync, weeklyDigest];
