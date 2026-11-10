/**
 * Inspect and normalize an item-master CSV export before a replay or a tenant import.
 *   pnpm import-items --file items.csv [--out items.json]
 * Prints coverage stats that predict match quality: % with UPC, % with MPN, duplicate SKUs, empty descriptions.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { normalizePartNumber } from "@desk/core";
import { parseItemsCsv } from "@desk/erp";
import { parseCsvRows } from "@desk/extract";

const { values } = parseArgs({ options: { file: { type: "string" }, out: { type: "string" } } });
if (!values.file) {
  console.error("--file <items.csv> required");
  process.exit(2);
}
const rows = parseCsvRows(await readFile(resolve(values.file), "utf8"));
const items = parseItemsCsv(rows);
const keys = new Map<string, number>();
for (const i of items) {
  const k = normalizePartNumber(i.sku);
  if (k) keys.set(k, (keys.get(k) ?? 0) + 1);
}
const dupes = [...keys.entries()].filter(([, n]) => n > 1);
const pct = (n: number) => `${((n / Math.max(1, items.length)) * 100).toFixed(0)}%`;
console.log(`items: ${items.length}`);
console.log(`active: ${items.filter((i) => i.active).length}`);
console.log(`with UPC: ${pct(items.filter((i) => i.upc).length)}  with MPN: ${pct(items.filter((i) => i.mpn).length)}  with price: ${pct(items.filter((i) => i.listPrice != null).length)}`);
console.log(`empty/short descriptions: ${items.filter((i) => i.description.length < 8).length}`);
console.log(`SKUs that collide after normalization: ${dupes.length}${dupes.length ? ` (e.g. ${dupes.slice(0, 5).map(([k]) => k).join(", ")})` : ""}`);
console.log(`UoMs: ${[...new Set(items.map((i) => i.pack.baseUom))].join(", ")}`);
if (values.out) {
  await writeFile(resolve(values.out), JSON.stringify(items, null, 2));
  console.log(`wrote ${values.out}`);
}
