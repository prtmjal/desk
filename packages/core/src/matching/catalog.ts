import type { PackDefinition } from "./uom";
import { normalizePartNumber, normalizeDescription, normalizeDimensions } from "./normalize";
import { similarity, coverage } from "./trigram";

/** Item master row as the matcher sees it (ERP-agnostic). */
export type CatalogItem = {
  id: string;
  sku: string;
  upc?: string | null;
  mpn?: string | null;
  description: string;
  /** Extra searchable text: long description, brand, category, keywords */
  extra?: string | null;
  active: boolean;
  pack: PackDefinition;
  listPrice?: number | null;
};

/** A learned per-customer alias (plan §4.5 moat #1). */
export type Alias = {
  id?: string;
  tenantId?: string;
  customerId: string;
  /** normalized customer part number, see normalizePartNumber */
  rawPartKey: string | null;
  /** optional normalized description the alias was learned from */
  rawDescriptionKey: string | null;
  itemId: string;
  uomFactor: number | null;
  hits: number;
};

export type ScoredItem = { item: CatalogItem; score: number; evidence: string };

/**
 * The matcher talks to a catalog through this interface so the same layered
 * algorithm runs against an in-memory index (CLI/tests) or Postgres
 * (pg_trgm + pgvector) in production.
 */
export interface CatalogIndex {
  getById(id: string): Promise<CatalogItem | undefined>;
  /** L0: exact on sku/upc/mpn after normalization. */
  exact(partKey: string): Promise<CatalogItem[]>;
  /** L1: per-customer alias lookup by normalized part number. */
  alias(customerId: string, partKey: string): Promise<Alias | undefined>;
  /** L1b: per-customer alias lookup by normalized description (no part number on PO). */
  aliasByDescription(customerId: string, descriptionKey: string): Promise<Alias | undefined>;
  /** L2: trigram similarity over sku + description + extra. */
  trigram(query: string, k: number): Promise<ScoredItem[]>;
  /** L3: vector similarity over description embeddings. Optional. */
  vector?(query: string, k: number): Promise<ScoredItem[]>;
  /** Learning: persist an alias after a human confirms a line. */
  learnAlias(alias: Alias): Promise<void>;
}

/** In-memory implementation for CLI replays and unit tests. */
export class InMemoryCatalog implements CatalogIndex {
  private byId = new Map<string, CatalogItem>();
  private byKey = new Map<string, CatalogItem[]>();
  private aliases: Alias[] = [];
  private searchText = new Map<string, string>();

  constructor(items: CatalogItem[] = [], aliases: Alias[] = []) {
    for (const it of items) this.add(it);
    for (const a of aliases) this.aliases.push(a);
  }

  add(item: CatalogItem) {
    this.byId.set(item.id, item);
    for (const k of [item.sku, item.upc, item.mpn]) {
      const key = normalizePartNumber(k);
      if (!key) continue;
      const arr = this.byKey.get(key) ?? [];
      if (!arr.some((x) => x.id === item.id)) arr.push(item);
      this.byKey.set(key, arr);
    }
    this.searchText.set(
      item.id,
      normalizeDescription(normalizeDimensions(`${item.sku} ${item.mpn ?? ""} ${item.description} ${item.extra ?? ""}`)),
    );
  }

  size() {
    return this.byId.size;
  }

  all(): CatalogItem[] {
    return [...this.byId.values()];
  }

  async getById(id: string) {
    return this.byId.get(id);
  }

  async exact(partKey: string) {
    return this.byKey.get(partKey) ?? [];
  }

  async alias(customerId: string, partKey: string) {
    return this.aliases
      .filter((a) => a.customerId === customerId && a.rawPartKey === partKey)
      .sort((a, b) => b.hits - a.hits)[0];
  }

  async aliasByDescription(customerId: string, descriptionKey: string) {
    return this.aliases
      .filter((a) => a.customerId === customerId && a.rawDescriptionKey === descriptionKey)
      .sort((a, b) => b.hits - a.hits)[0];
  }

  async trigram(query: string, k: number) {
    const q = normalizeDescription(normalizeDimensions(query));
    if (!q) return [];
    const scored: ScoredItem[] = [];
    for (const [id, text] of this.searchText) {
      const item = this.byId.get(id)!;
      // Blend symmetric similarity with coverage so short PO descriptions still score.
      const sim = similarity(q, text);
      const cov = coverage(q, text);
      // Coverage dominates for short PO lines; the gap test in the matcher guards against
      // generic words that are "covered" by many items.
      const score = Math.max(sim, 0.9 * cov);
      if (score > 0.1) scored.push({ item, score, evidence: `trigram sim=${sim.toFixed(2)} cov=${cov.toFixed(2)}` });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }

  async learnAlias(alias: Alias) {
    const existing = this.aliases.find(
      (a) =>
        a.customerId === alias.customerId &&
        a.rawPartKey === alias.rawPartKey &&
        a.rawDescriptionKey === alias.rawDescriptionKey &&
        a.itemId === alias.itemId,
    );
    if (existing) existing.hits += 1;
    else this.aliases.push({ ...alias, hits: alias.hits || 1 });
  }

  listAliases() {
    return [...this.aliases];
  }
}
