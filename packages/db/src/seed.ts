/**
 * Demo tenant seed: an electrical/plumbing distributor with a small item master,
 * three customers and two learned aliases. Idempotent (fixed ids + ON CONFLICT DO NOTHING).
 *
 *   DATABASE_URL=postgres://... pnpm --filter @desk/db run seed
 */
import { normalizeDescription, normalizePartNumber } from "@desk/core";
import { eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { withItemKeys } from "./catalog.js";
import { createDb, withTenant, type Db } from "./client.js";
import { aliases, customers, items, tenantSettings, tenants } from "./schema/index.js";

export const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_TENANT_SLUG = "acme-supply-demo";

type SeedItem = {
  sku: string;
  upc?: string;
  mpn?: string;
  description: string;
  extra?: string;
  uom?: string;
  factors?: Record<string, number>;
  multipleOf?: number;
  listPrice: string;
};

export const DEMO_ITEMS: SeedItem[] = [
  { sku: "WIRE-12-THHN-BLK", upc: "032886000126", mpn: "22964158", description: "12 AWG THHN Stranded Copper Wire, Black, 500 ft", extra: "Southwire building wire 600V spool", uom: "RL", listPrice: "89.5000" },
  { sku: "WIRE-12-THHN-RED", upc: "032886000133", mpn: "22964258", description: "12 AWG THHN Stranded Copper Wire, Red, 500 ft", extra: "Southwire building wire 600V spool", uom: "RL", listPrice: "89.5000" },
  { sku: "WIRE-14-THHN-WHT", upc: "032886000140", mpn: "22955758", description: "14 AWG THHN Stranded Copper Wire, White, 500 ft", extra: "Southwire building wire 600V spool", uom: "RL", listPrice: "62.0000" },
  { sku: "EMT-050-10", upc: "046135000508", mpn: "101543", description: "1/2 in EMT Conduit, 10 ft", extra: "Allied Tube steel electrical metallic tubing", uom: "EA", factors: { BDL: 10 }, listPrice: "6.1500" },
  { sku: "EMT-075-10", upc: "046135000751", mpn: "101568", description: "3/4 in EMT Conduit, 10 ft", extra: "Allied Tube steel electrical metallic tubing", uom: "EA", factors: { BDL: 10 }, listPrice: "9.8000" },
  { sku: "BOX-4SQ-D", upc: "050169001059", mpn: "52171-K", description: "4 in Square Box, 2-1/8 in Deep, Welded", extra: "Raco steel outlet box 30.3 cu in", uom: "EA", factors: { CS: 50 }, listPrice: "2.3500" },
  { sku: "RCPT-20A-DUP-WH", upc: "078477000209", mpn: "CR20-W", description: "20A 125V Duplex Receptacle, Commercial Grade, White", extra: "Leviton tamper resistant", uom: "EA", factors: { BX: 10, CS: 100 }, listPrice: "4.9000" },
  { sku: "BRK-1P-20-QO", upc: "785901000204", mpn: "QO120", description: "20A 1-Pole QO Circuit Breaker, Plug-On", extra: "Square D 120/240V 10kA", uom: "EA", factors: { BX: 10 }, listPrice: "11.2000" },
  { sku: "BRK-2P-30-QO", upc: "785901000303", mpn: "QO230", description: "30A 2-Pole QO Circuit Breaker, Plug-On", extra: "Square D 120/240V 10kA", uom: "EA", factors: { BX: 5 }, listPrice: "24.6000" },
  { sku: "CU-L-050-10", upc: "689999005010", mpn: "LH04010", description: "1/2 in Type L Copper Pipe, 10 ft Hard", extra: "Mueller Streamline copper tube", uom: "EA", factors: { BDL: 10 }, listPrice: "21.7500" },
  { sku: "CU-L-075-10", upc: "689999007510", mpn: "LH06010", description: "3/4 in Type L Copper Pipe, 10 ft Hard", extra: "Mueller Streamline copper tube", uom: "EA", factors: { BDL: 5 }, listPrice: "33.4000" },
  { sku: "PEX-A-050-100-RED", upc: "673372001004", mpn: "F1040500", description: "1/2 in PEX-A Tubing, Red, 100 ft Coil", extra: "Uponor AquaPEX", uom: "RL", listPrice: "48.9000" },
  { sku: "PVC-40-200-10", upc: "011651002003", mpn: "PVC 04200 0600", description: "2 in Schedule 40 PVC Pipe, 10 ft", extra: "Charlotte Pipe plain end", uom: "EA", factors: { BDL: 10 }, listPrice: "14.3000" },
  { sku: "BV-075-FP", upc: "671090007509", mpn: "107-414NL", description: "3/4 in Full Port Brass Ball Valve, Threaded, Lead Free", extra: "Mueller 600 WOG", uom: "EA", factors: { CS: 12 }, listPrice: "18.6000" },
  { sku: "TAPE-PTFE-050", upc: "032628000502", mpn: "31270", description: "1/2 in x 520 in PTFE Thread Seal Tape", extra: "Oatey white teflon tape", uom: "EA", factors: { CS: 12 }, multipleOf: 12, listPrice: "1.1500" },
  { sku: "WN-YEL-100", upc: "078477100100", mpn: "30-074", description: "Yellow Wire Nut Connectors, 100 Pack", extra: "Ideal 74B twist-on 18-10 AWG", uom: "BX", factors: { CS: 10 }, listPrice: "9.4500" },
];

export const DEMO_CUSTOMERS = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    erpId: "C-1001",
    name: "Harbor Point Electric LLC",
    domains: ["harborpointelectric.com"],
    accountNumber: "1001",
    aka: ["Harbor Point Electric", "HPE"],
    terms: "NET30",
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    erpId: "C-1002",
    name: "Ridgeline Mechanical Contractors",
    domains: ["ridgelinemech.com", "ridgeline-mechanical.com"],
    accountNumber: "1002",
    aka: ["Ridgeline Mechanical"],
    terms: "NET45",
  },
  {
    id: "00000000-0000-4000-8000-00000000c003",
    erpId: "C-1003",
    name: "Bluewater Plumbing & Heating",
    domains: ["bluewaterph.com"],
    accountNumber: "1003",
    aka: ["Bluewater Plumbing", "Blue Water P&H"],
    terms: "COD",
  },
] as const;

export type SeedResult = {
  tenantId: string;
  itemIds: Record<string, string>;
  customerIds: Record<string, string>;
  aliasCount: number;
};

/**
 * Seed the demo tenant. Runs through `withTenant` like any other write, which
 * also exercises the tenants WITH CHECK policy (a tenant can only be created
 * under its own id).
 */
export async function seedDemo(db: Db, tenantId: string = DEMO_TENANT_ID): Promise<SeedResult> {
  return withTenant(db, tenantId, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: "Acme Electrical & Plumbing Supply (demo)", slug: `${DEMO_TENANT_SLUG}-${tenantId.slice(-4)}`, plan: "trial" })
      .onConflictDoNothing();
    await tx
      .insert(tenantSettings)
      .values({ tenantId, settings: { autoPost: false, shadowMode: true, autoPostThreshold: 0.95 } })
      .onConflictDoNothing();

    await tx
      .insert(items)
      .values(
        DEMO_ITEMS.map((it) =>
          withItemKeys({
            tenantId,
            erpId: `ERP-${it.sku}`,
            sku: it.sku,
            upc: it.upc ?? null,
            mpn: it.mpn ?? null,
            description: it.description,
            extra: it.extra ?? null,
            uom: it.uom ?? "EA",
            pack: { baseUom: it.uom ?? "EA", ...(it.factors ? { factors: it.factors } : {}), ...(it.multipleOf ? { multipleOf: it.multipleOf } : {}) },
            listPrice: it.listPrice,
            active: true,
          }),
        ),
      )
      .onConflictDoNothing();

    await tx
      .insert(customers)
      .values(
        DEMO_CUSTOMERS.map((c) => ({
          id: c.id,
          tenantId,
          erpId: c.erpId,
          name: c.name,
          domains: [...c.domains],
          accountNumber: c.accountNumber,
          aka: [...c.aka],
          terms: c.terms,
        })),
      )
      .onConflictDoNothing();

    const itemRows = await tx.select({ id: items.id, sku: items.sku }).from(items).where(eq(items.tenantId, tenantId));
    const itemIds = Object.fromEntries(itemRows.map((r) => [r.sku, r.id]));
    const customerRows = await tx.select({ id: customers.id, erpId: customers.erpId }).from(customers);
    const customerIds = Object.fromEntries(customerRows.map((r) => [r.erpId, r.id]));

    const harbor = customerIds["C-1001"];
    const bluewater = customerIds["C-1003"];
    const wireBlk = itemIds["WIRE-12-THHN-BLK"];
    const ballValve = itemIds["BV-075-FP"];
    if (!harbor || !bluewater || !wireBlk || !ballValve) throw new Error("seedDemo: expected rows missing");

    const aliasRows = [
      // Harbor Point writes the wire on their POs as "HP-12BLK"
      { tenantId, customerId: harbor, rawPartKey: normalizePartNumber("HP-12BLK"), rawDescriptionKey: null, itemId: wireBlk, uomFactor: null, hits: 3 },
      // Bluewater orders ball valves by description, by the case
      {
        tenantId,
        customerId: bluewater,
        rawPartKey: null,
        rawDescriptionKey: normalizeDescription("3/4 brass ball valve full port case"),
        itemId: ballValve,
        uomFactor: "12",
        hits: 2,
      },
    ];
    await tx.insert(aliases).values(aliasRows).onConflictDoNothing();

    return { tenantId, itemIds, customerIds, aliasCount: aliasRows.length };
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createDb(url, { max: 1 });
  seedDemo(db)
    .then((r) => {
      console.log(`seeded tenant ${r.tenantId}: ${Object.keys(r.itemIds).length} items, ${Object.keys(r.customerIds).length} customers, ${r.aliasCount} aliases`);
      return db.$client.end();
    })
    .catch(async (err) => {
      console.error(err);
      await db.$client.end();
      process.exit(1);
    });
}
