import { readdir, readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryCatalog, type CatalogItem, type CustomerRecord } from "@desk/core";
import { AnthropicLlm, FakeLlm, fixtures, normalizeInput, processDocument, type LlmClient, type NormalizedDocument } from "@desk/extract";
import { GoldenCase } from "./golden.js";
import { aggregate, scoreCase, type Aggregate, type CaseScore } from "./scorer.js";

const here = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_ROOT = resolve(here, "..", "golden");
export const EVALS_DOC = resolve(here, "..", "..", "..", "docs", "EVALS.md");

export type RunOptions = {
  set: string;
  /** live = call the model; cached = use each case's cached extraction (offline, deterministic) */
  mode: "live" | "cached";
  /** Record live extraction outputs back into the case files as `cached` */
  record?: boolean;
  budgetUsdPerDoc: number;
  filter?: string | null;
  verbose?: boolean;
};

export type RunResult = { set: string; mode: string; scores: CaseScore[]; agg: Aggregate; gate: { pass: boolean; reasons: string[] } };

export async function loadSet(set: string): Promise<{ cases: Array<{ file: string; data: GoldenCase }>; items: CatalogItem[]; customers: CustomerRecord[] }> {
  const dir = join(GOLDEN_ROOT, set);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "catalog.json").sort();
  const catalogRaw = JSON.parse(await readFile(join(dir, "catalog.json"), "utf8")) as { items: CatalogItem[]; customers: CustomerRecord[] };
  const cases = [];
  for (const f of files) {
    const data = GoldenCase.parse(JSON.parse(await readFile(join(dir, f), "utf8")));
    cases.push({ file: join(dir, f), data });
  }
  return { cases, items: catalogRaw.items, customers: catalogRaw.customers };
}

export async function runEvals(opts: RunOptions): Promise<RunResult> {
  const { cases, items, customers } = await loadSet(opts.set);
  const selected = opts.filter ? cases.filter((c) => c.data.id.includes(opts.filter!) || c.data.tags.includes(opts.filter!)) : cases;
  const scores: CaseScore[] = [];

  for (const c of selected) {
    const dir = dirname(c.file);
    const attachments = [];
    for (const name of c.data.input.attachments) {
      attachments.push({ filename: name, bytes: new Uint8Array(await readFile(join(dir, name))) });
    }
    const doc: NormalizedDocument = await normalizeInput({
      source: "fixture",
      sender: c.data.input.sender,
      subject: c.data.input.subject,
      bodyText: c.data.input.bodyText,
      attachments,
    });

    let llm: LlmClient;
    if (opts.mode === "cached") {
      if (!c.data.cached) {
        scores.push(emptyScore(c.data, "no cached extraction; run with --live --record"));
        continue;
      }
      llm = new FakeLlm({ extraction: c.data.cached.extraction, usdPerCall: 0 });
    } else {
      llm = new AnthropicLlm();
    }

    const catalog = new InMemoryCatalog(items);
    const t0 = Date.now();
    let result;
    try {
      result = await processDocument(doc, {
        tenantId: c.data.tenant,
        llm,
        catalog,
        customers,
        validation: fixtures.validationFromCatalog(catalog, customers),
        skipClassify: true,
        useReranker: opts.mode === "live",
      });
    } catch (err) {
      scores.push(emptyScore(c.data, `pipeline error: ${err instanceof Error ? err.message : String(err)}`));
      continue;
    }
    const latencyMs = Date.now() - t0;

    if (opts.mode === "live" && opts.record && result.extraction) {
      const updated: GoldenCase = {
        ...c.data,
        cached: { extraction: result.extraction, model: result.drafts[0]?.meta.model ?? "unknown", promptVersion: result.drafts[0]?.meta.promptVersion ?? "unknown", recordedAt: new Date().toISOString() },
      };
      await writeFile(c.file, JSON.stringify(updated, null, 2) + "\n", "utf8");
    }

    const s = scoreCase({
      caseId: c.data.id,
      kind: c.data.kind,
      expected: c.data.expected,
      actual: { extraction: result.extraction, drafts: result.drafts, costUsd: result.cost.usd, latencyMs },
    });
    if (opts.verbose) {
      for (const f of s.header.fields.filter((f) => !f.correct)) s.notes.push(`header ${f.field}: expected ${JSON.stringify(f.expected)} got ${JSON.stringify(f.actual)}`);
    }
    scores.push(s);
  }

  const agg = aggregate(scores);
  const gate = evaluateGate(agg, opts);
  return { set: opts.set, mode: opts.mode, scores, agg, gate };
}

function emptyScore(c: GoldenCase, note: string): CaseScore {
  const s = scoreCase({ caseId: c.id, kind: c.kind, expected: c.expected, actual: { extraction: null, drafts: [], costUsd: 0, latencyMs: 0 } });
  s.notes.push(note);
  return s;
}

/**
 * Release gate (plan §7.3 #5, §7.5 Phase 1 done-criteria): field accuracy ≥ 95%, line-match ≥ 90%,
 * zero false auto-posts, cost per document under budget. Compared against the previous
 * recorded run in docs/EVALS.md when present (no regression).
 */
export function evaluateGate(agg: Aggregate, opts: Pick<RunOptions, "budgetUsdPerDoc" | "mode">, previous?: Aggregate | null): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (agg.cases === 0) reasons.push("no cases scored");
  if (agg.falseAutoPosts > 0) reasons.push(`${agg.falseAutoPosts} false auto-post(s)`);
  if (agg.headerFieldAcc < 0.95) reasons.push(`header field accuracy ${(agg.headerFieldAcc * 100).toFixed(1)}% < 95%`);
  if (agg.lineFieldAcc < 0.95) reasons.push(`line field accuracy ${(agg.lineFieldAcc * 100).toFixed(1)}% < 95%`);
  if (agg.matchAcc < 0.9) reasons.push(`match accuracy ${(agg.matchAcc * 100).toFixed(1)}% < 90%`);
  if (opts.mode === "live" && agg.meanCostUsd > opts.budgetUsdPerDoc) reasons.push(`mean cost $${agg.meanCostUsd.toFixed(3)} > budget $${opts.budgetUsdPerDoc}`);
  if (previous) {
    if (agg.headerFieldAcc < previous.headerFieldAcc - 0.005) reasons.push(`header accuracy regressed from ${(previous.headerFieldAcc * 100).toFixed(1)}%`);
    if (agg.lineFieldAcc < previous.lineFieldAcc - 0.005) reasons.push(`line accuracy regressed from ${(previous.lineFieldAcc * 100).toFixed(1)}%`);
    if (agg.matchAcc < previous.matchAcc - 0.005) reasons.push(`match accuracy regressed from ${(previous.matchAcc * 100).toFixed(1)}%`);
  }
  return { pass: reasons.length === 0, reasons };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function formatMarkdown(r: RunResult, meta: { date: string; promptVersions: string; model: string; gitRef: string }): string {
  const a = r.agg;
  const lines = [
    `## ${meta.date} — set \`${r.set}\` (${r.mode})`,
    ``,
    `- Prompts: ${meta.promptVersions} · Model: ${meta.model} · Ref: ${meta.gitRef}`,
    `- Gate: **${r.gate.pass ? "PASS" : "FAIL"}**${r.gate.reasons.length ? ` — ${r.gate.reasons.join("; ")}` : ""}`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Cases | ${a.cases} |`,
    `| Document type accuracy | ${pct(a.documentTypeAcc)} |`,
    `| Header field accuracy | ${pct(a.headerFieldAcc)} |`,
    `| Line recall | ${pct(a.lineRecall)} |`,
    `| Line field accuracy | ${pct(a.lineFieldAcc)} |`,
    `| Match accuracy | ${pct(a.matchAcc)} |`,
    `| Wrong-item rate | ${pct(a.wrongItemRate)} |`,
    `| Customer identification | ${a.customerAcc === null ? "n/a" : pct(a.customerAcc)} |`,
    `| False auto-posts | ${a.falseAutoPosts} |`,
    `| Mean cost / document | $${a.meanCostUsd.toFixed(4)} |`,
    `| P95 latency | ${(a.p95LatencyMs / 1000).toFixed(1)}s |`,
    ``,
    `| Kind | Cases | Header acc | Line acc | Match acc |`,
    `|---|---|---|---|---|`,
    ...Object.entries(a.byKind).map(([k, v]) => `| ${k} | ${v.cases} | ${pct(v.headerFieldAcc)} | ${pct(v.lineFieldAcc)} | ${pct(v.matchAcc)} |`),
  ];
  const failing = r.scores.filter((s) => s.notes.length || s.falseAutoPost);
  if (failing.length) {
    lines.push(``, `<details><summary>Cases with notes (${failing.length})</summary>`, ``);
    for (const s of failing) lines.push(`- \`${s.caseId}\`: ${s.notes.join("; ")}`);
    lines.push(``, `</details>`);
  }
  lines.push(``);
  return lines.join("\n");
}

export async function appendToEvalsDoc(markdown: string): Promise<void> {
  await mkdir(dirname(EVALS_DOC), { recursive: true });
  await appendFile(EVALS_DOC, "\n" + markdown, "utf8");
}
