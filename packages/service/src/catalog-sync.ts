import type { CatalogItem, CustomerRecord } from "@desk/core";
import { customers, integrations, items, priceListItems, priceLists, syncRuns, withItemKeys, withTenant, type Tx } from "@desk/db";
import { ConnectorAuthError, parseCustomersCsv, parseItemsCsv, type ErpConnector, type PriceListEntry } from "@desk/erp";
import { parseCsvRows } from "@desk/extract";
import { and, eq, inArray, sql } from "drizzle-orm";
import { logEvent, type Actor } from "./audit";
import { errorText, nowOf, ServiceError, type ServiceDeps } from "./context";

const BATCH = 400;
const chunks = <T>(arr: T[], n = BATCH): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Mirror ERP items. `CatalogItem.id` is the ERP id; our row id stays stable across syncs (keyed on SKU). */
export async function upsertItems(tx: Tx, tenantId: string, list: CatalogItem[]): Promise<number> {
  const seen = new Set<string>();
  const unique = list.filter((i) => i.sku && !seen.has(i.sku) && seen.add(i.sku));
  for (const part of chunks(unique)) {
    await tx
      .insert(items)
      .values(
        part.map((i) =>
          withItemKeys({
            tenantId,
            erpId: i.id,
            sku: i.sku,
            upc: i.upc ?? null,
            mpn: i.mpn ?? null,
            description: i.description || i.sku,
            extra: i.extra ?? null,
            uom: i.pack?.baseUom ?? "EA",
            pack: i.pack ?? { baseUom: "EA" },
            listPrice: i.listPrice == null ? null : String(i.listPrice),
            active: i.active,
          }),
        ),
      )
      .onConflictDoUpdate({
        target: [items.tenantId, items.sku],
        set: {
          erpId: sql`excluded.erp_id`,
          upc: sql`excluded.upc`,
          mpn: sql`excluded.mpn`,
          description: sql`excluded.description`,
          extra: sql`excluded.extra`,
          skuKey: sql`excluded.sku_key`,
          upcKey: sql`excluded.upc_key`,
          mpnKey: sql`excluded.mpn_key`,
          uom: sql`excluded.uom`,
          pack: sql`excluded.pack`,
          listPrice: sql`excluded.list_price`,
          active: sql`excluded.active`,
          updatedAt: new Date(),
        },
      });
  }
  return unique.length;
}

/** Mirror ERP customers. Domains and alternate names learned in review are kept (set union). */
export async function upsertCustomers(tx: Tx, tenantId: string, list: CustomerRecord[]): Promise<number> {
  const seen = new Set<string>();
  const unique = list.filter((c) => c.id && !seen.has(c.id) && seen.add(c.id));
  for (const part of chunks(unique)) {
    await tx
      .insert(customers)
      .values(
        part.map((c) => ({
          tenantId,
          erpId: c.id,
          name: c.name,
          domains: (c.domains ?? []).map((d) => d.toLowerCase()),
          accountNumber: c.accountNumber ?? null,
          aka: c.aka ?? [],
          creditHold: c.creditHold ?? false,
          active: c.active,
        })),
      )
      .onConflictDoUpdate({
        target: [customers.tenantId, customers.erpId],
        set: {
          name: sql`excluded.name`,
          accountNumber: sql`coalesce(excluded.account_number, ${customers.accountNumber})`,
          domains: sql`(select coalesce(array_agg(distinct d), '{}') from unnest(${customers.domains} || excluded.domains) as d)`,
          aka: sql`(select coalesce(array_agg(distinct a), '{}') from unnest(${customers.aka} || excluded.aka) as a)`,
          creditHold: sql`excluded.credit_hold`,
          active: sql`excluded.active`,
          updatedAt: new Date(),
        },
      });
  }
  return unique.length;
}

/** Price entries: customerId null updates the item list price; otherwise a per-customer contract list. */
export async function applyPrices(tx: Tx, tenantId: string, entries: PriceListEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const itemRows = await tx.select({ id: items.id, erpId: items.erpId }).from(items).where(eq(items.tenantId, tenantId));
  const itemByErp = new Map(itemRows.filter((r) => r.erpId).map((r) => [r.erpId!, r.id]));
  const custRows = await tx.select({ id: customers.id, erpId: customers.erpId, priceListId: customers.priceListId }).from(customers).where(eq(customers.tenantId, tenantId));
  const custByErp = new Map(custRows.map((r) => [r.erpId, r]));
  let applied = 0;
  for (const e of entries) {
    const itemId = itemByErp.get(e.itemId);
    if (!itemId) continue;
    if (e.customerId === null) {
      await tx.update(items).set({ listPrice: String(e.price) }).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId)));
      applied++;
      continue;
    }
    const cust = custByErp.get(e.customerId);
    if (!cust) continue;
    let listId = cust.priceListId;
    if (!listId) {
      const [pl] = await tx
        .insert(priceLists)
        .values({ tenantId, erpId: `customer:${e.customerId}`, name: `Contract prices ${e.customerId}`, currency: e.currency })
        .onConflictDoUpdate({ target: [priceLists.tenantId, priceLists.erpId], set: { updatedAt: new Date() } })
        .returning({ id: priceLists.id });
      listId = pl!.id;
      cust.priceListId = listId;
      await tx.update(customers).set({ priceListId: listId }).where(and(eq(customers.tenantId, tenantId), eq(customers.id, cust.id)));
    }
    await tx.delete(priceListItems).where(and(eq(priceListItems.tenantId, tenantId), eq(priceListItems.priceListId, listId), eq(priceListItems.itemId, itemId)));
    await tx.insert(priceListItems).values({ tenantId, priceListId: listId, itemId, price: String(e.price), minQty: e.minQty == null ? null : String(e.minQty) });
    applied++;
  }
  return applied;
}

async function drain<T>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; cursor: string | null }>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page++) {
    const r = await fetchPage(cursor);
    out.push(...r.items);
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}

export type SyncSummary = { items: number; customers: number; prices: number; stock: number };

/** Full sync of items, customers, prices and stock from the tenant's ERP (plan §6.3 onboarding step 2). */
export async function runSync(deps: ServiceDeps, tenantId: string, integrationId: string, actor: Actor): Promise<SyncSummary> {
  const integration = await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.id, integrationId)));
    return row;
  });
  if (!integration) throw new ServiceError("not_found", "Integration not found");
  const connector = await deps.connectorFor(tenantId, integration);
  if (!connector) throw new ServiceError("not_configured", `The ${integration.type} connection is not usable yet`);

  const runId = await withTenant(deps.db, tenantId, async (tx) => {
    const [r] = await tx.insert(syncRuns).values({ tenantId, integrationId, kind: "full" }).returning({ id: syncRuns.id });
    return r!.id;
  });

  try {
    const erpItems = await drain((c) => connector.syncItems(c));
    const erpCustomers = await drain((c) => connector.syncCustomers(c));
    const erpPrices = await drain((c) => connector.syncPrices(c));
    const stock = erpItems.length ? await connector.checkStock(erpItems.map((i) => i.id)) : [];
    const summary = await applySync(deps, tenantId, { items: erpItems, customers: erpCustomers, prices: erpPrices, stock });
    await withTenant(deps.db, tenantId, async (tx) => {
      const at = nowOf(deps);
      await tx.update(syncRuns).set({ status: "succeeded", finishedAt: at, recordsSeen: summary.items + summary.customers, recordsChanged: summary.items + summary.customers, stats: summary }).where(eq(syncRuns.id, runId));
      await tx.update(integrations).set({ status: "connected", lastSyncAt: at, lastError: null }).where(eq(integrations.id, integrationId));
      await logEvent(tx, { tenantId, actor, action: "synced", entity: "integration", entityId: integrationId, after: summary });
    });
    return summary;
  } catch (err) {
    const message = errorText(err);
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.update(syncRuns).set({ status: "failed", finishedAt: nowOf(deps), error: message }).where(eq(syncRuns.id, runId));
      await tx.update(integrations).set({ status: err instanceof ConnectorAuthError ? "error" : integration.status, lastError: message }).where(eq(integrations.id, integrationId));
    });
    throw err instanceof ServiceError ? err : new ServiceError("erp", `Sync failed: ${message}`);
  }
}

export async function applySync(
  deps: Pick<ServiceDeps, "db" | "now">,
  tenantId: string,
  data: { items: CatalogItem[]; customers: CustomerRecord[]; prices: PriceListEntry[]; stock: Array<{ itemId: string; available: number }> },
): Promise<SyncSummary> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const nItems = await upsertItems(tx, tenantId, data.items);
    const nCustomers = await upsertCustomers(tx, tenantId, data.customers);
    const nPrices = await applyPrices(tx, tenantId, data.prices);
    let nStock = 0;
    const at = nowOf(deps);
    for (const part of chunks(data.stock)) {
      for (const s of part) {
        await tx.update(items).set({ stockAvailable: String(s.available), stockCheckedAt: at }).where(and(eq(items.tenantId, tenantId), eq(items.erpId, s.itemId)));
        nStock++;
      }
    }
    return { items: nItems, customers: nCustomers, prices: nPrices, stock: nStock };
  });
}

/** Import an item-master CSV export (the universal fallback, plan §6.2). */
export async function importItemsCsv(deps: Pick<ServiceDeps, "db">, tenantId: string, csvText: string, actor: Actor): Promise<number> {
  const parsed = parseItemsCsv(parseCsvRows(csvText));
  if (parsed.length === 0) throw new ServiceError("invalid", "No items found. The file needs a header row with at least SKU and Description columns.");
  return withTenant(deps.db, tenantId, async (tx) => {
    const n = await upsertItems(tx, tenantId, parsed);
    await logEvent(tx, { tenantId, actor, action: "imported", entity: "items", after: { count: n } });
    return n;
  });
}

export async function importCustomersCsv(deps: Pick<ServiceDeps, "db">, tenantId: string, csvText: string, actor: Actor): Promise<number> {
  const parsed = parseCustomersCsv(parseCsvRows(csvText));
  if (parsed.length === 0) throw new ServiceError("invalid", "No customers found. The file needs a header row with at least a Name column.");
  return withTenant(deps.db, tenantId, async (tx) => {
    const n = await upsertCustomers(tx, tenantId, parsed);
    await logEvent(tx, { tenantId, actor, action: "imported", entity: "customers", after: { count: n } });
    return n;
  });
}

export async function itemErpIds(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.select({ id: items.id, erpId: items.erpId }).from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, ids)));
  return new Map(rows.map((r) => [r.id, r.erpId]));
}
