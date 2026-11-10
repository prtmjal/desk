import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { OrderDraft } from "@desk/core";
import { CsvConnector, MockConnector, draftToSalesOrderCsv, parseCustomersCsv, parseItemsCsv, ConnectorValidationError } from "../src/index.js";

const str = (value: string | null) => ({ value, confidence: 0.95, provenance: null });
const num = (value: number | null) => ({ value, confidence: 0.95, provenance: null });
const addr = { name: str("Acme"), attention: str(null), line1: str('1 "Main" St'), line2: str(null), city: str("Austin"), region: str("TX"), postalCode: str("78701"), country: str("US") };

const draft: OrderDraft = {
  id: "d1",
  tenantId: "t1",
  documentId: "doc1",
  documentType: "order",
  status: "confirmed",
  customer: { customerId: "c1", name: "Acme Electric", method: "domain", confidence: 0.97, candidates: [] },
  header: {
    poNumber: str("PO-1"), orderDate: str("2026-11-05"), requestedShipDate: str(null),
    customer: { name: str("Acme"), accountNumber: str(null), contactName: str(null), email: str(null), phone: str(null) },
    billTo: addr, shipTo: addr, paymentTerms: str("Net 30"), shippingMethod: str(null), currency: str("USD"),
    subtotal: num(null), tax: num(null), freight: num(null), total: num(null), specialInstructions: str(null), pageRange: null,
  },
  lines: [
    {
      lineNo: 1, customerLineRef: str(null), rawPartNumber: str("CUST-1"), rawDescription: str("Wire"), quantity: num(2), rawUom: str("CS"), unitPrice: num(358), extendedPrice: num(716), requestedDate: str(null), notes: str(null),
      match: { status: "matched", best: { itemId: "i1", sku: "THHN-12-BLK-500", description: "THHN 12 AWG Black", method: "L0_exact", score: 1, evidence: "" }, candidates: [], uomFactor: 4, erpUom: "EA", abstainReason: null },
      normalizedPartNumber: "CUST1", erpQuantity: 8, listPrice: 89.5, priceDeltaPct: 0, issues: [],
    },
  ],
  issues: [],
  confidence: { header: 0.95, lines: 0.95, overall: 0.95 },
  autoPost: { eligible: false, reasons: [] },
  meta: { extractorVersion: "0.1.0", promptVersion: "extract-order.v1", model: "fake", createdAt: "2026-11-07T00:00:00Z", cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, calls: 0 }, warnings: [] },
};

describe("draftToSalesOrderCsv", () => {
  it("writes one row per line in ERP UoM with per-base-unit price and escapes quotes", () => {
    const csv = draftToSalesOrderCsv(draft, "ext-1");
    const [header, row] = csv.trim().split("\r\n");
    expect(header!.startsWith("ExternalId,CustomerId,CustomerName,PONumber")).toBe(true);
    expect(row).toContain('"1 ""Main"" St"');
    expect(row).toContain(",THHN-12-BLK-500,");
    expect(row).toContain(",8,EA,89.5000,CUST-1,");
  });
});

describe("MockConnector", () => {
  it("is idempotent on the key and rejects drafts with unmatched lines", async () => {
    const mock = new MockConnector({ items: [], customers: [] });
    const a = await mock.createSalesOrder(draft, { idempotencyKey: "k1" });
    const b = await mock.createSalesOrder(draft, { idempotencyKey: "k1" });
    expect(a.erpOrderId).toBe(b.erpOrderId);
    expect(mock.posted.size).toBe(1);
    const bad: OrderDraft = { ...draft, lines: [{ ...draft.lines[0]!, match: { ...draft.lines[0]!.match, status: "ambiguous", best: null } }] };
    await expect(mock.createSalesOrder(bad, { idempotencyKey: "k2" })).rejects.toBeInstanceOf(ConnectorValidationError);
  });
});

describe("CsvConnector", () => {
  let dir = "";
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  it("writes a CSV file once per key", async () => {
    dir = await mkdtemp(join(tmpdir(), "desk-csv-"));
    const c = new CsvConnector({ outDir: dir, items: [], customers: [] });
    const r1 = await c.createSalesOrder(draft, { idempotencyKey: "order/1" });
    const r2 = await c.createSalesOrder(draft, { idempotencyKey: "order/1" });
    expect(r1.url).toBe(r2.url);
    const text = await readFile(r1.url!, "utf8");
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(2);
  });
});

describe("CSV master parsers", () => {
  it("parses items with loose headers and pack sizes", () => {
    const items = parseItemsCsv([
      ["Item Number", "UPC", "Mfg Part", "Description", "Unit", "Case Qty", "List Price", "Inactive"],
      ["WN-YEL-100", "012345678936", "30-074", "Yellow wing nuts 100/bx", "BX", "10", "$7.25", "N"],
      ["OLD", "", "", "Old thing", "EA", "", "1", "Y"],
      ["", "", "", "blank row", "", "", "", ""],
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ sku: "WN-YEL-100", upc: "012345678936", mpn: "30-074", active: true, listPrice: 7.25, pack: { baseUom: "BX", factors: { CS: 10 } } });
    expect(items[1]?.active).toBe(false);
  });
  it("parses customers and derives domains from emails/websites", () => {
    const customers = parseCustomersCsv([
      ["Customer ID", "Company Name", "Email", "Website", "Status"],
      ["C100", "Acme Electric", "ap@acmeelectric.com; po@acmeelectric.com", "https://www.acmeelectric.com", "Active"],
    ]);
    expect(customers[0]).toMatchObject({ id: "C100", name: "Acme Electric", domains: ["acmeelectric.com"], active: true });
  });
});
