import type { OrderDraft } from "@desk/core";

/**
 * Prospect-facing accuracy report (plan §5.4): one page per prospect summarizing what
 * the pipeline did with their own POs: fields read, lines matched, exceptions flagged,
 * estimated minutes saved. Markdown so it pastes into email or renders to PDF.
 */
export type ReportInput = {
  company: string;
  erp: string | null;
  drafts: OrderDraft[];
  /** Documents that produced no draft (non-orders, failures) */
  skipped: Array<{ filename: string; reason: string }>;
  /** Minutes a CSR spends keying one order manually; plan §4.3 default 8 */
  minutesPerOrderManual?: number;
  /** Minutes to review an exception line in the queue */
  minutesPerException?: number;
  totalCostUsd: number;
};

export function buildProspectReport(input: ReportInput): string {
  const manual = input.minutesPerOrderManual ?? 8;
  const perException = input.minutesPerException ?? 1.5;
  const drafts = input.drafts;
  const lines = drafts.flatMap((d) => d.lines);
  const matched = lines.filter((l) => l.match.status === "matched");
  const ambiguous = lines.filter((l) => l.match.status === "ambiguous");
  const unmatched = lines.filter((l) => l.match.status === "unmatched");
  const byMethod = count(matched.map((l) => l.match.best?.method ?? "?"));
  const cleanDrafts = drafts.filter((d) => d.lines.every((l) => l.issues.every((i) => i.severity !== "error")) && d.issues.every((i) => i.severity !== "error"));
  const issueCounts = count([...drafts.flatMap((d) => d.issues), ...lines.flatMap((l) => l.issues)].filter((i) => i.severity !== "info").map((i) => i.code));
  const exceptions = lines.filter((l) => l.issues.some((i) => i.severity === "error")).length;
  const minutesManual = drafts.length * manual;
  const minutesWithDesk = drafts.length * 0.5 + exceptions * perException;
  const customersFound = drafts.filter((d) => d.customer.customerId).length;

  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`);

  return [
    `# Order desk audit for ${input.company}`,
    ``,
    `${drafts.length} purchase orders processed${input.erp ? ` against your ${input.erp} item and customer lists` : ""}. ${input.skipped.length} file(s) skipped.`,
    ``,
    `## Results`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Orders drafted | ${drafts.length} |`,
    `| Orders with no exceptions (ready to post) | ${cleanDrafts.length} (${pct(cleanDrafts.length, drafts.length)}) |`,
    `| Customers identified automatically | ${customersFound} / ${drafts.length} |`,
    `| Line items read | ${lines.length} |`,
    `| Lines matched to your items | ${matched.length} (${pct(matched.length, lines.length)}) |`,
    `| Lines needing a human pick (2–5 candidates shown) | ${ambiguous.length} |`,
    `| Lines with no matching item | ${unmatched.length} |`,
    ``,
    `How lines were matched: ${Object.entries(byMethod)
      .map(([m, n]) => `${label(m)} ${n}`)
      .join(" · ")}.`,
    ``,
    `## Exceptions flagged`,
    ``,
    ...(Object.keys(issueCounts).length
      ? Object.entries(issueCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([code, n]) => `- ${issueLabel(code)}: ${n}`)
      : ["- None"]),
    ``,
    `## Time`,
    ``,
    `Keying these ${drafts.length} orders by hand at ~${manual} min each: **${fmtMin(minutesManual)}**.`,
    `Reviewing them in the desk (30 s per order + ${perException} min per exception line): **${fmtMin(minutesWithDesk)}**.`,
    `Estimated saving: **${fmtMin(Math.max(0, minutesManual - minutesWithDesk))}** (${pct(Math.max(0, minutesManual - minutesWithDesk), minutesManual)}). Learned aliases reduce the exception count on repeat orders.`,
    ``,
    `## What the ambiguous lines looked like`,
    ``,
    ...ambiguous.slice(0, 8).map((l) => `- "${l.rawPartNumber.value ?? ""} ${l.rawDescription.value ?? ""}".trim() → ${l.match.candidates.slice(0, 3).map((c) => c.sku).join(" / ")}`),
    ...(ambiguous.length === 0 ? ["- None"] : []),
    ``,
    ...(input.skipped.length ? [`## Skipped files`, ``, ...input.skipped.map((s) => `- ${s.filename}: ${s.reason}`), ``] : []),
    `_Processing cost for this batch: $${input.totalCostUsd.toFixed(2)} (${drafts.length ? `$${(input.totalCostUsd / drafts.length).toFixed(3)}/order` : "n/a"})._`,
    ``,
  ].join("\n");
}

function count(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
const fmtMin = (m: number) => (m >= 60 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const label = (m: string) =>
  ({ L0_exact: "exact SKU/UPC/MPN", L1_alias: "learned alias", L2_trigram: "description similarity", L3_vector: "semantic similarity", L4_llm: "AI disambiguation", manual: "manual" })[m] ?? m;
const issueLabel = (c: string) =>
  ({
    ITEM_UNMATCHED: "Item not found",
    ITEM_AMBIGUOUS: "Several possible items",
    ITEM_INACTIVE: "Inactive item",
    PRICE_MISMATCH: "Price differs from list/contract",
    PRICE_MISSING: "No price on file",
    STOCK_SHORT: "Stock short",
    UOM_UNKNOWN: "Unit of measure not recognised",
    PACK_ROUNDING: "Quantity adjusted to pack",
    MIN_QTY: "Below minimum",
    QTY_MISSING: "Quantity missing",
    CUSTOMER_UNKNOWN: "Customer not identified",
    CUSTOMER_CREDIT_HOLD: "Customer on credit hold",
    DUPLICATE_PO: "Duplicate PO number",
    PO_MISSING: "No PO number",
    TOTALS_MISMATCH: "Totals do not add up",
    LOW_CONFIDENCE: "Low read confidence",
    NOT_AN_ORDER: "Not an order",
  })[c] ?? c;
