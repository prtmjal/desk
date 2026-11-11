import { describe, expect, it } from "vitest";
import { fixtures } from "@desk/extract";
import { aggregate, alignLines, scoreCase, valuesEqual, evaluateGate, buildProspectReport, runEvals } from "../src/index";

const { extractedLine, extractedOrder, extraction } = fixtures;

describe("valuesEqual", () => {
  it("compares by kind", () => {
    expect(valuesEqual("PO-1", "po 1", "id")).toBe(true);
    expect(valuesEqual(10, 10.004, "number")).toBe(true);
    expect(valuesEqual("2026-11-05", "2026-11-05T00:00:00Z", "date")).toBe(true);
    expect(valuesEqual("Acme  Electric", "acme electric", "text")).toBe(true);
    expect(valuesEqual(null, "", "text")).toBe(true);
    expect(valuesEqual(null, "x", "text")).toBe(false);
  });
});

describe("alignLines / scoreCase", () => {
  it("aligns by part number even when order differs and scores fields", () => {
    const expected = [extractedLine(1, { part: "A-1", desc: "first", qty: 1 }), extractedLine(2, { part: "B-2", desc: "second", qty: 2 })];
    const actual = [extractedLine(1, { part: "b2", desc: "second", qty: 2 }), extractedLine(2, { part: "A-1", desc: "first", qty: 3 })];
    const pairs = alignLines(expected, actual);
    expect(pairs[0]![1]?.rawPartNumber.value).toBe("A-1");
    expect(pairs[1]![1]?.rawPartNumber.value).toBe("b2");

    const exp = extraction([extractedOrder({ po: "PO-9", lines: expected })]);
    const act = extraction([extractedOrder({ po: "PO-9", lines: actual })]);
    const s = scoreCase({ caseId: "c", kind: "k", expected: { extraction: exp, matches: {}, customerId: null, safeToAutoPost: false }, actual: { extraction: act, drafts: [], costUsd: 0.01, latencyMs: 100 } });
    expect(s.header.correct).toBe(s.header.total);
    expect(s.lines.aligned).toBe(2);
    expect(s.lines.fieldTotal).toBe(10);
    expect(s.lines.fieldCorrect).toBe(9); // qty 1 vs 3 wrong
  });

  it("aggregate computes ratios and the gate blocks false auto-posts", () => {
    const base = { caseId: "x", kind: "k", documentTypeCorrect: true, orderCountCorrect: true, header: { total: 10, correct: 10, fields: [] }, lines: { expected: 2, extracted: 2, aligned: 2, fieldTotal: 10, fieldCorrect: 10 }, matches: { total: 2, correct: 2, abstainedCorrectly: 0, wrongItem: 0 }, customerCorrect: true, falseAutoPost: false, costUsd: 0.05, latencyMs: 2000, notes: [] };
    const agg = aggregate([base, { ...base, falseAutoPost: true }]);
    expect(agg.headerFieldAcc).toBe(1);
    expect(agg.falseAutoPosts).toBe(1);
    const gate = evaluateGate(agg, { budgetUsdPerDoc: 0.15, mode: "cached" });
    expect(gate.pass).toBe(false);
    expect(gate.reasons[0]).toMatch(/false auto-post/);
  });
});

describe("demo golden set (cached, offline)", () => {
  it("passes the release gate", async () => {
    const r = await runEvals({ set: "demo", mode: "cached", budgetUsdPerDoc: 0.15 });
    expect(r.agg.cases).toBe(4);
    expect(r.agg.falseAutoPosts).toBe(0);
    expect(r.agg.matchAcc).toBeGreaterThanOrEqual(0.9);
    expect(r.gate.reasons).toEqual([]);
    expect(r.gate.pass).toBe(true);
  }, 30000);

  it("renders a prospect report", async () => {
    const r = await runEvals({ set: "demo", mode: "cached", budgetUsdPerDoc: 0.15 });
    void r;
    const md = buildProspectReport({ company: "Demo Co", erp: "QuickBooks Online", drafts: [], skipped: [], totalCostUsd: 0 });
    expect(md).toContain("# Order desk audit for Demo Co");
  });
});
