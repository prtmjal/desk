import type { CatalogItem, CustomerRecord } from "@desk/core";
import { createPgliteDb, DEMO_CUSTOMERS, DEMO_ITEMS, type Db, type PgliteContext } from "@desk/db";
import { FakeLlm, fixtures, type LlmClient } from "@desk/extract";
import { applySync, connectSimple, ensureTenant, makeConnectorFactory, MemoryBlobStore, MemoryMailer, SYSTEM, updateSettings, type ServiceDeps } from "../src/index";

export const { extractedLine, extractedOrder, extraction } = fixtures;

/** The demo ERP's master data, in ERP id space (what a connector sync returns). */
export const ERP_ITEMS: CatalogItem[] = DEMO_ITEMS.map((it) => ({
  id: `ERP-${it.sku}`,
  sku: it.sku,
  upc: it.upc ?? null,
  mpn: it.mpn ?? null,
  description: it.description,
  extra: it.extra ?? null,
  active: true,
  pack: { baseUom: it.uom ?? "EA", ...(it.factors ? { factors: it.factors } : {}), ...(it.multipleOf ? { multipleOf: it.multipleOf } : {}) },
  listPrice: Number(it.listPrice),
}));

export const ERP_CUSTOMERS: CustomerRecord[] = DEMO_CUSTOMERS.map((c) => ({ id: c.erpId, name: c.name, domains: [...c.domains], accountNumber: c.accountNumber, aka: [...c.aka], active: true }));

export type World = {
  pg: PgliteContext;
  deps: ServiceDeps & { mailer: MemoryMailer; blobs: MemoryBlobStore };
  tenantId: string;
  setLlm(llm: LlmClient | null): void;
};

export async function createWorld(opts: { llm?: LlmClient | null; connect?: boolean } = {}): Promise<World> {
  const pg = await createPgliteDb();
  const db = pg.db as unknown as Db;
  const mailer = new MemoryMailer();
  const blobs = new MemoryBlobStore();
  const deps: World["deps"] = {
    db,
    blobs,
    mailer,
    llm: opts.llm === undefined ? new FakeLlm({ extraction: extraction([]) }) : opts.llm,
    connectorFor: makeConnectorFactory({ db, secretsKey: "test-secret-key-0123456789", quickbooks: null, demo: { items: ERP_ITEMS, customers: ERP_CUSTOMERS } }),
    appUrl: "https://desk.test",
    inboundDomain: "orders.desk.test",
    secretsKey: "test-secret-key-0123456789",
  };
  const { tenantId } = await ensureTenant(db, { kind: "auth_org", key: "org_test", name: "Acme Supply" });
  await applySync(deps, tenantId, { items: ERP_ITEMS, customers: ERP_CUSTOMERS, prices: [], stock: [] });
  if (opts.connect !== false) await connectSimple(deps, tenantId, "demo", SYSTEM);
  return { pg, deps, tenantId, setLlm: (llm) => void (deps.llm = llm) };
}

export const live = (w: World) => updateSettings(w.deps, w.tenantId, { shadowMode: false }, SYSTEM);

let seq = 0;
export function email(p: { from?: string; subject?: string; body?: string; files?: Array<{ filename: string; text: string }>; messageId?: string } = {}) {
  seq++;
  return {
    source: "email" as const,
    messageId: p.messageId ?? `<m${seq}@test>`,
    from: p.from ?? "purchasing@harborpointelectric.com",
    to: "acme@orders.desk.test",
    subject: p.subject ?? `PO ${seq}`,
    bodyText: p.body ?? "Please process the attached PO.",
    attachments: (p.files ?? []).map((f) => ({ filename: f.filename, bytes: new TextEncoder().encode(f.text), mimeType: "text/csv" })),
  };
}
