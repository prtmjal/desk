import { describe, expect, it } from "vitest";
import { normalizePartNumber, partNumberVariants, tokenize, normalizeDimensions, normalizeDescription } from "../src/index.js";
import { similarity, coverage } from "../src/index.js";
import { normalizeUom, resolveUom, applyPackRules } from "../src/index.js";

describe("normalizePartNumber", () => {
  it("collapses punctuation and case", () => {
    expect(normalizePartNumber("thhn-12-blk/500")).toBe("THHN12BLK500");
    expect(normalizePartNumber("  ")).toBeNull();
    expect(normalizePartNumber(null)).toBeNull();
  });
});

describe("partNumberVariants", () => {
  it("strips common prefixes and pack suffixes, most specific first", () => {
    const v = partNumberVariants("P/N: ABC-123-CS");
    expect(v[0]).toBe("PNABC123CS");
    expect(v).toContain("ABC123CS");
    expect(v).toContain("ABC123");
  });
  it("drops leading zeros as a late variant", () => {
    expect(partNumberVariants("0001234")).toEqual(["0001234", "1234"]);
  });
  it("returns [] for empty", () => {
    expect(partNumberVariants(null)).toEqual([]);
  });
});

describe("tokenize / dimensions", () => {
  it("removes stopwords and keeps numbers", () => {
    expect(tokenize("Box of 12 Yellow Wire Connectors")).toEqual(["12", "yellow", "wire", "connectors"]);
  });
  it("normalizes fractions and inch marks", () => {
    expect(normalizeDimensions('3/4" EMT')).toBe("0.75in EMT");
    expect(normalizeDimensions('2-1/8" deep')).toBe("2.125in deep");
    expect(normalizeDimensions("10' stick")).toBe("10ft stick");
  });
  it("normalizeDescription is stable", () => {
    expect(normalizeDescription("THHN  12 AWG, Black")).toBe("thhn 12 awg black");
  });
});

describe("trigram", () => {
  it("is 1 for identical strings and 0 for disjoint", () => {
    expect(similarity("yellow wire nut", "yellow wire nut")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
  it("ranks closer strings higher", () => {
    const a = similarity("thhn 12 awg black", "thhn 12 awg stranded copper wire black 500ft spool");
    const b = similarity("thhn 12 awg black", "yellow wing wire connectors 100/box");
    expect(a).toBeGreaterThan(b);
  });
  it("coverage of a short query in a long text is high", () => {
    expect(coverage("gfci 20a white", "20a gfci receptacle white tamper resistant")).toBeGreaterThan(0.8);
  });
});

describe("uom", () => {
  it("normalizes synonyms", () => {
    expect(normalizeUom("each")).toBe("EA");
    expect(normalizeUom("Cases")).toBe("CS");
    expect(normalizeUom("bogus")).toBeNull();
  });
  it("resolves factors and rejects unknown units", () => {
    const pack = { baseUom: "EA", factors: { CS: 12 } };
    expect(resolveUom("cs", pack)).toMatchObject({ ok: true, factor: 12, erpUom: "EA" });
    expect(resolveUom("ea", pack)).toMatchObject({ ok: true, factor: 1 });
    expect(resolveUom(null, pack)).toMatchObject({ ok: true, factor: 1 });
    expect(resolveUom("pallet", pack).ok).toBe(false);
  });
  it("rounds up to multiples and raises to minimum", () => {
    expect(applyPackRules(25, { baseUom: "EA", multipleOf: 10 })).toMatchObject({ qty: 30, rounded: true });
    expect(applyPackRules(3, { baseUom: "EA", minQty: 5 })).toMatchObject({ qty: 5, rounded: true });
    expect(applyPackRules(20, { baseUom: "EA", multipleOf: 10 })).toMatchObject({ qty: 20, rounded: false });
  });
});
