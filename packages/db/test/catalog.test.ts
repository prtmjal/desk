import { normalizeDescription, normalizePartNumber, partNumberVariants, type CatalogIndex } from "@desk/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgCatalogIndex } from "../src/catalog.js";
import { withTenant } from "../src/client.js";
import { DEMO_ITEMS, seedDemo, type SeedResult } from "../src/seed.js";
import { createTestDb, type TestContext } from "./pglite.js";

let ctx: TestContext;
let seed: SeedResult;

/** Run `fn` with a tenant-scoped PgCatalogIndex (every query goes through withTenant). */
function withCatalog<R>(fn: (catalog: PgCatalogIndex) => Promise<R>): Promise<R> {
  return withTenant(ctx.db, seed.tenantId, (tx) => fn(new PgCatalogIndex(tx, seed.tenantId)));
}

beforeAll(async () => {
  ctx = await createTestDb();
  seed = await seedDemo(ctx.db);
});

afterAll(async () => {
  await ctx?.close();
});

describe("seedDemo", () => {
  it("seeds items, customers and aliases and is idempotent", async () => {
    expect(Object.keys(seed.itemIds)).toHaveLength(DEMO_ITEMS.length);
    expect(Object.keys(seed.customerIds)).toHaveLength(3);
    const again = await seedDemo(ctx.db);
    expect(Object.keys(again.itemIds)).toHaveLength(DEMO_ITEMS.length);
  });

  it("satisfies the CatalogIndex interface", () => {
    const idx: CatalogIndex = new PgCatalogIndex(ctx.db, seed.tenantId);
    expect(idx.vector).toBeUndefined();
  });
});

describe("PgCatalogIndex.exact (L0)", () => {
  it("finds an item by SKU with messy formatting", async () => {
    const hits = await withCatalog((c) => c.exact(normalizePartNumber("wire 12 thhn-blk")!));
    expect(hits.map((h) => h.sku)).toEqual(["WIRE-12-THHN-BLK"]);
    expect(hits[0]!.pack).toEqual({ baseUom: "RL" });
  });

  it("finds an item by UPC and by MPN", async () => {
    const byUpc = await withCatalog((c) => c.exact("032886000126"));
    expect(byUpc.map((h) => h.sku)).toEqual(["WIRE-12-THHN-BLK"]);

    const byMpn = await withCatalog((c) => c.exact(normalizePartNumber("qo-120")!));
    expect(byMpn.map((h) => h.sku)).toEqual(["BRK-1P-20-QO"]);
    expect(byMpn[0]!.pack).toEqual({ baseUom: "EA", factors: { BX: 10 } });
    expect(byMpn[0]!.listPrice).toBeCloseTo(11.2);
  });

  it("resolves a customer-formatted part number through partNumberVariants", async () => {
    const variants = partNumberVariants("P/N: CU-L-050-10 (10/BDL)");
    const found: string[] = [];
    await withCatalog(async (c) => {
      for (const v of variants) {
        const hits = await c.exact(v);
        if (hits.length) {
          found.push(...hits.map((h) => h.sku));
          break;
        }
      }
    });
    expect(found).toEqual(["CU-L-050-10"]);
  });

  it("returns nothing for unknown keys, inactive items and other tenants", async () => {
    expect(await withCatalog((c) => c.exact("NOPE123"))).toEqual([]);
    const otherTenant = new PgCatalogIndex(ctx.db, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    expect(await otherTenant.exact("032886000126")).toEqual([]);
  });
});

describe("PgCatalogIndex.trigram (L2)", () => {
  it("ranks the right item first for a messy description", async () => {
    const results = await withCatalog((c) => c.trigram("thhn wire 12awg blk 500' spool", 5));
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    expect(results[0]!.item.sku).toBe("WIRE-12-THHN-BLK");
    expect(results[0]!.score).toBeGreaterThan(0.3);
    expect(results[0]!.evidence).toMatch(/^trigram sim=\d\.\d\d cov=\d\.\d\d$/);
    for (let i = 1; i < results.length; i++) expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
  });

  it("handles dimension spellings and copper pipe sizes", async () => {
    const half = await withCatalog((c) => c.trigram('1/2" type L copper pipe hard 10ft', 3));
    expect(half[0]!.item.sku).toBe("CU-L-050-10");
    const breaker = await withCatalog((c) => c.trigram("sq d 30 amp 2 pole breaker", 3));
    expect(breaker[0]!.item.sku).toBe("BRK-2P-30-QO");
  });

  it("returns an empty list for empty queries or k = 0", async () => {
    expect(await withCatalog((c) => c.trigram("   ", 5))).toEqual([]);
    expect(await withCatalog((c) => c.trigram("copper pipe", 0))).toEqual([]);
  });
});

describe("PgCatalogIndex aliases (L1)", () => {
  it("reads the seeded aliases by part key and by description key", async () => {
    const harbor = seed.customerIds["C-1001"]!;
    const a = await withCatalog((c) => c.alias(harbor, normalizePartNumber("HP-12BLK")!));
    expect(a?.itemId).toBe(seed.itemIds["WIRE-12-THHN-BLK"]);
    expect(a?.hits).toBe(3);

    const bluewater = seed.customerIds["C-1003"]!;
    const d = await withCatalog((c) =>
      c.aliasByDescription(bluewater, normalizeDescription("3/4 brass ball valve full port case")),
    );
    expect(d?.itemId).toBe(seed.itemIds["BV-075-FP"]);
    expect(d?.uomFactor).toBe(12);

    // Aliases are per customer.
    expect(await withCatalog((c) => c.alias(bluewater, normalizePartNumber("HP-12BLK")!))).toBeUndefined();
  });

  it("learnAlias then alias round-trips and increments hits", async () => {
    const ridgeline = seed.customerIds["C-1002"]!;
    const itemId = seed.itemIds["EMT-075-10"]!;
    const key = normalizePartNumber("RM/EMT34")!;

    await withCatalog((c) =>
      c.learnAlias({ customerId: ridgeline, rawPartKey: key, rawDescriptionKey: null, itemId, uomFactor: null, hits: 1 }),
    );
    const first = await withCatalog((c) => c.alias(ridgeline, key));
    expect(first).toMatchObject({ customerId: ridgeline, rawPartKey: key, itemId, hits: 1, tenantId: seed.tenantId });
    expect(first?.id).toBeTruthy();

    await withCatalog((c) =>
      c.learnAlias({ customerId: ridgeline, rawPartKey: key, rawDescriptionKey: null, itemId, uomFactor: 10, hits: 1 }),
    );
    const second = await withCatalog((c) => c.alias(ridgeline, key));
    expect(second?.hits).toBe(2);
    expect(second?.uomFactor).toBe(10);
    expect(second?.id).toBe(first?.id);
  });

  it("prefers the alias with more hits when a key maps to several items", async () => {
    const ridgeline = seed.customerIds["C-1002"]!;
    const key = normalizePartNumber("AMBIG-1")!;
    await withCatalog(async (c) => {
      await c.learnAlias({ customerId: ridgeline, rawPartKey: key, rawDescriptionKey: null, itemId: seed.itemIds["EMT-050-10"]!, uomFactor: null, hits: 1 });
      await c.learnAlias({ customerId: ridgeline, rawPartKey: key, rawDescriptionKey: null, itemId: seed.itemIds["EMT-075-10"]!, uomFactor: null, hits: 1 });
      await c.learnAlias({ customerId: ridgeline, rawPartKey: key, rawDescriptionKey: null, itemId: seed.itemIds["EMT-075-10"]!, uomFactor: null, hits: 1 });
    });
    const best = await withCatalog((c) => c.alias(ridgeline, key));
    expect(best?.itemId).toBe(seed.itemIds["EMT-075-10"]);
    expect(best?.hits).toBe(2);
  });

  it("refuses an alias with neither key", async () => {
    await expect(
      withCatalog((c) =>
        c.learnAlias({ customerId: seed.customerIds["C-1002"]!, rawPartKey: null, rawDescriptionKey: null, itemId: seed.itemIds["EMT-050-10"]!, uomFactor: null, hits: 1 }),
      ),
    ).rejects.toThrow(/required/);
  });
});
