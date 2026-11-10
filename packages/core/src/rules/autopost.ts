import type { DraftLine, MatchMethod, ValidationIssue } from "../schema/index";

/**
 * Per-tenant / per-customer auto-post thresholds (plan §6.2 rules engine).
 * Default is OFF (plan §6.3 onboarding: "set auto-post thresholds (default: off)").
 */
export type AutoPostPolicy = {
  enabled: boolean;
  /** Every line's match score must be >= this (default 0.98). */
  minLineMatchScore: number;
  /** Every line's extraction confidence must be >= this. */
  minLineConfidence: number;
  /** Header confidence must be >= this. */
  minHeaderConfidence: number;
  /** Max absolute price delta in percent (default 2). */
  maxPriceDeltaPct: number;
  /** Which match methods may auto-post. L4 is excluded by default: a human confirms LLM picks until aliases exist. */
  allowedMethods: MatchMethod[];
  /** Issue severities that block. Warnings block too unless listed in ignorableWarnings. */
  ignorableWarnings: ValidationIssue["code"][];
  /** Shadow mode: evaluate but never post (plan §6.6). */
  shadowMode: boolean;
};

export const DEFAULT_AUTOPOST: AutoPostPolicy = {
  enabled: false,
  minLineMatchScore: 0.98,
  minLineConfidence: 0.95,
  minHeaderConfidence: 0.9,
  maxPriceDeltaPct: 2,
  allowedMethods: ["L0_exact", "L1_alias", "manual"],
  ignorableWarnings: ["PRICE_MISSING", "PO_MISSING"],
  shadowMode: true,
};

export type AutoPostDecision = { eligible: boolean; reasons: string[] };

export function evaluateAutoPost(
  input: {
    lines: DraftLine[];
    headerIssues: ValidationIssue[];
    headerConfidence: number;
    lineConfidences: number[];
    documentType: string;
  },
  policy: AutoPostPolicy = DEFAULT_AUTOPOST,
): AutoPostDecision {
  const reasons: string[] = [];
  if (!policy.enabled) reasons.push("Auto-post is disabled for this tenant/customer");
  if (policy.shadowMode) reasons.push("Shadow mode: posting disabled");
  if (input.documentType !== "order") reasons.push(`Document classified as ${input.documentType}, not an order`);
  if (input.lines.length === 0) reasons.push("No lines");
  if (input.headerConfidence < policy.minHeaderConfidence) {
    reasons.push(`Header confidence ${input.headerConfidence.toFixed(2)} < ${policy.minHeaderConfidence}`);
  }

  const blocking = (issues: ValidationIssue[]) =>
    issues.filter((i) => i.severity === "error" || (i.severity === "warning" && !policy.ignorableWarnings.includes(i.code)));

  for (const i of blocking(input.headerIssues)) reasons.push(`Header: ${i.message}`);

  input.lines.forEach((line, idx) => {
    const tag = `Line ${line.lineNo}`;
    if (line.match.status !== "matched" || !line.match.best) {
      reasons.push(`${tag}: ${line.match.status}`);
      return;
    }
    if (!policy.allowedMethods.includes(line.match.best.method)) {
      reasons.push(`${tag}: matched by ${line.match.best.method}, needs human confirmation`);
    }
    if (line.match.best.score < policy.minLineMatchScore) {
      reasons.push(`${tag}: match score ${line.match.best.score.toFixed(2)} < ${policy.minLineMatchScore}`);
    }
    const conf = input.lineConfidences[idx] ?? 0;
    if (conf < policy.minLineConfidence) reasons.push(`${tag}: extraction confidence ${conf.toFixed(2)} < ${policy.minLineConfidence}`);
    if (line.priceDeltaPct !== null && Math.abs(line.priceDeltaPct) > policy.maxPriceDeltaPct) {
      reasons.push(`${tag}: price delta ${line.priceDeltaPct.toFixed(1)}% > ${policy.maxPriceDeltaPct}%`);
    }
    for (const i of blocking(line.issues)) reasons.push(`${tag}: ${i.message}`);
  });

  return { eligible: reasons.length === 0, reasons };
}
