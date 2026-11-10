import { z } from "zod";
import { Confidence } from "./common";
import { DocumentType, ExtractedLine, ExtractedOrder } from "./extracted-order";

export const MatchMethod = z.enum([
  "L0_exact",
  "L1_alias",
  "L2_trigram",
  "L3_vector",
  "L4_llm",
  "manual",
]);
export type MatchMethod = z.infer<typeof MatchMethod>;

export const MatchCandidate = z.object({
  itemId: z.string(),
  sku: z.string(),
  description: z.string(),
  method: MatchMethod,
  score: Confidence,
  evidence: z.string().describe("Human-readable reason, e.g. 'UPC exact' or 'trigram 0.82 on description'"),
});
export type MatchCandidate = z.infer<typeof MatchCandidate>;

export const MatchStatus = z.enum(["matched", "ambiguous", "unmatched", "skipped"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const MatchResult = z.object({
  status: MatchStatus,
  best: MatchCandidate.nullable(),
  candidates: z.array(MatchCandidate),
  uomFactor: z.number().nullable().describe("Multiply ordered qty by this to get ERP stocking UoM qty"),
  erpUom: z.string().nullable(),
  abstainReason: z.string().nullable(),
});
export type MatchResult = z.infer<typeof MatchResult>;

export const ValidationSeverity = z.enum(["info", "warning", "error"]);
export type ValidationSeverity = z.infer<typeof ValidationSeverity>;

export const ValidationCode = z.enum([
  "ITEM_UNMATCHED",
  "ITEM_AMBIGUOUS",
  "ITEM_INACTIVE",
  "PRICE_MISMATCH",
  "PRICE_MISSING",
  "STOCK_SHORT",
  "UOM_UNKNOWN",
  "PACK_ROUNDING",
  "MIN_QTY",
  "QTY_MISSING",
  "CUSTOMER_UNKNOWN",
  "CUSTOMER_CREDIT_HOLD",
  "DUPLICATE_PO",
  "PO_MISSING",
  "TOTALS_MISMATCH",
  "LOW_CONFIDENCE",
  "NOT_AN_ORDER",
]);
export type ValidationCode = z.infer<typeof ValidationCode>;

export const ValidationIssue = z.object({
  code: ValidationCode,
  severity: ValidationSeverity,
  lineNo: z.number().int().nullable(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const CustomerMatchMethod = z.enum(["domain", "account_number", "name_trigram", "manual", "none"]);
export const CustomerMatch = z.object({
  customerId: z.string().nullable(),
  name: z.string().nullable(),
  method: CustomerMatchMethod,
  confidence: Confidence,
  candidates: z.array(z.object({ customerId: z.string(), name: z.string(), score: Confidence })),
});
export type CustomerMatch = z.infer<typeof CustomerMatch>;

export const DraftLine = ExtractedLine.extend({
  match: MatchResult,
  normalizedPartNumber: z.string().nullable(),
  erpQuantity: z.number().nullable().describe("Quantity in ERP stocking UoM after uomFactor"),
  listPrice: z.number().nullable(),
  priceDeltaPct: z.number().nullable(),
  issues: z.array(ValidationIssue),
});
export type DraftLine = z.infer<typeof DraftLine>;

export const DraftStatus = z.enum(["new", "needs_review", "confirmed", "posted", "rejected"]);
export type DraftStatus = z.infer<typeof DraftStatus>;

export const CostRecord = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  usd: z.number(),
  calls: z.number(),
});
export type CostRecord = z.infer<typeof CostRecord>;

export const emptyCost = (): CostRecord => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  usd: 0,
  calls: 0,
});

export function addCost(a: CostRecord, b: CostRecord): CostRecord {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    usd: a.usd + b.usd,
    calls: a.calls + b.calls,
  };
}

export const OrderHeader = ExtractedOrder.omit({ lines: true });
export type OrderHeader = z.infer<typeof OrderHeader>;

export const OrderDraft = z.object({
  id: z.string(),
  tenantId: z.string(),
  documentId: z.string(),
  documentType: DocumentType,
  status: DraftStatus,
  customer: CustomerMatch,
  header: OrderHeader,
  lines: z.array(DraftLine),
  issues: z.array(ValidationIssue).describe("Header-level issues; line issues live on lines"),
  confidence: z.object({
    header: Confidence,
    lines: Confidence,
    overall: Confidence,
  }),
  autoPost: z.object({
    eligible: z.boolean(),
    reasons: z.array(z.string()),
  }),
  meta: z.object({
    extractorVersion: z.string(),
    promptVersion: z.string(),
    model: z.string(),
    createdAt: z.string(),
    cost: CostRecord,
    warnings: z.array(z.string()),
  }),
});
export type OrderDraft = z.infer<typeof OrderDraft>;
