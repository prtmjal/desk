import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/client.js";
import { withItemKeys } from "../src/catalog.js";
import { customers, documents, inboundMessages, items, orders, tenants } from "../src/schema/index.js";
import { createTestDb, type TestContext } from "./pglite.js";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestDb();
  for (const [id, slug] of [
    [TENANT_A, "tenant-a"],
    [TENANT_B, "tenant-b"],
  ] as const) {
    // Tenant creation itself goes through withTenant: WITH CHECK only allows id = app.tenant_id.
    await withTenant(ctx.db, id, (tx) => tx.insert(tenants).values({ id, name: slug, slug }));
  }
});

afterAll(async () => {
  await ctx?.close();
});

describe("row-level security", () => {
  it("applies the migrations with pg_trgm (pgvector optional)", async () => {
    const ext = await ctx.client.query<{ extname: string }>("select extname from pg_extension order by 1");
    expect(ext.rows.map((r) => r.extname)).toContain("pg_trgm");
    const rls = await ctx.client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
       where relkind = 'r' and relnamespace = 'public'::regnamespace order by 1`,
    );
    const byName = Object.fromEntries(rls.rows.map((r) => [r.relname, r]));
    for (const t of ["tenants", "items", "customers", "orders", "order_lines", "aliases", "events", "memberships", "tenant_settings"]) {
      expect(byName[t]?.relrowsecurity, `${t} rls enabled`).toBe(true);
      expect(byName[t]?.relforcerowsecurity, `${t} rls forced`).toBe(true);
    }
    expect(byName["users"]?.relrowsecurity).toBe(false);
    expect(byName["waitlist"]?.relrowsecurity).toBe(false);
  });

  it("(a) tenant A's items, customers and orders are invisible to tenant B", async () => {
    await withTenant(ctx.db, TENANT_A, async (tx) => {
      await tx.insert(items).values(
        withItemKeys({ tenantId: TENANT_A, sku: "A-100", description: "Tenant A widget", upc: "0001" }),
      );
      const [cust] = await tx
        .insert(customers)
        .values({ tenantId: TENANT_A, erpId: "C1", name: "A Customer", domains: ["a.example"] })
        .returning({ id: customers.id });
      await tx.insert(orders).values({ tenantId: TENANT_A, customerId: cust!.id, poNumber: "PO-1", status: "new" });
    });

    const seenByA = await withTenant(ctx.db, TENANT_A, async (tx) => ({
      items: await tx.select().from(items),
      customers: await tx.select().from(customers),
      orders: await tx.select().from(orders),
      tenants: await tx.select().from(tenants),
    }));
    expect(seenByA.items).toHaveLength(1);
    expect(seenByA.customers).toHaveLength(1);
    expect(seenByA.orders).toHaveLength(1);
    expect(seenByA.tenants.map((t) => t.id)).toEqual([TENANT_A]);

    const seenByB = await withTenant(ctx.db, TENANT_B, async (tx) => ({
      items: await tx.select().from(items),
      customers: await tx.select().from(customers),
      orders: await tx.select().from(orders),
      tenants: await tx.select().from(tenants),
    }));
    expect(seenByB.items).toHaveLength(0);
    expect(seenByB.customers).toHaveLength(0);
    expect(seenByB.orders).toHaveLength(0);
    expect(seenByB.tenants.map((t) => t.id)).toEqual([TENANT_B]);

    // Updates/deletes from B cannot touch A's rows either (RLS filters them out).
    const deleted = await withTenant(ctx.db, TENANT_B, (tx) => tx.delete(items).returning({ id: items.id }));
    expect(deleted).toHaveLength(0);
  });

  it("(b) rejects an insert whose tenant_id does not match the session tenant", async () => {
    await expect(
      withTenant(ctx.db, TENANT_A, (tx) =>
        tx.insert(items).values(withItemKeys({ tenantId: TENANT_B, sku: "SNEAKY", description: "cross-tenant write" })),
      ),
    ).rejects.toThrow(/row-level security/i);

    // Nothing landed for either tenant.
    const bItems = await withTenant(ctx.db, TENANT_B, (tx) => tx.select().from(items));
    expect(bItems).toHaveLength(0);
  });

  it("(c) shows zero rows when the role is set but no tenant context exists", async () => {
    const rows = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      const setting = await tx.execute(sql`select current_setting('app.tenant_id', true) as v`);
      return {
        setting: (setting.rows[0] as { v: string | null }).v,
        items: await tx.select().from(items),
        tenants: await tx.select().from(tenants),
        customers: await tx.select().from(customers),
      };
    });
    expect(rows.setting === null || rows.setting === "").toBe(true);
    expect(rows.items).toHaveLength(0);
    expect(rows.tenants).toHaveLength(0);
    expect(rows.customers).toHaveLength(0);
  });

  it("superuser without SET ROLE bypasses RLS (which is why withTenant switches role)", async () => {
    const all = await ctx.db.select().from(tenants);
    expect(all.length).toBe(2);
  });

  it("rejects an invalid tenant id before touching the database", async () => {
    await expect(withTenant(ctx.db, "not-a-uuid", async () => 1)).rejects.toThrow(/UUID/);
    await expect(withTenant(ctx.db, "'; drop table items; --", async () => 1)).rejects.toThrow(/UUID/);
  });
});

describe("idempotency constraints", () => {
  it("(d) rejects duplicate (tenant, sku) but allows the same sku in another tenant", async () => {
    await expect(
      withTenant(ctx.db, TENANT_A, (tx) =>
        tx.insert(items).values(withItemKeys({ tenantId: TENANT_A, sku: "A-100", description: "dupe" })),
      ),
    ).rejects.toThrow(/items_tenant_sku_uq|duplicate key/i);

    await withTenant(ctx.db, TENANT_B, (tx) =>
      tx.insert(items).values(withItemKeys({ tenantId: TENANT_B, sku: "A-100", description: "B's own A-100" })),
    );
    const bItems = await withTenant(ctx.db, TENANT_B, (tx) => tx.select().from(items));
    expect(bItems.map((i) => i.sku)).toEqual(["A-100"]);
  });

  it("(d) rejects duplicate (tenant, message_id) and (tenant, hash)", async () => {
    await withTenant(ctx.db, TENANT_A, async (tx) => {
      const [msg] = await tx
        .insert(inboundMessages)
        .values({ tenantId: TENANT_A, messageId: "<m1@example.com>", fromAddress: "buyer@a.example" })
        .returning({ id: inboundMessages.id });
      await tx.insert(documents).values({ tenantId: TENANT_A, messageId: msg!.id, filename: "po.pdf", hash: "deadbeef" });
    });

    await expect(
      withTenant(ctx.db, TENANT_A, (tx) =>
        tx.insert(inboundMessages).values({ tenantId: TENANT_A, messageId: "<m1@example.com>" }),
      ),
    ).rejects.toThrow(/inbound_messages_tenant_message_uq|duplicate key/i);

    await expect(
      withTenant(ctx.db, TENANT_A, (tx) =>
        tx.insert(documents).values({ tenantId: TENANT_A, filename: "po-again.pdf", hash: "deadbeef" }),
      ),
    ).rejects.toThrow(/documents_tenant_hash_uq|duplicate key/i);

    // Same message id for tenant B is fine.
    await withTenant(ctx.db, TENANT_B, (tx) =>
      tx.insert(inboundMessages).values({ tenantId: TENANT_B, messageId: "<m1@example.com>" }),
    );
  });

  it("detects a duplicate PO per customer unless the earlier order was rejected", async () => {
    const custId = await withTenant(ctx.db, TENANT_A, async (tx) => {
      const [c] = await tx.select({ id: customers.id }).from(customers);
      return c!.id;
    });

    await expect(
      withTenant(ctx.db, TENANT_A, (tx) =>
        tx.insert(orders).values({ tenantId: TENANT_A, customerId: custId, poNumber: "PO-1", status: "needs_review" }),
      ),
    ).rejects.toThrow(/orders_tenant_customer_po_uq|duplicate key/i);

    await withTenant(ctx.db, TENANT_A, async (tx) => {
      await tx.update(orders).set({ status: "rejected" });
      await tx.insert(orders).values({ tenantId: TENANT_A, customerId: custId, poNumber: "PO-1", status: "new" });
      const all = await tx.select({ status: orders.status }).from(orders);
      expect(all.map((o) => o.status).sort()).toEqual(["new", "rejected"]);
    });
  });
});
