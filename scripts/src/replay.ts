/**
 * Replay one or more PO documents through the pipeline against a tenant's exported
 * item/customer CSVs and write drafts + a prospect report (plan §5.4, §7.5 Phase 1).
 *
 *   pnpm replay --tenant acme --items ./acme/items.csv --customers ./acme/customers.csv \
 *               --file ./acme/pos/PO-1.pdf --file ./acme/pos/PO-2.xlsx --out ./acme/out \
 *               [--dir ./acme/pos] [--sender buyer@acme.com] [--report "Acme Electric"] [--no-rerank] [--classify]
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { InMemoryCatalog, type OrderDraft } from "@desk/core";
import { parseCustomersCsv, parseItemsCsv } from "@desk/erp";
import { AnthropicLlm, fixtures, normalizeInput, parseCsvRows, processDocument } from "@desk/extract";
import { buildProspectReport } from "@desk/evals";

const { values } = parseArgs({
  options: {
    tenant: { type: "string", default: "replay" },
    items: { type: "string" },
    customers: { type: "string" },
    file: { type: "string", multiple: true, default: [] },
    dir: { type: "string" },
    out: { type: "string", default: "./replay-out" },
    sender: { type: "string" },
    report: { type: "string" },
    erp: { type: "string" },
    "no-rerank": { type: "boolean", default: false },
    classify: { type: "boolean", default: false },
  },
});

if (!values.items) fail("--items <items.csv> is required (export from the ERP; columns like SKU, Description, UPC, MPN, UoM, Price)");

const items = parseItemsCsv(parseCsvRows(await readFile(resolve(values.items!), "utf8")));
const customers = values.customers ? parseCustomersCsv(parseCsvRows(await readFile(resolve(values.customers), "utf8"))) : [];
const catalog = new InMemoryCatalog(items);
console.error(`Loaded ${items.length} items (${items.filter((i) => i.upc).length} with UPC, ${items.filter((i) => i.mpn).length} with MPN) and ${customers.length} customers`);

const files = [...(values.file ?? [])];
if (values.dir) {
  for (const f of await readdir(resolve(values.dir))) {
    if ([".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".csv", ".txt", ".docx", ".eml", ".html"].includes(extname(f).toLowerCase())) files.push(join(values.dir, f));
  }
}
if (files.length === 0) fail("no input files: pass --file or --dir");

const outDir = resolve(values.out!);
await mkdir(outDir, { recursive: true });
const llm = new AnthropicLlm();
const drafts: OrderDraft[] = [];
const skipped: Array<{ filename: string; reason: string }> = [];
let totalCost = 0;

console.error(`\n${"file".padEnd(32)} ${"type".padEnd(14)} ${"cust".padEnd(6)} lines matched ambig unmatched errors  cost   ms`);
for (const f of files) {
  const bytes = new Uint8Array(await readFile(resolve(f)));
  const doc = await normalizeInput({ source: "upload", sender: values.sender ?? null, subject: basename(f), attachments: [{ filename: basename(f), bytes }] });
  if (doc.parts.length === 0) {
    skipped.push({ filename: basename(f), reason: doc.rejected[0]?.reason ?? "no readable content" });
    console.error(`${basename(f).padEnd(32)} SKIPPED ${doc.rejected[0]?.reason ?? ""}`);
    continue;
  }
  const t0 = Date.now();
  try {
    const r = await processDocument(doc, {
      tenantId: values.tenant!,
      llm,
      catalog,
      customers,
      validation: fixtures.validationFromCatalog(catalog, customers),
      skipClassify: !values.classify,
      useReranker: !values["no-rerank"],
    });
    totalCost += r.cost.usd;
    await writeFile(join(outDir, `${basename(f)}.result.json`), JSON.stringify(r, null, 2));
    if (r.drafts.length === 0) {
      skipped.push({ filename: basename(f), reason: `classified as ${r.classification?.documentType ?? r.extraction?.documentType ?? "unknown"}` });
    }
    for (const d of r.drafts) {
      drafts.push(d);
      const m = d.lines.filter((l) => l.match.status === "matched").length;
      const a = d.lines.filter((l) => l.match.status === "ambiguous").length;
      const u = d.lines.filter((l) => l.match.status === "unmatched").length;
      const e = d.issues.filter((i) => i.severity === "error").length + d.lines.reduce((n, l) => n + l.issues.filter((i) => i.severity === "error").length, 0);
      console.error(
        `${basename(f).slice(0, 31).padEnd(32)} ${d.documentType.padEnd(14)} ${(d.customer.customerId ? "yes" : "no").padEnd(6)} ${String(d.lines.length).padStart(5)} ${String(m).padStart(7)} ${String(a).padStart(5)} ${String(u).padStart(9)} ${String(e).padStart(6)} $${d.meta.cost.usd.toFixed(3)} ${String(Date.now() - t0).padStart(5)}`,
      );
    }
  } catch (err) {
    skipped.push({ filename: basename(f), reason: err instanceof Error ? err.message : String(err) });
    console.error(`${basename(f).padEnd(32)} ERROR ${err instanceof Error ? err.message : String(err)}`);
  }
}

await writeFile(join(outDir, "drafts.json"), JSON.stringify(drafts, null, 2));
if (values.report) {
  const md = buildProspectReport({ company: values.report, erp: values.erp ?? null, drafts, skipped, totalCostUsd: totalCost });
  await writeFile(join(outDir, "report.md"), md);
  console.error(`\nReport written to ${join(outDir, "report.md")}`);
}
console.error(`\n${drafts.length} drafts, ${skipped.length} skipped, total model cost $${totalCost.toFixed(3)} → ${outDir}`);

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}
