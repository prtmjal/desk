/**
 * Postgres-backed CatalogIndex (plan §6.6 layers L0–L2) for one tenant.
 *
 * Construct it with a tenant-scoped transaction from `withTenant`; the tenant
 * filter is still applied explicitly in every query so the index is correct
 * even when handed a superuser connection in tests or scripts.
 */
import {
  normalizeDescription,
  normalizeDimensions,
  normalizePartNumber,
  type Alias,
  type CatalogIndex,
  type CatalogItem,
  type ScoredItem,
} from "@desk/core";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { aliases, items } from "./schema/index.js";

type ItemRow = typeof items.$inferSelect;
type ItemInsert = typeof items.$inferInsert;
type AliasRow = typeof aliases.$inferSelect;

/**
 * Fill the L0 key columns from the raw part numbers. Call on every insert/update
 * of an item (the ERP sync does this; the seed does too).
 */
export function withItemKeys<T extends Pick<ItemInsert, "sku" | "upc" | "mpn">>(
  values: T,
): T & { skuKey: string | null; upcKey: string | null; mpnKey: string | null } {
  return {
    ...values,
    skuKey: normalizePartNumber(values.sku),
    upcKey: normalizePartNumber(values.upc),
    mpnKey: normalizePartNumber(values.mpn),
  };
}

export function toCatalogItem(row: ItemRow): CatalogItem {
  return {
    id: row.id,
    sku: row.sku,
    upc: row.upc,
    mpn: row.mpn,
    description: row.description,
    extra: row.extra,
    active: row.active,
    pack: row.pack ?? { baseUom: row.uom },
    listPrice: row.listPrice === null ? null : Number(row.listPrice),
  };
}

export function toAlias(row: AliasRow): Alias {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    rawPartKey: row.rawPartKey,
    rawDescriptionKey: row.rawDescriptionKey,
    itemId: row.itemId,
    uomFactor: row.uomFactor === null ? null : Number(row.uomFactor),
    hits: row.hits,
  };
}

/** Minimum blended trigram score to return a candidate; mirrors InMemoryCatalog. */
const TRIGRAM_FLOOR = 0.1;

export class PgCatalogIndex implements CatalogIndex {
  constructor(
    private readonly db: DbOrTx,
    private readonly tenantId: string,
  ) {}

  async getById(id: string): Promise<CatalogItem | undefined> {
    const rows = await this.db
      .select()
      .from(items)
      .where(and(eq(items.tenantId, this.tenantId), eq(items.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? toCatalogItem(row) : undefined;
  }

  /** L0: exact on the normalized sku/upc/mpn key columns. */
  async exact(partKey: string): Promise<CatalogItem[]> {
    const key = normalizePartNumber(partKey);
    if (!key) return [];
    const rows = await this.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.tenantId, this.tenantId),
          eq(items.active, true),
          or(eq(items.skuKey, key), eq(items.upcKey, key), eq(items.mpnKey, key)),
        ),
      )
      .orderBy(items.sku);
    return rows.map(toCatalogItem);
  }

  /** L1: per-customer alias by normalized part number; most-confirmed first. */
  async alias(customerId: string, partKey: string): Promise<Alias | undefined> {
    const rows = await this.db
      .select()
      .from(aliases)
      .where(
        and(
          eq(aliases.tenantId, this.tenantId),
          eq(aliases.customerId, customerId),
          eq(aliases.rawPartKey, partKey),
        ),
      )
      .orderBy(desc(aliases.hits), desc(aliases.updatedAt))
      .limit(1);
    const row = rows[0];
    return row ? toAlias(row) : undefined;
  }

  /** L1b: per-customer alias by normalized description (PO line without a part number). */
  async aliasByDescription(customerId: string, descriptionKey: string): Promise<Alias | undefined> {
    const rows = await this.db
      .select()
      .from(aliases)
      .where(
        and(
          eq(aliases.tenantId, this.tenantId),
          eq(aliases.customerId, customerId),
          eq(aliases.rawDescriptionKey, descriptionKey),
        ),
      )
      .orderBy(desc(aliases.hits), desc(aliases.updatedAt))
      .limit(1);
    const row = rows[0];
    return row ? toAlias(row) : undefined;
  }

  /**
   * L2: pg_trgm over `sku || ' ' || mpn || ' ' || description || ' ' || extra`.
   * Score = greatest(similarity, 0.75 * word_similarity) so short PO descriptions
   * still score against long catalog descriptions, the same blend as InMemoryCatalog.
   */
  async trigram(query: string, k: number): Promise<ScoredItem[]> {
    const q = normalizeDescription(normalizeDimensions(query));
    if (!q || k <= 0) return [];
    const haystack = sql`(${items.sku} || ' ' || coalesce(${items.mpn}, '') || ' ' || ${items.description} || ' ' || coalesce(${items.extra}, ''))`;
    const sim = sql<number>`similarity(${q}, ${haystack})`;
    const cov = sql<number>`word_similarity(${q}, ${haystack})`;
    const score = sql<number>`greatest(${sim}, 0.75 * ${cov})`;

    const rows = await this.db
      .select({ item: items, sim, cov, score })
      .from(items)
      .where(and(eq(items.tenantId, this.tenantId), eq(items.active, true), sql`${score} > ${TRIGRAM_FLOOR}`))
      .orderBy(desc(score), items.sku)
      .limit(k);

    return rows.map((r) => ({
      item: toCatalogItem(r.item),
      score: Number(r.score),
      evidence: `trigram sim=${Number(r.sim).toFixed(2)} cov=${Number(r.cov).toFixed(2)}`,
    }));
  }

  // L3 `vector(query, k)` is intentionally not implemented yet: it needs an
  // embedding client for the query text plus the pgvector HNSW index that
  // migration 0001 creates only where the extension exists (plan §6.6 L3).
  // Leaving it undefined makes the layered matcher skip L3 cleanly.

  /** Persist a confirmed alias; a repeat confirmation increments `hits`. */
  async learnAlias(alias: Alias): Promise<void> {
    if (!alias.rawPartKey && !alias.rawDescriptionKey) {
      throw new Error("learnAlias: rawPartKey or rawDescriptionKey is required");
    }
    await this.db
      .insert(aliases)
      .values({
        tenantId: this.tenantId,
        customerId: alias.customerId,
        rawPartKey: alias.rawPartKey,
        rawDescriptionKey: alias.rawDescriptionKey,
        itemId: alias.itemId,
        uomFactor: alias.uomFactor === null || alias.uomFactor === undefined ? null : String(alias.uomFactor),
        hits: Math.max(1, alias.hits || 1),
      })
      .onConflictDoUpdate({
        target: [aliases.tenantId, aliases.customerId, aliases.rawPartKey, aliases.rawDescriptionKey, aliases.itemId],
        set: {
          hits: sql`${aliases.hits} + 1`,
          uomFactor: sql`coalesce(excluded.uom_factor, ${aliases.uomFactor})`,
          updatedAt: new Date(),
        },
      });
  }
}
