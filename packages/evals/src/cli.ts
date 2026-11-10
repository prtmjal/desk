import { parseArgs } from "node:util";
import { execSync } from "node:child_process";
import { loadPrompt } from "@desk/extract";
import { appendToEvalsDoc, formatMarkdown, runEvals } from "./runner.js";

/**
 * pnpm evals [--set demo] [--live] [--record] [--filter x] [--budget 0.15] [--write] [--verbose]
 * Default is offline (cached extraction outputs) so CI never spends money or needs a key.
 */
const { values } = parseArgs({
  options: {
    set: { type: "string", default: "demo" },
    live: { type: "boolean", default: false },
    record: { type: "boolean", default: false },
    filter: { type: "string" },
    budget: { type: "string", default: process.env.DESK_MODEL_BUDGET_USD_PER_DOC ?? "0.15" },
    write: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const live = values.live && !!process.env.ANTHROPIC_API_KEY;
if (values.live && !live) console.error("ANTHROPIC_API_KEY not set; running in cached mode instead.");

const result = await runEvals({
  set: values.set!,
  mode: live ? "live" : "cached",
  record: values.record,
  budgetUsdPerDoc: Number(values.budget),
  filter: values.filter ?? null,
  verbose: values.verbose,
});

let gitRef = "uncommitted";
try {
  gitRef = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git repo yet */
}

const md = formatMarkdown(result, {
  date: new Date().toISOString().slice(0, 10),
  promptVersions: ["extract-order", "classify", "rerank"].map((n) => loadPrompt(n as "extract-order").version).join(", "),
  model: live ? (process.env.DESK_EXTRACT_MODEL ?? "claude-opus-5-5") : "cached",
  gitRef,
});
console.log(md);
if (values.write) {
  await appendToEvalsDoc(md);
  console.log("Appended to docs/EVALS.md");
}
if (!result.gate.pass) {
  console.error(`EVAL GATE FAILED: ${result.gate.reasons.join("; ")}`);
  process.exit(1);
}
