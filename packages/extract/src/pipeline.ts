import { randomUUID } from "node:crypto";
import {
  addCost,
  emptyCost,
  evaluateAutoPost,
  headerConfidence,
  identifyCustomer,
  lineConfidence,
  matchLine,
  normalizePartNumber,
  validateHeader,
  validateLine,
  DEFAULT_AUTOPOST,
  DEFAULT_POLICY,
  type AutoPostPolicy,
  type CatalogIndex,
  type CostRecord,
  type CustomerRecord,
  type DraftLine,
  type ExtractedOrder,
  type ExtractionOutput,
  type MatchThresholds,
  type OrderDraft,
  type Reranker,
  type ValidationContext,
  type ValidationPolicy,
} from "@desk/core";
import type { ClassificationOutput, LlmClient } from "./llm";
import { documentContextText } from "./normalize/to-content";
import type { NormalizedDocument } from "./normalize/types";

export const EXTRACTOR_VERSION = "0.1.0";

export type PipelineDeps = {
  tenantId: string;
  llm: LlmClient;
  catalog: CatalogIndex;
  customers: CustomerRecord[];
  validation: ValidationContext;
  /** Use the LLM re-ranker (L4) for ambiguous lines. Default true. */
  useReranker?: boolean;
  /** Skip the cheap classification call (e.g. manual uploads that are known to be orders). */
  skipClassify?: boolean;
  /** Classification confidence at/above which a non-order message is not sent to extraction. */
  nonOrderShortCircuit?: number;
  validationPolicy?: ValidationPolicy;
  autoPostPolicy?: AutoPostPolicy | ((customerId: string | null) => AutoPostPolicy);
  matchThresholds?: Partial<MatchThresholds>;
  now?: () => Date;
};

export type PipelineResult = {
  documentId: string;
  classification: ClassificationOutput | null;
  extraction: ExtractionOutput | null;
  drafts: OrderDraft[];
  cost: CostRecord;
  timingsMs: Record<string, number>;
};

/**
 * Inbound → Normalize (done upstream) → Classify → Extract → Identify customer → Match →
 * Validate → Rules → Draft (plan §6.6). Pure given its deps: no DB, no network except via `llm`.
 */
export async function processDocument(doc: NormalizedDocument, deps: PipelineDeps): Promise<PipelineResult> {
  const timings: Record<string, number> = {};
  let cost = emptyCost();
  const t0 = Date.now();

  let classification: ClassificationOutput | null = null;
  if (!deps.skipClassify) {
    const c = await deps.llm.classify(doc);
    classification = c.output;
    cost = addCost(cost, c.cost);
    timings.classify = Date.now() - t0;
    const cutoff = deps.nonOrderShortCircuit ?? 0.9;
    if (classification.documentType !== "order" && classification.confidence >= cutoff) {
      return { documentId: doc.id, classification, extraction: null, drafts: [], cost, timingsMs: timings };
    }
  }

  const t1 = Date.now();
  const ex = await deps.llm.extract(doc);
  cost = addCost(cost, ex.cost);
  timings.extract = Date.now() - t1;

  const t2 = Date.now();
  const drafts: OrderDraft[] = [];
  const reranker: Reranker | null =
    deps.useReranker === false
      ? null
      : {
          rerank: async (input) => {
            const r = await deps.llm.rerank(input);
            cost = addCost(cost, r.cost);
            return r.output;
          },
        };
  const docContext = documentContextText(doc);

  for (const order of ex.output.orders) {
    const draft = await buildDraft(order, ex.output, doc, deps, reranker, docContext, ex.model, ex.promptVersion);
    drafts.push(draft);
  }
  timings.matchValidate = Date.now() - t2;

  // Spread the document-level cost across drafts for per-order accounting.
  const share = drafts.length > 0 ? 1 / drafts.length : 1;
  for (const d of drafts) {
    d.meta.cost = {
      inputTokens: Math.round(cost.inputTokens * share),
      outputTokens: Math.round(cost.outputTokens * share),
      cacheReadTokens: Math.round(cost.cacheReadTokens * share),
      cacheWriteTokens: Math.round(cost.cacheWriteTokens * share),
      usd: cost.usd * share,
      calls: cost.calls,
    };
  }

  return { documentId: doc.id, classification, extraction: ex.output, drafts, cost, timingsMs: timings };
}

async function buildDraft(
  order: ExtractedOrder,
  output: ExtractionOutput,
  doc: NormalizedDocument,
  deps: PipelineDeps,
  reranker: Reranker | null,
  docContext: string,
  model: string,
  promptVersion: string,
): Promise<OrderDraft> {
  const { lines: extractedLines, ...header } = order;
  const customer = identifyCustomer({ senderEmail: doc.sender, order }, deps.customers);

  const lines: DraftLine[] = [];
  for (const l of extractedLines) {
    const match = await matchLine(l, {
      catalog: deps.catalog,
      customerId: customer.customerId,
      reranker,
      documentContext: docContext,
      thresholds: deps.matchThresholds,
    });
    const draftLine: DraftLine = {
      ...l,
      match,
      normalizedPartNumber: normalizePartNumber(l.rawPartNumber.value),
      erpQuantity: null,
      listPrice: null,
      priceDeltaPct: null,
      issues: [],
    };
    lines.push(await validateLine(draftLine, customer, deps.validation, deps.validationPolicy ?? DEFAULT_POLICY));
  }

  const headerIssues = await validateHeader(header, customer, lines, deps.validation, deps.validationPolicy ?? DEFAULT_POLICY);
  if (output.documentType !== "order") {
    headerIssues.unshift({
      code: "NOT_AN_ORDER",
      severity: "error",
      lineNo: null,
      message: `Document classified as ${output.documentType}`,
      data: { confidence: output.documentTypeConfidence },
    });
  }

  const lineConfs = lines.map(lineConfidence);
  const hConf = headerConfidence(header);
  const lConf = lineConfs.length ? lineConfs.reduce((a, b) => a + b, 0) / lineConfs.length : 0;
  const overall = lines.length ? 0.4 * hConf + 0.6 * lConf : hConf * 0.5;

  const policy =
    typeof deps.autoPostPolicy === "function"
      ? deps.autoPostPolicy(customer.customerId)
      : (deps.autoPostPolicy ?? DEFAULT_AUTOPOST);
  const autoPost = evaluateAutoPost(
    { lines, headerIssues, headerConfidence: hConf, lineConfidences: lineConfs, documentType: output.documentType },
    policy,
  );

  const hasBlocking =
    headerIssues.some((i) => i.severity === "error") || lines.some((l) => l.issues.some((i) => i.severity === "error"));

  return {
    id: randomUUID(),
    tenantId: deps.tenantId,
    documentId: doc.id,
    documentType: output.documentType,
    status: autoPost.eligible ? "confirmed" : hasBlocking ? "needs_review" : "new",
    customer,
    header,
    lines,
    issues: headerIssues,
    confidence: { header: hConf, lines: lConf, overall },
    autoPost,
    meta: {
      extractorVersion: EXTRACTOR_VERSION,
      promptVersion,
      model,
      createdAt: (deps.now ?? (() => new Date()))().toISOString(),
      cost: emptyCost(),
      warnings: output.warnings,
    },
  };
}
