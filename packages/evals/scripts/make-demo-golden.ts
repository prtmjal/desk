/**
 * Generates the `golden/demo` set: a small, synthetic, fully-labeled set with cached
 * extraction outputs so `pnpm evals` runs offline in CI. Real tenant golden sets are built
 * from confirmed orders (plan §6.6: first 50 confirmed orders per tenant) via the app.
 *
 *   pnpm --filter @desk/evals exec tsx scripts/make-demo-golden.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtures } from "@desk/extract";
import type { GoldenCase } from "../src/golden.js";

const { DEMO_ITEMS, DEMO_CUSTOMERS, extractedLine, extractedOrder, extraction } = fixtures;
const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", "golden", "demo");
await mkdir(out, { recursive: true });

await writeFile(join(out, "catalog.json"), JSON.stringify({ items: DEMO_ITEMS, customers: DEMO_CUSTOMERS }, null, 2) + "\n");

const recorded = { model: "synthetic", promptVersion: "extract-order.v1", recordedAt: "2026-11-07T00:00:00.000Z" };

// Case 1: clean CSV PO, every line exact.
const csv1 = [
  "PO Number,PO-4471,,,",
  "Date,2026-11-05,,,",
  "Ship to,Acme Electric Contractors,100 Industrial Pkwy,Dallas TX 75201,",
  "Line,Part,Description,Qty,UoM,Price",
  "1,THHN-12-BLK-500,12 AWG THHN black 500ft,2,CS,358.00",
  "2,GFCI-20-WH,20A GFCI receptacle white TR,10,EA,18.90",
  "3,012345678950,4in square box deep,100,EA,2.40",
].join("\n");
await writeFile(join(out, "po-001.csv"), csv1);
const ex1 = extraction([
  extractedOrder({
    po: "PO-4471",
    customerName: "Acme Electric Contractors",
    email: null,
    subtotal: null,
    lines: [
      extractedLine(1, { part: "THHN-12-BLK-500", desc: "12 AWG THHN black 500ft", qty: 2, uom: "CS", price: 358 }),
      extractedLine(2, { part: "GFCI-20-WH", desc: "20A GFCI receptacle white TR", qty: 10, uom: "EA", price: 18.9 }),
      extractedLine(3, { part: "012345678950", desc: "4in square box deep", qty: 100, uom: "EA", price: 2.4 }),
    ],
  }),
]);
const case1: GoldenCase = {
  id: "demo-001-clean-csv",
  kind: "excel",
  tenant: "demo",
  tags: ["exact", "multi-line"],
  input: { sender: "purchasing@acmeelectric.com", subject: "PO 4471", bodyText: null, attachments: ["po-001.csv"] },
  expected: { extraction: ex1, matches: { "1": "i1", "2": "i8", "3": "i6" }, customerId: "c1", safeToAutoPost: true },
  cached: { extraction: ex1, ...recorded, rerank: {} },
};

// Case 2: email body only, description-only lines, one ambiguous (colour missing) → must abstain.
const body2 = ["Hi,", "", "Please send:", "- 3 boxes wing wire connectors 100/box", "- 5 spools THHN 12 red 500'", "", "Ship to our Dallas yard. Net 30 as usual.", "Thanks, Pat"].join("\n");
const ex2 = extraction([
  extractedOrder({
    po: null,
    customerName: null,
    email: "pat@brightlights.com",
    lines: [
      extractedLine(1, { desc: "wing wire connectors 100/box", qty: 3, uom: "boxes" }),
      extractedLine(2, { desc: "THHN 12 red 500'", qty: 5, uom: "spools" }),
    ],
  }),
]);
const case2: GoldenCase = {
  id: "demo-002-email-body-ambiguous",
  kind: "email_body",
  tenant: "demo",
  tags: ["abstain", "no-po-number"],
  input: { sender: "pat@brightlights.com", subject: "order", bodyText: body2, attachments: [] },
  expected: { extraction: ex2, matches: { "1": null, "2": "i2" }, customerId: "c2", safeToAutoPost: false },
  cached: { extraction: ex2, ...recorded, rerank: {} },
};

// Case 3: adversarial — a quote request that looks like an order; must not become an order.
const body3 = "Can you quote 500 ea 3/4 EMT 10' and 20 boxes yellow wing nuts? Need pricing by Friday, not ordering yet.";
const ex3 = extraction(
  [
    extractedOrder({
      po: null,
      customerName: null,
      email: "buyer@acmeelectric.com",
      lines: [extractedLine(1, { desc: "3/4 EMT 10'", qty: 500, uom: "ea" }), extractedLine(2, { desc: "yellow wing nuts", qty: 20, uom: "boxes" })],
    }),
  ],
  "quote_request",
);
const case3: GoldenCase = {
  id: "demo-003-quote-not-order",
  kind: "adversarial",
  tenant: "demo",
  tags: ["classification"],
  input: { sender: "buyer@acmeelectric.com", subject: "pricing", bodyText: body3, attachments: [] },
  expected: { extraction: ex3, matches: { "1": "i3", "2": "i4" }, customerId: "c1", safeToAutoPost: false },
  // Description-only lines sit below the L2 accept threshold on purpose; the recorded L4 answers resolve them.
  cached: {
    extraction: ex3,
    ...recorded,
    rerank: {
      "1": { itemId: "i3", confidence: 0.93, reason: "3/4 EMT in 10 ft lengths is EMT-075-10" },
      "2": { itemId: "i4", confidence: 0.9, reason: "Yellow wing connectors; 'wing nuts' is trade slang for them" },
    },
  },
};

// Case 4: pack rounding + duplicate-looking PO + price mismatch (needs review, never auto-post).
const csv4 = ["PO,PO-4471-R1", "Part,Qty,UoM,Price", "EMT-075-10,25,EA,5.00", "WN-RED-100,2,CS,70.00"].join("\n");
await writeFile(join(out, "po-004.csv"), csv4);
const ex4 = extraction([
  extractedOrder({
    po: "PO-4471-R1",
    customerName: "Acme Electric Contractors",
    lines: [extractedLine(1, { part: "EMT-075-10", qty: 25, uom: "EA", price: 5 }), extractedLine(2, { part: "WN-RED-100", qty: 2, uom: "CS", price: 70 })],
  }),
]);
const case4: GoldenCase = {
  id: "demo-004-pack-and-price",
  kind: "excel",
  tenant: "demo",
  tags: ["price-mismatch", "pack-rounding"],
  input: { sender: "purchasing@acmeelectric.com", subject: "Revised PO 4471", bodyText: "Revised PO attached, price per our contract.", attachments: ["po-004.csv"] },
  expected: { extraction: ex4, matches: { "1": "i3", "2": "i5" }, customerId: "c1", safeToAutoPost: false },
  cached: { extraction: ex4, ...recorded, rerank: {} },
};

for (const c of [case1, case2, case3, case4]) {
  await writeFile(join(out, `${c.id}.json`), JSON.stringify(c, null, 2) + "\n");
}
console.log(`wrote 4 cases to ${out}`);
