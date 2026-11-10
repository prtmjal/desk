import type { CatalogItem, ExtractedLine, ExtractionOutput } from "@desk/core";
import type { ClassificationOutput, LlmClient, LlmResult, RerankOutput } from "../llm";
import type { NormalizedDocument } from "../normalize/types";

type Fn<T> = (doc: NormalizedDocument) => T;

const zeroCost = (usd = 0) => ({ inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, usd, calls: 1 });

/**
 * Deterministic stand-in for the model. Used by unit tests and by `pnpm replay --from-cache`
 * to re-run matching/validation on stored extraction outputs without paying for extraction.
 */
export class FakeLlm implements LlmClient {
  calls: { classify: number; extract: number; rerank: number } = { classify: 0, extract: 0, rerank: 0 };

  constructor(
    private opts: {
      classification?: ClassificationOutput | Fn<ClassificationOutput>;
      extraction: ExtractionOutput | Fn<ExtractionOutput>;
      rerank?: (input: { line: ExtractedLine; documentContext: string | null; candidates: CatalogItem[] }) => RerankOutput;
      usdPerCall?: number;
    },
  ) {}

  async classify(doc: NormalizedDocument): Promise<LlmResult<ClassificationOutput>> {
    this.calls.classify++;
    const c = this.opts.classification;
    const output: ClassificationOutput =
      typeof c === "function" ? c(doc) : (c ?? { documentType: "order", confidence: 0.95, hasAttachments: doc.parts.length > 0, estimatedOrderCount: 1, rationale: "fake" });
    return { output, cost: zeroCost(this.opts.usdPerCall ?? 0.001), model: "fake-classify", promptVersion: "classify.v1", stopReason: "end_turn" };
  }

  async extract(doc: NormalizedDocument): Promise<LlmResult<ExtractionOutput>> {
    this.calls.extract++;
    const e = this.opts.extraction;
    const output = typeof e === "function" ? e(doc) : e;
    return { output, cost: zeroCost(this.opts.usdPerCall ?? 0.02), model: "fake-extract", promptVersion: "extract-order.v1", stopReason: "end_turn" };
  }

  async rerank(input: { line: ExtractedLine; documentContext: string | null; candidates: CatalogItem[] }): Promise<LlmResult<RerankOutput>> {
    this.calls.rerank++;
    const output = this.opts.rerank ? this.opts.rerank(input) : { itemId: null, confidence: 0, reason: "fake reranker declines" };
    return { output, cost: zeroCost(this.opts.usdPerCall ?? 0.002), model: "fake-rerank", promptVersion: "rerank.v1", stopReason: "end_turn" };
  }
}
