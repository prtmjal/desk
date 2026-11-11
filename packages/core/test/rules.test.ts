import { describe, expect, it } from "vitest";
import {
  InMemoryCatalog,
  matchLine,
  validateLine,
  validateHeader,
  evaluateAutoPost,
  lineConfidence,
  headerConfidence,
  DEFAULT_AUTOPOST,
  type ValidationContext,
  type DraftLine,
  type OrderHeader,
  type CustomerMatch,
} from "../src/index";
import { ITEMS, line, str, num } from "./fixtures";

const catalog = new InMemoryCatalog(ITEMS);
const ctx: ValidationContext = {
  getItem: (id) => catalog.getById(id),
  getPrice: async (_c, id) => (await catalog.getById(id))?.listPrice ?? null,
  getStock: async (id) => (id === "i3" ? 15 : 1000),
  isDuplicatePo: async (_c, po) => po === "DUP-1",
  customerOnCreditHold: async (id) => id === "c-hold",
};
const known: CustomerMatch = { customerId: "c1", name: "Acme", method: "domain", confidence: 0.97, candidates: [] };

async function draftLine(partial: Parameters<typeof line>[0]): Promise<DraftLine> {
  const l = line(partial);
  const match = await matchLine(l, { catalog, customerId: null });
  return { ...l, match, normalizedPartNumber: null, erpQuantity: null, listPrice: null, priceDeltaPct: null, issues: [] };
}

function header(partial: Partial<{ po: string | null; subtotal: number | null }> = {}): OrderHeader {
  const addr = { name: str("Acme"), attention: str(null, 0), line1: str("1 Main St"), line2: str(null, 0), city: str("Austin"), region: str("TX"), postalCode: str("78701"), country: str("US") };
  return {
    poNumber: str(partial.po === undefined ? "PO-100" : partial.po, 0.99),
    orderDate: str("2026-11-07"),
    requestedShipDate: str(null, 0),
    customer: { name: str("Acme Electric"), accountNumber: str(null, 0), contactName: str(null, 0), email: str("po@acmeelectric.com"), phone: str(null, 0) },
    billTo: addr,
    shipTo: addr,
    paymentTerms: str("Net 30"),
    shippingMethod: str(null, 0),
    currency: str("USD"),
    subtotal: num(partial.subtotal === undefined ? null : partial.subtotal, partial.subtotal === undefined ? 0 : 0.95),
    tax: num(null, 0),
    freight: num(null, 0),
    total: num(null, 0),
    specialInstructions: str(null, 0),
    pageRange: null,
  };
}

describe("validateLine", () => {
  it("passes a clean exact-match line and computes ERP quantity", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("THHN-12-BLK-500"), quantity: num(2), rawUom: str("CS"), unitPrice: num(358) }), known, ctx);
    expect(l.erpQuantity).toBe(8);
    expect(l.listPrice).toBe(89.5);
    expect(l.priceDeltaPct).toBeCloseTo(0, 5);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("flags price mismatch beyond tolerance", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), quantity: num(5), unitPrice: num(15) }), known, ctx);
    expect(l.issues.some((i) => i.code === "PRICE_MISMATCH")).toBe(true);
  });

  it("applies pack rounding and stock short", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("EMT-075-10"), quantity: num(25) }), known, ctx);
    expect(l.erpQuantity).toBe(30);
    expect(l.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["PACK_ROUNDING", "STOCK_SHORT"]));
  });

  it("flags unknown UoM and ambiguous items as errors", async () => {
    const bad = await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), rawUom: str("pallet") }), known, ctx);
    expect(bad.issues.some((i) => i.code === "UOM_UNKNOWN" && i.severity === "error")).toBe(true);
    const amb = await validateLine(await draftLine({ rawDescription: str("Wing wire connectors 100/box") }), known, ctx);
    expect(amb.issues.some((i) => i.code === "ITEM_AMBIGUOUS")).toBe(true);
  });
});

describe("validateHeader", () => {
  it("flags unknown customer, duplicate PO, totals mismatch", async () => {
    const lines = [await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), quantity: num(2), unitPrice: num(18.9), extendedPrice: num(37.8) }), known, ctx)];
    const unknown: CustomerMatch = { customerId: null, name: null, method: "none", confidence: 0, candidates: [] };
    const issues = await validateHeader(header({ po: "DUP-1", subtotal: 100 }), unknown, lines, ctx);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["CUSTOMER_UNKNOWN", "DUPLICATE_PO", "TOTALS_MISMATCH"]));
    const clean = await validateHeader(header({ subtotal: 37.8 }), known, lines, ctx);
    expect(clean.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("evaluateAutoPost", () => {
  it("is never eligible with the default (disabled, shadow) policy", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), quantity: num(2), unitPrice: num(18.9) }), known, ctx);
    const d = evaluateAutoPost({ lines: [l], headerIssues: [], headerConfidence: 0.98, lineConfidences: [lineConfidence(l)], documentType: "order" });
    expect(d.eligible).toBe(false);
    expect(d.reasons.join(" ")).toMatch(/disabled/);
  });

  it("is eligible when enabled, live, every line exact, in tolerance", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), quantity: num(2), unitPrice: num(18.9) }), known, ctx);
    const policy = { ...DEFAULT_AUTOPOST, enabled: true, shadowMode: false };
    const d = evaluateAutoPost({ lines: [l], headerIssues: [], headerConfidence: headerConfidence(header()), lineConfidences: [lineConfidence(l)], documentType: "order" }, policy);
    expect(d.reasons).toEqual([]);
    expect(d.eligible).toBe(true);
  });

  it("blocks on L4 matches, price deltas and error issues", async () => {
    const l = await validateLine(await draftLine({ rawPartNumber: str("GFCI-20-WH"), quantity: num(2), unitPrice: num(10) }), known, ctx);
    const policy = { ...DEFAULT_AUTOPOST, enabled: true, shadowMode: false };
    const d = evaluateAutoPost({ lines: [l], headerIssues: [], headerConfidence: 0.99, lineConfidences: [0.99], documentType: "order" }, policy);
    expect(d.eligible).toBe(false);
    expect(d.reasons.some((r) => r.includes("price delta"))).toBe(true);
  });
});
