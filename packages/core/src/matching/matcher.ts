import type { ExtractedLine, MatchCandidate, MatchResult } from "../schema/index";
import type { CatalogIndex, CatalogItem, ScoredItem } from "./catalog";
import { normalizeDescription, partNumberVariants } from "./normalize";
import { resolveUom } from "./uom";

/**
 * L4: LLM re-rank. Implemented in @desk/extract; core only knows the shape so
 * the matcher stays free of model calls (plan §6.6: deterministic before probabilistic).
 */
export interface Reranker {
  rerank(input: {
    line: ExtractedLine;
    documentContext: string | null;
    candidates: CatalogItem[];
  }): Promise<{ itemId: string | null; confidence: number; reason: string }>;
}

export type MatchThresholds = {
  /** Accept an L2 top candidate outright when score >= this and the gap to #2 >= trigramGap */
  trigramAccept: number;
  trigramGap: number;
  /** Below this nothing from L2/L3 is even considered a candidate */
  candidateFloor: number;
  /** Accept an L4 answer when its confidence >= this */
  llmAccept: number;
  /** Number of candidates passed to L3/L4 */
  topK: number;
};

export const DEFAULT_THRESHOLDS: MatchThresholds = {
  trigramAccept: 0.72,
  trigramGap: 0.12,
  candidateFloor: 0.3,
  llmAccept: 0.85,
  topK: 5,
};

export type MatchContext = {
  catalog: CatalogIndex;
  customerId: string | null;
  reranker?: Reranker | null;
  documentContext?: string | null;
  thresholds?: Partial<MatchThresholds>;
};

function candidate(item: CatalogItem, method: MatchCandidate["method"], score: number, evidence: string): MatchCandidate {
  return { itemId: item.id, sku: item.sku, description: item.description, method, score, evidence };
}

function finish(
  status: MatchResult["status"],
  best: MatchCandidate | null,
  candidates: MatchCandidate[],
  line: ExtractedLine,
  item: CatalogItem | undefined,
  abstainReason: string | null,
  uomFactorOverride: number | null = null,
): MatchResult {
  let uomFactor: number | null = null;
  let erpUom: string | null = null;
  if (item) {
    const r = resolveUom(line.rawUom.value, item.pack);
    if (r.ok) {
      uomFactor = uomFactorOverride ?? r.factor;
      erpUom = r.erpUom;
    } else {
      uomFactor = uomFactorOverride;
      erpUom = item.pack.baseUom;
    }
  }
  return { status, best, candidates, uomFactor, erpUom, abstainReason };
}

/**
 * Layered line matching (plan §6.6):
 *   L0 exact SKU/UPC/MPN → L1 per-customer alias → L2 trigram → L3 vector → L4 LLM re-rank → abstain.
 * Each layer returns early when it is confident; the LLM is the last resort.
 */
export async function matchLine(line: ExtractedLine, ctx: MatchContext): Promise<MatchResult> {
  const t: MatchThresholds = { ...DEFAULT_THRESHOLDS, ...(ctx.thresholds ?? {}) };
  const { catalog, customerId } = ctx;
  const variants = partNumberVariants(line.rawPartNumber.value);
  const descKey = normalizeDescription(line.rawDescription.value);

  // Nothing to match on at all.
  if (variants.length === 0 && !descKey) {
    return finish("skipped", null, [], line, undefined, "Line has neither part number nor description");
  }

  // L1 first when the customer is known: a learned alias beats a coincidental exact hit
  // (customers' internal part numbers can collide with our SKUs).
  if (customerId) {
    for (const key of variants) {
      const alias = await catalog.alias(customerId, key);
      if (alias) {
        const item = await catalog.getById(alias.itemId);
        if (item && item.active) {
          const c = candidate(item, "L1_alias", 0.99, `Learned alias for this customer (${alias.hits} confirmations)`);
          return finish("matched", c, [c], line, item, null, alias.uomFactor);
        }
      }
    }
    if (variants.length === 0 && descKey) {
      const alias = await catalog.aliasByDescription(customerId, descKey);
      if (alias) {
        const item = await catalog.getById(alias.itemId);
        if (item && item.active) {
          const c = candidate(item, "L1_alias", 0.97, `Learned description alias for this customer`);
          return finish("matched", c, [c], line, item, null, alias.uomFactor);
        }
      }
    }
  }

  // L0 exact on our own identifiers.
  for (const key of variants) {
    const hits = (await catalog.exact(key)).filter((i) => i.active);
    if (hits.length === 1) {
      const item = hits[0]!;
      const c = candidate(item, "L0_exact", 1, `Exact match on identifier '${key}'`);
      return finish("matched", c, [c], line, item, null);
    }
    if (hits.length > 1) {
      // Same identifier on several active items (e.g. UPC shared across pack sizes): disambiguate below.
      const cands = hits.map((i) => candidate(i, "L0_exact", 0.6, `Identifier '${key}' shared by ${hits.length} items`));
      return await disambiguate(line, hits, cands, ctx, t, "Identifier shared by several items");
    }
  }

  // L2 trigram over part number + description.
  const query = [line.rawPartNumber.value, line.rawDescription.value].filter(Boolean).join(" ");
  const l2 = (await catalog.trigram(query, t.topK)).filter((s) => s.item.active && s.score >= t.candidateFloor);

  // L3 vector (optional), merged by max score.
  let merged: ScoredItem[] = l2;
  if (catalog.vector) {
    const l3 = (await catalog.vector(query, t.topK)).filter((s) => s.item.active && s.score >= t.candidateFloor);
    const byId = new Map<string, ScoredItem>();
    for (const s of [...l2, ...l3]) {
      const prev = byId.get(s.item.id);
      if (!prev || s.score > prev.score) byId.set(s.item.id, s);
    }
    merged = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, t.topK);
  }

  if (merged.length === 0) {
    return finish("unmatched", null, [], line, undefined, "No catalog item resembles this line");
  }

  const top = merged[0]!;
  const second = merged[1];
  const gap = second ? top.score - second.score : 1;
  const cands = merged.map((s) =>
    candidate(s.item, s.evidence.startsWith("vector") ? "L3_vector" : "L2_trigram", s.score, s.evidence),
  );

  // Only accept L2 outright when the PO had no explicit part number OR the SKU itself is in the text.
  // An explicit part number that did not hit L0/L1 is a strong signal to be careful.
  const hadPart = variants.length > 0;
  if (top.score >= t.trigramAccept && gap >= t.trigramGap && !hadPart) {
    return finish("matched", cands[0]!, cands, line, top.item, null);
  }

  return await disambiguate(line, merged.map((s) => s.item), cands, ctx, t, hadPart ? "Part number not in catalog; description resembles several items" : "Several items resemble this line");
}

async function disambiguate(
  line: ExtractedLine,
  items: CatalogItem[],
  cands: MatchCandidate[],
  ctx: MatchContext,
  t: MatchThresholds,
  reason: string,
): Promise<MatchResult> {
  if (ctx.reranker) {
    const r = await ctx.reranker.rerank({
      line,
      documentContext: ctx.documentContext ?? null,
      candidates: items.slice(0, t.topK),
    });
    if (r.itemId && r.confidence >= t.llmAccept) {
      const item = items.find((i) => i.id === r.itemId);
      if (item) {
        const c = candidate(item, "L4_llm", r.confidence, r.reason);
        // Keep the other candidates for the reviewer, best first.
        const rest = cands.filter((x) => x.itemId !== item.id);
        return finish("matched", c, [c, ...rest], line, item, null);
      }
    }
    return finish("ambiguous", null, cands, line, undefined, r.reason || reason);
  }
  return finish("ambiguous", null, cands, line, undefined, reason);
}
