import type { ExtractedLine, ExtractedOrder, ExtractionOutput, OrderDraft } from "@desk/core";
import { normalizePartNumber } from "@desk/core";

/**
 * Field-level accuracy scoring (plan §7.6 metrics): header field accuracy, line
 * recall/precision, match accuracy, false-auto-post rate, cost, latency.
 */
export type FieldScore = { field: string; expected: unknown; actual: unknown; correct: boolean };

export type CaseScore = {
  caseId: string;
  kind: string;
  documentTypeCorrect: boolean;
  orderCountCorrect: boolean;
  header: { total: number; correct: number; fields: FieldScore[] };
  lines: { expected: number; extracted: number; aligned: number; fieldTotal: number; fieldCorrect: number };
  matches: { total: number; correct: number; abstainedCorrectly: number; wrongItem: number };
  customerCorrect: boolean | null;
  falseAutoPost: boolean;
  costUsd: number;
  latencyMs: number;
  notes: string[];
};

const HEADER_FIELDS: Array<[string, (o: ExtractedOrder) => unknown, "text" | "number" | "date" | "id"]> = [
  ["poNumber", (o) => o.poNumber.value, "id"],
  ["orderDate", (o) => o.orderDate.value, "date"],
  ["requestedShipDate", (o) => o.requestedShipDate.value, "date"],
  ["customer.name", (o) => o.customer.name.value, "text"],
  ["customer.accountNumber", (o) => o.customer.accountNumber.value, "id"],
  ["shipTo.line1", (o) => o.shipTo.line1.value, "text"],
  ["shipTo.city", (o) => o.shipTo.city.value, "text"],
  ["shipTo.postalCode", (o) => o.shipTo.postalCode.value, "id"],
  ["paymentTerms", (o) => o.paymentTerms.value, "text"],
  ["subtotal", (o) => o.subtotal.value, "number"],
  ["total", (o) => o.total.value, "number"],
];

const LINE_FIELDS: Array<[string, (l: ExtractedLine) => unknown, "text" | "number" | "date" | "id"]> = [
  ["rawPartNumber", (l) => l.rawPartNumber.value, "id"],
  ["rawDescription", (l) => l.rawDescription.value, "text"],
  ["quantity", (l) => l.quantity.value, "number"],
  ["rawUom", (l) => l.rawUom.value, "id"],
  ["unitPrice", (l) => l.unitPrice.value, "number"],
];

export function valuesEqual(a: unknown, b: unknown, kind: "text" | "number" | "date" | "id"): boolean {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (b === null || b === undefined || b === "") return false;
  switch (kind) {
    case "number":
      return Math.abs(Number(a) - Number(b)) < 0.005;
    case "id":
      return normalizePartNumber(String(a)) === normalizePartNumber(String(b));
    case "date":
      return String(a).slice(0, 10) === String(b).slice(0, 10);
    default:
      return norm(String(a)) === norm(String(b));
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Align extracted lines to expected lines by part number, then description, then position. */
export function alignLines(expected: ExtractedLine[], actual: ExtractedLine[]): Array<[ExtractedLine, ExtractedLine | null]> {
  const used = new Set<number>();
  const pairs: Array<[ExtractedLine, ExtractedLine | null]> = [];
  for (const e of expected) {
    let idx = actual.findIndex((a, i) => !used.has(i) && e.rawPartNumber.value && valuesEqual(e.rawPartNumber.value, a.rawPartNumber.value, "id"));
    if (idx < 0) idx = actual.findIndex((a, i) => !used.has(i) && e.rawDescription.value && valuesEqual(e.rawDescription.value, a.rawDescription.value, "text"));
    if (idx < 0) idx = actual.findIndex((a, i) => !used.has(i) && a.lineNo === e.lineNo);
    if (idx >= 0) {
      used.add(idx);
      pairs.push([e, actual[idx]!]);
    } else pairs.push([e, null]);
  }
  return pairs;
}

export function scoreCase(input: {
  caseId: string;
  kind: string;
  expected: { extraction: ExtractionOutput; matches: Record<string, string | null>; customerId: string | null; safeToAutoPost: boolean };
  actual: { extraction: ExtractionOutput | null; drafts: OrderDraft[]; costUsd: number; latencyMs: number };
}): CaseScore {
  const notes: string[] = [];
  const exp = input.expected.extraction;
  const act = input.actual.extraction;
  const score: CaseScore = {
    caseId: input.caseId,
    kind: input.kind,
    documentTypeCorrect: act?.documentType === exp.documentType,
    orderCountCorrect: (act?.orders.length ?? 0) === exp.orders.length,
    header: { total: 0, correct: 0, fields: [] },
    lines: { expected: 0, extracted: 0, aligned: 0, fieldTotal: 0, fieldCorrect: 0 },
    matches: { total: 0, correct: 0, abstainedCorrectly: 0, wrongItem: 0 },
    customerCorrect: null,
    falseAutoPost: false,
    costUsd: input.actual.costUsd,
    latencyMs: input.actual.latencyMs,
    notes,
  };
  if (!act) {
    notes.push("no extraction produced");
    score.lines.expected = exp.orders.reduce((a, o) => a + o.lines.length, 0);
    return score;
  }

  exp.orders.forEach((eo, oi) => {
    const ao = act.orders.find((o) => eo.poNumber.value && valuesEqual(eo.poNumber.value, o.poNumber.value, "id")) ?? act.orders[oi] ?? null;
    if (!ao) {
      notes.push(`expected order ${eo.poNumber.value ?? oi} missing`);
      score.header.total += HEADER_FIELDS.length;
      score.lines.expected += eo.lines.length;
      return;
    }
    for (const [name, get, kind] of HEADER_FIELDS) {
      const e = get(eo);
      const a = get(ao);
      const correct = valuesEqual(e, a, kind);
      score.header.total++;
      if (correct) score.header.correct++;
      score.header.fields.push({ field: name, expected: e, actual: a, correct });
    }
    score.lines.expected += eo.lines.length;
    score.lines.extracted += ao.lines.length;
    const pairs = alignLines(eo.lines, ao.lines);
    const draft = input.actual.drafts.find((d) => eo.poNumber.value && valuesEqual(eo.poNumber.value, d.header.poNumber.value, "id")) ?? input.actual.drafts[oi];
    for (const [e, a] of pairs) {
      if (!a) {
        score.lines.fieldTotal += LINE_FIELDS.length;
        continue;
      }
      score.lines.aligned++;
      for (const [, get, kind] of LINE_FIELDS) {
        score.lines.fieldTotal++;
        if (valuesEqual(get(e), get(a), kind)) score.lines.fieldCorrect++;
      }
      const expectedItem = input.expected.matches[String(e.lineNo)];
      if (expectedItem !== undefined && draft) {
        score.matches.total++;
        const dl = draft.lines.find((l) => l.lineNo === a.lineNo);
        const got = dl?.match.status === "matched" ? (dl.match.best?.itemId ?? null) : null;
        if (expectedItem === null || expectedItem === "") {
          if (got === null) {
            score.matches.correct++;
            score.matches.abstainedCorrectly++;
          } else score.matches.wrongItem++;
        } else if (got === expectedItem) score.matches.correct++;
        else if (got !== null) score.matches.wrongItem++;
      }
    }
    if (draft) {
      if (input.expected.customerId !== null) score.customerCorrect = draft.customer.customerId === input.expected.customerId;
      if (draft.autoPost.eligible && !input.expected.safeToAutoPost) {
        score.falseAutoPost = true;
        notes.push(`draft ${draft.header.poNumber.value} would auto-post but is not safe`);
      }
    }
  });
  return score;
}

export type Aggregate = {
  cases: number;
  documentTypeAcc: number;
  headerFieldAcc: number;
  lineRecall: number;
  lineFieldAcc: number;
  matchAcc: number;
  wrongItemRate: number;
  customerAcc: number | null;
  falseAutoPosts: number;
  meanCostUsd: number;
  p95LatencyMs: number;
  byKind: Record<string, { cases: number; headerFieldAcc: number; lineFieldAcc: number; matchAcc: number }>;
};

export function aggregate(scores: CaseScore[]): Aggregate {
  const sum = <T>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
  const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);
  const latencies = scores.map((s) => s.latencyMs).sort((a, b) => a - b);
  const customerScored = scores.filter((s) => s.customerCorrect !== null);
  const byKind: Aggregate["byKind"] = {};
  for (const kind of new Set(scores.map((s) => s.kind))) {
    const ks = scores.filter((s) => s.kind === kind);
    byKind[kind] = {
      cases: ks.length,
      headerFieldAcc: ratio(sum(ks, (s) => s.header.correct), sum(ks, (s) => s.header.total)),
      lineFieldAcc: ratio(sum(ks, (s) => s.lines.fieldCorrect), sum(ks, (s) => s.lines.fieldTotal)),
      matchAcc: ratio(sum(ks, (s) => s.matches.correct), sum(ks, (s) => s.matches.total)),
    };
  }
  return {
    cases: scores.length,
    documentTypeAcc: ratio(scores.filter((s) => s.documentTypeCorrect).length, scores.length),
    headerFieldAcc: ratio(sum(scores, (s) => s.header.correct), sum(scores, (s) => s.header.total)),
    lineRecall: ratio(sum(scores, (s) => s.lines.aligned), sum(scores, (s) => s.lines.expected)),
    lineFieldAcc: ratio(sum(scores, (s) => s.lines.fieldCorrect), sum(scores, (s) => s.lines.fieldTotal)),
    matchAcc: ratio(sum(scores, (s) => s.matches.correct), sum(scores, (s) => s.matches.total)),
    wrongItemRate: ratio(sum(scores, (s) => s.matches.wrongItem), sum(scores, (s) => s.matches.total)) * (sum(scores, (s) => s.matches.total) === 0 ? 0 : 1),
    customerAcc: customerScored.length ? ratio(customerScored.filter((s) => s.customerCorrect).length, customerScored.length) : null,
    falseAutoPosts: scores.filter((s) => s.falseAutoPost).length,
    meanCostUsd: scores.length ? sum(scores, (s) => s.costUsd) / scores.length : 0,
    p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]! : 0,
    byKind,
  };
}
