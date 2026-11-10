import { describe, expect, it } from "vitest";
import { InMemoryCatalog, DEFAULT_AUTOPOST } from "@desk/core";
import { FakeLlm, processDocument, fixtures, loadPrompt, renderPrompt, type NormalizedDocument } from "../src/index.js";

const { DEMO_ITEMS, DEMO_CUSTOMERS, extractedLine, extractedOrder, extraction, validationFromCatalog } = fixtures;

const doc: NormalizedDocument = {
  id: "doc-1",
  source: "email",
  sender: "orders@acmeelectric.com",
  subject: "PO 4471",
  receivedAt: "2026-11-05T14:00:00Z",
  parts: [{ kind: "text", label: "email body", text: "Please process attached PO." }],
  rejected: [],
};

function deps(llm: FakeLlm, overrides: Partial<Parameters<typeof processDocument>[1]> = {}) {
  const catalog = new InMemoryCatalog(DEMO_ITEMS);
  return { tenantId: "t1", llm, catalog, customers: DEMO_CUSTOMERS, validation: validationFromCatalog(catalog, DEMO_CUSTOMERS), ...overrides };
}

describe("processDocument", () => {
  it("produces a draft with matched lines, identified customer and accumulated cost", async () => {
    const llm = new FakeLlm({
      extraction: extraction([
        extractedOrder({
          customerName: "Acme Electric",
          lines: [
            extractedLine(1, { part: "THHN-12-BLK-500", desc: "12 AWG THHN black", qty: 2, uom: "CS", price: 358, ext: 716 }),
            extractedLine(2, { desc: "20A GFCI receptacle white TR", qty: 10, uom: "EA", price: 18.9, ext: 189 }),
          ],
          subtotal: 905,
        }),
      ]),
    });
    const r = await processDocument(doc, deps(llm));
    expect(r.classification?.documentType).toBe("order");
    expect(r.drafts).toHaveLength(1);
    const d = r.drafts[0]!;
    expect(d.customer.customerId).toBe("c1");
    expect(d.lines[0]?.match.best?.sku).toBe("THHN-12-BLK-500");
    expect(d.lines[0]?.erpQuantity).toBe(8);
    expect(d.lines[1]?.match.best?.sku).toBe("GFCI-20-WH");
    expect(d.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(d.autoPost.eligible).toBe(false); // default policy: disabled + shadow
    expect(d.status).toBe("new");
    expect(r.cost.calls).toBe(2);
    expect(d.meta.cost.usd).toBeCloseTo(r.cost.usd, 10);
    expect(d.meta.promptVersion).toBe("extract-order.v1");
    expect(llm.calls).toEqual({ classify: 1, extract: 1, rerank: 0 });
  });

  it("short-circuits confident non-orders before extraction", async () => {
    const llm = new FakeLlm({
      classification: { documentType: "spam", confidence: 0.99, hasAttachments: false, estimatedOrderCount: null, rationale: "newsletter" },
      extraction: extraction([]),
    });
    const r = await processDocument(doc, deps(llm));
    expect(r.drafts).toEqual([]);
    expect(r.extraction).toBeNull();
    expect(llm.calls.extract).toBe(0);
  });

  it("calls the re-ranker only for ambiguous lines and marks the draft needs_review when it abstains", async () => {
    const llm = new FakeLlm({
      extraction: extraction([extractedOrder({ customerName: "Acme Electric", lines: [extractedLine(1, { desc: "Wing wire connectors 100/box", qty: 3, uom: "BX" })] })]),
      rerank: () => ({ itemId: null, confidence: 0.4, reason: "colour not stated" }),
    });
    const r = await processDocument(doc, deps(llm));
    const d = r.drafts[0]!;
    expect(llm.calls.rerank).toBe(1);
    expect(d.lines[0]?.match.status).toBe("ambiguous");
    expect(d.lines[0]?.issues.map((i) => i.code)).toContain("ITEM_AMBIGUOUS");
    expect(d.status).toBe("needs_review");
    expect(r.cost.calls).toBe(3);
  });

  it("confirms automatically when policy allows and everything is exact", async () => {
    const llm = new FakeLlm({
      extraction: extraction([extractedOrder({ customerName: "Acme Electric", lines: [extractedLine(1, { part: "GFCI-20-WH", qty: 4, uom: "EA", price: 18.9, ext: 75.6 })], subtotal: 75.6 })]),
    });
    const r = await processDocument(doc, deps(llm, { skipClassify: true, autoPostPolicy: { ...DEFAULT_AUTOPOST, enabled: true, shadowMode: false } }));
    const d = r.drafts[0]!;
    expect(d.autoPost.reasons).toEqual([]);
    expect(d.status).toBe("confirmed");
    expect(r.classification).toBeNull();
  });

  it("splits multi-order documents into separate drafts and flags duplicates", async () => {
    const llm = new FakeLlm({
      extraction: extraction([
        extractedOrder({ po: "PO-1", customerName: "Acme Electric", lines: [extractedLine(1, { part: "GFCI-20-WH", qty: 1 })] }),
        extractedOrder({ po: "PO-2", customerName: "Acme Electric", lines: [extractedLine(1, { part: "EMT-075-10", qty: 25 })] }),
      ]),
    });
    const catalog = new InMemoryCatalog(DEMO_ITEMS);
    const r = await processDocument(doc, deps(llm, { validation: validationFromCatalog(catalog, DEMO_CUSTOMERS, { existingPos: new Set(["c1:PO-2"]) }) }));
    expect(r.drafts.map((d) => d.header.poNumber.value)).toEqual(["PO-1", "PO-2"]);
    expect(r.drafts[1]?.issues.map((i) => i.code)).toContain("DUPLICATE_PO");
    expect(r.drafts[1]?.lines[0]?.erpQuantity).toBe(30);
    expect(r.drafts[0]!.meta.cost.usd + r.drafts[1]!.meta.cost.usd).toBeCloseTo(r.cost.usd, 10);
  });
});

describe("prompts", () => {
  it("loads versioned prompts with front matter", () => {
    const p = loadPrompt("extract-order");
    expect(p.version).toBe("extract-order.v1");
    expect(p.body).toMatch(/Flagging beats guessing/);
    expect(loadPrompt("classify").version).toBe("classify.v1");
    expect(loadPrompt("rerank").version).toBe("rerank.v1");
  });
  it("renderPrompt fails loudly on missing variables", () => {
    expect(renderPrompt("Hello {{ name }}", { name: "x" })).toBe("Hello x");
    expect(() => renderPrompt("Hello {{missing}}", {})).toThrow(/missing/);
  });
});
