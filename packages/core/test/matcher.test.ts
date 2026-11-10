import { describe, expect, it } from "vitest";
import { InMemoryCatalog, matchLine, type Reranker } from "../src/index";
import { ITEMS, line, str, num } from "./fixtures";

const catalog = () => new InMemoryCatalog(ITEMS);

describe("matchLine layers", () => {
  it("L0: exact SKU match regardless of punctuation", async () => {
    const r = await matchLine(line({ rawPartNumber: str("thhn 12 blk 500") }), { catalog: catalog(), customerId: null });
    expect(r.status).toBe("matched");
    expect(r.best?.method).toBe("L0_exact");
    expect(r.best?.sku).toBe("THHN-12-BLK-500");
  });

  it("L0: matches UPC and MPN, strips P/N prefix", async () => {
    const byUpc = await matchLine(line({ rawPartNumber: str("012345678929") }), { catalog: catalog(), customerId: null });
    expect(byUpc.best?.sku).toBe("EMT-075-10");
    const byMpn = await matchLine(line({ rawPartNumber: str("MFG# 30-074") }), { catalog: catalog(), customerId: null });
    expect(byMpn.best?.sku).toBe("WN-YEL-100");
  });

  it("L0 ignores inactive items", async () => {
    const r = await matchLine(line({ rawPartNumber: str("OLD-ITEM") }), { catalog: catalog(), customerId: null });
    expect(r.status).not.toBe("matched");
  });

  it("computes UoM factor from the item pack", async () => {
    const r = await matchLine(line({ rawPartNumber: str("THHN-12-BLK-500"), rawUom: str("CS") }), { catalog: catalog(), customerId: null });
    expect(r.uomFactor).toBe(4);
    expect(r.erpUom).toBe("EA");
  });

  it("L1: learned alias beats everything and carries uom factor", async () => {
    const c = catalog();
    await c.learnAlias({ customerId: "c1", rawPartKey: "CUST999", rawDescriptionKey: null, itemId: "i4", uomFactor: 10, hits: 1 });
    const r = await matchLine(line({ rawPartNumber: str("CUST-999") }), { catalog: c, customerId: "c1" });
    expect(r.status).toBe("matched");
    expect(r.best?.method).toBe("L1_alias");
    expect(r.best?.sku).toBe("WN-YEL-100");
    expect(r.uomFactor).toBe(10);
    // Different customer does not inherit the alias
    const other = await matchLine(line({ rawPartNumber: str("CUST-999") }), { catalog: c, customerId: "c2" });
    expect(other.best?.method).not.toBe("L1_alias");
  });

  it("L2: description-only line with a clear winner matches by trigram", async () => {
    const r = await matchLine(line({ rawDescription: str("20A GFCI receptacle, white, TR") }), { catalog: catalog(), customerId: null });
    expect(r.status).toBe("matched");
    expect(r.best?.method).toBe("L2_trigram");
    expect(r.best?.sku).toBe("GFCI-20-WH");
  });

  it("L2: abstains as ambiguous when two items are close (colour variants)", async () => {
    const r = await matchLine(line({ rawDescription: str("Wing wire connectors 100/box") }), { catalog: catalog(), customerId: null });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates.slice(0, 2).map((c) => c.sku).sort()).toEqual(["WN-RED-100", "WN-YEL-100"]);
    expect(r.best).toBeNull();
  });

  it("unknown part number with a description does not auto-accept L2", async () => {
    const r = await matchLine(line({ rawPartNumber: str("ZZ-NOT-OURS"), rawDescription: str("20A GFCI receptacle white tamper resistant") }), {
      catalog: catalog(),
      customerId: null,
    });
    expect(r.status).toBe("ambiguous");
    expect(r.candidates[0]?.sku).toBe("GFCI-20-WH");
  });

  it("L4: reranker resolves ambiguity when confident, else abstains", async () => {
    const confident: Reranker = { rerank: async ({ candidates }) => ({ itemId: candidates.find((c) => c.sku === "WN-RED-100")!.id, confidence: 0.93, reason: "PO says red" }) };
    const r = await matchLine(line({ rawDescription: str("Wing wire connectors 100/box"), notes: str("red ones as usual") }), {
      catalog: catalog(),
      customerId: null,
      reranker: confident,
    });
    expect(r.status).toBe("matched");
    expect(r.best?.method).toBe("L4_llm");
    expect(r.best?.sku).toBe("WN-RED-100");

    const unsure: Reranker = { rerank: async () => ({ itemId: null, confidence: 0.3, reason: "colour not stated" }) };
    const r2 = await matchLine(line({ rawDescription: str("Wing wire connectors 100/box") }), { catalog: catalog(), customerId: null, reranker: unsure });
    expect(r2.status).toBe("ambiguous");
    expect(r2.abstainReason).toBe("colour not stated");
  });

  it("unmatched when nothing resembles the line; skipped when the line is empty", async () => {
    const r = await matchLine(line({ rawDescription: str("Frozen pizza pepperoni") }), { catalog: catalog(), customerId: null });
    expect(r.status).toBe("unmatched");
    const s = await matchLine(line({ quantity: num(3) }), { catalog: catalog(), customerId: null });
    expect(s.status).toBe("skipped");
  });
});
