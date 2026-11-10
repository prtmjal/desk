/** Read models and small admin mutations for the app's list/detail pages. */
import { aliases, customers, events, inboundMessages, integrations, items, orders, PgCatalogIndex, rules, tenantRoutes, withTenant, type Db } from "@desk/db";
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { logEvent, type Actor } from "./audit";
import { ServiceError, type ServiceDeps } from "./context";
import type { RouteKind } from "./tenants";
import type { AutoPostRuleParams } from "./validation";

type D = Pick<ServiceDeps, "db">;

export async function routeKeyFor(db: Db, tenantId: string, kind: RouteKind): Promise<string | null> {
  const [row] = await db.select({ key: tenantRoutes.key }).from(tenantRoutes).where(and(eq(tenantRoutes.kind, kind), eq(tenantRoutes.tenantId, tenantId)));
  return row?.key ?? null;
}

export type ItemListRow = { id: string; sku: string; description: string; upc: string | null; mpn: string | null; uom: string; listPrice: number | null; stockAvailable: number | null; active: boolean; packNote: string | null };

function toItemRow(r: typeof items.$inferSelect): ItemListRow {
  const f = r.pack?.factors ? Object.entries(r.pack.factors).map(([u, n]) => `${u}=${n}`).join(", ") : null;
  const m = r.pack?.multipleOf ? `multiples of ${r.pack.multipleOf}` : null;
  return { id: r.id, sku: r.sku, description: r.description, upc: r.upc, mpn: r.mpn, uom: r.uom, listPrice: r.listPrice === null ? null : Number(r.listPrice), stockAvailable: r.stockAvailable === null ? null : Number(r.stockAvailable), active: r.active, packNote: [f, m].filter(Boolean).join("; ") || null };
}

export async function listItems(deps: D, tenantId: string, opts: { q?: string; limit?: number } = {}): Promise<{ rows: ItemListRow[]; total: number }> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const q = opts.q?.trim();
    const where = and(eq(items.tenantId, tenantId), q ? or(ilike(items.sku, `%${q}%`), ilike(items.description, `%${q}%`), ilike(items.mpn, `%${q}%`), ilike(items.upc, `%${q}%`)) : undefined);
    const rows = await tx.select().from(items).where(where).orderBy(asc(items.sku)).limit(opts.limit ?? 200);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.tenantId, tenantId));
    return { rows: rows.map(toItemRow), total: c?.n ?? 0 };
  });
}

/** Typeahead for "pick the right item" in review: exact identifiers first, then trigram similarity. */
export async function searchItems(deps: D, tenantId: string, query: string, limit = 8): Promise<Array<{ id: string; sku: string; description: string; listPrice: number | null; score: number }>> {
  const q = query.trim();
  if (q.length < 2) return [];
  return withTenant(deps.db, tenantId, async (tx) => {
    const direct = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.active, true), or(ilike(items.sku, `%${q}%`), ilike(items.mpn, `%${q}%`), ilike(items.upc, `${q}%`)))).orderBy(asc(items.sku)).limit(limit);
    const fuzzy = await new PgCatalogIndex(tx, tenantId).trigram(q, limit);
    const out = new Map<string, { id: string; sku: string; description: string; listPrice: number | null; score: number }>();
    for (const r of direct) out.set(r.id, { id: r.id, sku: r.sku, description: r.description, listPrice: r.listPrice === null ? null : Number(r.listPrice), score: 1 });
    for (const s of fuzzy) if (!out.has(s.item.id)) out.set(s.item.id, { id: s.item.id, sku: s.item.sku, description: s.item.description, listPrice: s.item.listPrice ?? null, score: s.score });
    return [...out.values()].slice(0, limit);
  });
}

export async function searchCustomers(deps: D, tenantId: string, query: string, limit = 8): Promise<Array<{ id: string; name: string; accountNumber: string | null }>> {
  const q = query.trim();
  return withTenant(deps.db, tenantId, (tx) =>
    tx
      .select({ id: customers.id, name: customers.name, accountNumber: customers.accountNumber })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.active, true), q ? or(ilike(customers.name, `%${q}%`), ilike(customers.accountNumber, `%${q}%`), sql`${q} ILIKE ANY(${customers.aka})`) : undefined))
      .orderBy(q ? sql`similarity(${customers.name}, ${q}) desc` : asc(customers.name))
      .limit(limit),
  );
}

export type CustomerListRow = { id: string; name: string; accountNumber: string | null; domains: string[]; creditHold: boolean; active: boolean; aliasCount: number; orderCount: number; autoPost: "default" | "on" | "off" };

export async function listCustomers(deps: D, tenantId: string, opts: { q?: string } = {}): Promise<CustomerListRow[]> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const q = opts.q?.trim();
    const rows = await tx
      .select({
        c: customers,
        aliasCount: sql<number>`(select count(*)::int from ${aliases} where ${aliases.customerId} = ${customers.id})`,
        orderCount: sql<number>`(select count(*)::int from ${orders} where ${orders.customerId} = ${customers.id})`,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), q ? or(ilike(customers.name, `%${q}%`), ilike(customers.accountNumber, `%${q}%`)) : undefined))
      .orderBy(asc(customers.name))
      .limit(300);
    const ruleRows = await tx.select().from(rules).where(and(eq(rules.tenantId, tenantId), eq(rules.type, "auto_post")));
    return rows.map(({ c, aliasCount, orderCount }) => {
      const r = ruleRows.find((x) => x.customerId === c.id && x.active);
      const enabled = (r?.params as AutoPostRuleParams | undefined)?.enabled;
      return { id: c.id, name: c.name, accountNumber: c.accountNumber, domains: c.domains, creditHold: c.creditHold, active: c.active, aliasCount, orderCount, autoPost: enabled === undefined ? "default" : enabled ? "on" : "off" };
    });
  });
}

export async function getCustomer(deps: D, tenantId: string, customerId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  return withTenant(deps.db, tenantId, async (tx) => {
    const [customer] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!customer) return null;
    const aliasRows = await tx
      .select({ id: aliases.id, rawPartKey: aliases.rawPartKey, rawDescriptionKey: aliases.rawDescriptionKey, uomFactor: aliases.uomFactor, hits: aliases.hits, updatedAt: aliases.updatedAt, sku: items.sku, description: items.description })
      .from(aliases)
      .innerJoin(items, eq(items.id, aliases.itemId))
      .where(and(eq(aliases.tenantId, tenantId), eq(aliases.customerId, customerId)))
      .orderBy(desc(aliases.hits), desc(aliases.updatedAt));
    const [rule] = await tx.select().from(rules).where(and(eq(rules.tenantId, tenantId), eq(rules.customerId, customerId), eq(rules.type, "auto_post"), eq(rules.active, true)));
    const recent = await tx
      .select({ id: orders.id, status: orders.status, poNumber: orders.poNumber, total: orders.total, createdAt: orders.createdAt, touchless: orders.touchless })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.customerId, customerId)))
      .orderBy(desc(orders.createdAt))
      .limit(20);
    return { customer, aliases: aliasRows, rule: (rule?.params as AutoPostRuleParams | undefined) ?? null, recent };
  });
}

/** Per-customer auto-post rule (plan §6.2). `null` removes the override. */
export async function setCustomerAutoPost(deps: D, tenantId: string, customerId: string, params: AutoPostRuleParams | null, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!c) throw new ServiceError("not_found", "Customer not found");
    const [before] = await tx.select().from(rules).where(and(eq(rules.tenantId, tenantId), eq(rules.customerId, customerId), eq(rules.type, "auto_post")));
    await tx.delete(rules).where(and(eq(rules.tenantId, tenantId), eq(rules.customerId, customerId), eq(rules.type, "auto_post")));
    if (params) await tx.insert(rules).values({ tenantId, customerId, type: "auto_post", params });
    await logEvent(tx, { tenantId, actor, action: "updated", entity: "rule", entityId: customerId, before: before?.params ?? null, after: params });
  });
}

export async function updateCustomer(deps: D, tenantId: string, customerId: string, patch: { domains?: string[]; aka?: string[]; accountNumber?: string | null }, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [before] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
    if (!before) throw new ServiceError("not_found", "Customer not found");
    const clean = (a?: string[]) => (a ? [...new Set(a.map((x) => x.trim()).filter(Boolean))] : undefined);
    const set = { domains: clean(patch.domains)?.map((d) => d.toLowerCase().replace(/^@/, "")), aka: clean(patch.aka), accountNumber: patch.accountNumber === undefined ? undefined : patch.accountNumber?.trim() || null };
    await tx.update(customers).set(set).where(eq(customers.id, customerId));
    await logEvent(tx, { tenantId, actor, action: "updated", entity: "customer", entityId: customerId, before: { domains: before.domains, aka: before.aka, accountNumber: before.accountNumber }, after: set });
  });
}

export async function deleteAlias(deps: D, tenantId: string, aliasId: string, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.delete(aliases).where(and(eq(aliases.tenantId, tenantId), eq(aliases.id, aliasId))).returning();
    if (row) await logEvent(tx, { tenantId, actor, action: "alias_removed", entity: "alias", entityId: aliasId, before: { customerId: row.customerId, rawPartKey: row.rawPartKey, rawDescriptionKey: row.rawDescriptionKey, itemId: row.itemId } });
  });
}

export async function listEvents(deps: D, tenantId: string, opts: { entity?: string; limit?: number; before?: Date } = {}) {
  return withTenant(deps.db, tenantId, (tx) =>
    tx
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), opts.entity ? eq(events.entity, opts.entity) : undefined, opts.before ? sql`${events.at} < ${opts.before}` : undefined))
      .orderBy(desc(events.at))
      .limit(opts.limit ?? 200),
  );
}

export type OnboardingStatus = { erpConnected: boolean; erpType: string | null; itemCount: number; customerCount: number; messageCount: number; orderCount: number; reviewedCount: number };

/** Where the tenant is on the path to a first draft order (plan §6.3 onboarding). */
export async function onboardingStatus(deps: D, tenantId: string): Promise<OnboardingStatus> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const ints = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.status, "connected")));
    const n = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
    return {
      erpConnected: ints.length > 0,
      erpType: ints[0]?.type ?? null,
      itemCount: await n(tx.select({ n: sql<number>`count(*)::int` }).from(items).where(eq(items.tenantId, tenantId))),
      customerCount: await n(tx.select({ n: sql<number>`count(*)::int` }).from(customers).where(eq(customers.tenantId, tenantId))),
      messageCount: await n(tx.select({ n: sql<number>`count(*)::int` }).from(inboundMessages).where(eq(inboundMessages.tenantId, tenantId))),
      orderCount: await n(tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.tenantId, tenantId))),
      reviewedCount: await n(tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.tenantId, tenantId), sql`${orders.status} in ('confirmed','posted')`))),
    };
  });
}

/** Posted / confirmed orders as one CSV for import into any ERP (the universal fallback, plan §6.2). */
export async function exportOrdersCsv(deps: D, tenantId: string, opts: { since?: Date } = {}): Promise<{ csv: string; count: number }> {
  const { draftToSalesOrderCsv, SALES_ORDER_COLUMNS } = await import("@desk/erp");
  return withTenant(deps.db, tenantId, async (tx) => {
    const rows = await tx
      .select({ order: orders, erpId: customers.erpId })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.tenantId, tenantId), sql`${orders.status} in ('confirmed','posted')`, opts.since ? sql`${orders.reviewedAt} >= ${opts.since}` : undefined))
      .orderBy(asc(orders.reviewedAt));
    const body: string[] = [];
    for (const { order, erpId } of rows) {
      if (!order.draft) continue;
      const draft = { ...order.draft, customer: { ...order.draft.customer, customerId: erpId ?? order.draft.customer.customerId } };
      const text = draftToSalesOrderCsv(draft, order.erpOrderNumber ?? `DESK-${order.id.slice(0, 8).toUpperCase()}`);
      body.push(...text.split("\r\n").slice(1).filter(Boolean));
    }
    return { csv: [SALES_ORDER_COLUMNS.join(","), ...body].join("\r\n") + "\r\n", count: rows.length };
  });
}
