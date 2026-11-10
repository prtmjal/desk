import { aliases, customers, events, orders, usageMeters, withTenant } from "@desk/db";
import { MockConnector } from "@desk/erp";
import { FakeLlm, HeuristicLlm } from "@desk/extract";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyEdit,
  confirmOrder,
  dashboardMetrics,
  getOrder,
  getTenant,
  ingest,
  listOrders,
  processMessage,
  receiveMessage,
  rejectOrder,
  resolveRoute,
  sendAcknowledgment,
  ServiceError,
  slugFromRecipient,
  SYSTEM,
  updateSettings,
  type Actor,
} from "../src/index.js";
import { createWorld, email, extractedLine, extractedOrder, extraction, live, type World } from "./harness.js";

const USER: Actor = { kind: "system" };
let w: World;
afterEach(async () => {
  await w?.pg.close();
});

const cleanOrder = (po: string) =>
  extraction([
    extractedOrder({
      po,
      customerName: "Harbor Point Electric",
      lines: [extractedLine(1, { part: "EMT-075-10", desc: "3/4 EMT 10ft", qty: 20, uom: "EA", price: 9.8 }), extractedLine(2, { part: "BOX-4SQ-D", desc: "4in square box", qty: 50, uom: "EA", price: 2.35 })],
    }),
  ]);

const demoErp = async (w: World) => (await w.deps.connectorFor(w.tenantId, { type: "demo" } as never)) as MockConnector;

describe("tenants", () => {
  it("creates a tenant once per auth org and routes its inbound address", async () => {
    w = await createWorld();
    const t = await getTenant(w.deps, w.tenantId);
    expect(t.settings.shadowMode).toBe(true);
    expect(t.settings.autoPost).toBe(false);
    expect(t.inboundAddress).toBe(`${t.slug}@orders.desk.test`);
    expect(await resolveRoute(w.deps.db, "auth_org", "org_test")).toBe(w.tenantId);
    expect(await resolveRoute(w.deps.db, "inbound_slug", t.slug)).toBe(w.tenantId);
    expect(slugFromRecipient(`"Orders" <${t.inboundAddress}>`, "orders.desk.test")).toBe(t.slug);
    expect(slugFromRecipient(`orders+${t.slug}@orders.desk.test`, "orders.desk.test")).toBe(t.slug);
    expect(slugFromRecipient("someone@elsewhere.com", "orders.desk.test")).toBeNull();
  });
});

describe("intake", () => {
  it("turns an email into a draft in the review queue and records the audit trail", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-100") }) });
    const r = await ingest(w.deps, w.tenantId, email({ files: [{ filename: "po.csv", text: "PO-100" }] }));
    expect(r.result?.status).toBe("processed");
    const list = await listOrders(w.deps, w.tenantId, { statuses: ["new", "needs_review"] });
    expect(list).toHaveLength(1);
    expect(list[0]!.customerName).toBe("Harbor Point Electric LLC");
    expect(list[0]!.poNumber).toBe("PO-100");
    const detail = await getOrder(w.deps, w.tenantId, list[0]!.id);
    expect(detail!.order.draft.lines.every((l) => l.match.status === "matched")).toBe(true);
    expect(detail!.documents.map((d) => d.filename).sort()).toEqual(["email-body.txt", "po.csv"]);
    expect(detail!.history.map((h) => h.action)).toContain("created");
  });

  it("is idempotent on message id and ignores a re-sent attachment", async () => {
    const llm = new FakeLlm({ extraction: cleanOrder("PO-101") });
    w = await createWorld({ llm });
    const first = email({ files: [{ filename: "po.csv", text: "same bytes" }], messageId: "<dup@test>" });
    await ingest(w.deps, w.tenantId, first);
    const again = await ingest(w.deps, w.tenantId, first);
    expect(again.duplicate).toBe(true);
    const resent = await ingest(w.deps, w.tenantId, email({ files: [{ filename: "po-copy.csv", text: "same bytes" }] }));
    expect(resent.ignored).toBe(true);
    expect(llm.calls.extract).toBe(1);
    expect(await listOrders(w.deps, w.tenantId)).toHaveLength(1);
  });

  it("does not create a second set of drafts when processing is retried", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-102") }) });
    const rec = await receiveMessage(w.deps, w.tenantId, email());
    await processMessage(w.deps, w.tenantId, rec.messageRowId);
    const retry = await processMessage(w.deps, w.tenantId, rec.messageRowId);
    expect(retry.status).toBe("skipped");
    expect(await listOrders(w.deps, w.tenantId)).toHaveLength(1);
  });

  it("ignores non-orders and reports why", async () => {
    w = await createWorld({ llm: new FakeLlm({ classification: { documentType: "status_inquiry", confidence: 0.97, hasAttachments: false, estimatedOrderCount: 0, rationale: "asks for tracking" }, extraction: extraction([]) }) });
    const r = await ingest(w.deps, w.tenantId, email({ body: "Where is my order?" }));
    expect(r.result?.status).toBe("ignored");
    expect(await listOrders(w.deps, w.tenantId)).toHaveLength(0);
  });

  it("stores the message and fails clearly when no model is configured", async () => {
    w = await createWorld({ llm: null });
    const r = await ingest(w.deps, w.tenantId, email());
    expect(r.result?.status).toBe("failed");
    expect(r.result?.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("reads a plain-text PO with the offline demo parser", async () => {
    w = await createWorld({ llm: new HeuristicLlm() });
    const r = await ingest(w.deps, w.tenantId, email({ body: "PO# HP-7781\nPlease ship:\n20 EA EMT-075-10 3/4 EMT conduit @ 9.80\n5 BX WN-YEL-100 yellow wire nuts @ 9.45" }));
    expect(r.result?.status).toBe("processed");
    const [o] = await listOrders(w.deps, w.tenantId);
    const d = (await getOrder(w.deps, w.tenantId, o!.id))!.order.draft;
    expect(d.header.poNumber.value).toBe("HP-7781");
    expect(d.lines.map((l) => l.match.best?.sku)).toEqual(["EMT-075-10", "WN-YEL-100"]);
  });
});

describe("review and posting", () => {
  it("shadow mode: a person can confirm, nothing reaches the ERP, the desk still learns", async () => {
    w = await createWorld({
      llm: new FakeLlm({ extraction: extraction([extractedOrder({ po: "PO-200", customerName: "Harbor Point Electric", lines: [extractedLine(1, { part: "HP-EMT34", desc: "three quarter emt", qty: 10, uom: "EA", price: 9.8 })] })]) }),
    });
    await ingest(w.deps, w.tenantId, email());
    const [o] = await listOrders(w.deps, w.tenantId);
    expect(o!.status).toBe("needs_review");
    await expect(confirmOrder(w.deps, w.tenantId, o!.id, USER)).rejects.toThrow(/Fix before confirming/);

    const emt = await withTenant(w.deps.db, w.tenantId, async (tx) => (await tx.query.items.findFirst({ where: (i, { eq }) => eq(i.sku, "EMT-075-10") }))!);
    const edited = await applyEdit(w.deps, w.tenantId, o!.id, { type: "set_line_item", lineNo: 1, itemId: emt.id }, USER);
    expect(edited.lines[0]!.match.best?.method).toBe("manual");

    const res = await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    expect(res).toMatchObject({ status: "confirmed", shadow: true, erpOrderId: null });
    expect((await demoErp(w)).posted.size).toBe(0);
    const learned = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(aliases));
    expect(learned.map((a) => a.rawPartKey)).toContain("HPEMT34");
  });

  it("posts once, attaches the document, meters usage, and is idempotent", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-201") }) });
    await live(w);
    await ingest(w.deps, w.tenantId, email({ files: [{ filename: "po-201.csv", text: "PO-201 body" }] }));
    const [o] = await listOrders(w.deps, w.tenantId);
    const res = await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    expect(res.status).toBe("posted");
    expect(res.erpOrderNumber).toMatch(/^SO-/);
    const again = await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    expect(again.erpOrderId).toBe(res.erpOrderId);

    const erp = await demoErp(w);
    expect(erp.posted.size).toBe(1);
    expect(erp.attachments).toEqual([{ erpOrderId: res.erpOrderId, filename: "po-201.csv" }]);
    const [meter] = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(usageMeters));
    expect(meter).toMatchObject({ ordersReceived: 1, ordersPosted: 1, ordersTouchless: 0 });
    const log = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(events).where(eq(events.entityId, o!.id)));
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(["created", "confirmed", "posted"]));
  });

  it("never confirms the same PO twice for a customer", async () => {
    const llm = new FakeLlm({ extraction: cleanOrder("PO-202") });
    w = await createWorld({ llm });
    await live(w);
    await ingest(w.deps, w.tenantId, email());
    const [first] = await listOrders(w.deps, w.tenantId);
    await confirmOrder(w.deps, w.tenantId, first!.id, USER);

    await ingest(w.deps, w.tenantId, email({ body: "Resending PO-202 in case you missed it" }));
    const waiting = await listOrders(w.deps, w.tenantId, { statuses: ["new", "needs_review"] });
    expect(waiting).toHaveLength(1);
    const dup = (await getOrder(w.deps, w.tenantId, waiting[0]!.id))!.order.draft;
    expect(dup.issues.map((i) => i.code)).toContain("DUPLICATE_PO");
    await expect(confirmOrder(w.deps, w.tenantId, waiting[0]!.id, USER)).rejects.toBeInstanceOf(ServiceError);
    expect((await demoErp(w)).posted.size).toBe(1);

    await rejectOrder(w.deps, w.tenantId, waiting[0]!.id, "Duplicate of PO-202", USER);
    expect((await listOrders(w.deps, w.tenantId, { statuses: ["rejected"] }))[0]!.rejectReason).toBe("Duplicate of PO-202");
  });

  it("auto-posts touchless orders when the tenant turns auto-post on, and only then", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-300") }) });
    await ingest(w.deps, w.tenantId, email());
    let [o] = await listOrders(w.deps, w.tenantId);
    expect(o!.status).toBe("new");
    expect(o!.shadowEligible).toBe(false);

    // Shadow mode with auto-post on: record "would have posted", post nothing.
    await updateSettings(w.deps, w.tenantId, { autoPost: true }, SYSTEM);
    w.setLlm(new FakeLlm({ extraction: cleanOrder("PO-301") }));
    await ingest(w.deps, w.tenantId, email());
    [o] = await listOrders(w.deps, w.tenantId);
    expect(o).toMatchObject({ poNumber: "PO-301", status: "new", shadowEligible: true });
    expect((await demoErp(w)).posted.size).toBe(0);

    await live(w);
    w.setLlm(new FakeLlm({ extraction: cleanOrder("PO-302") }));
    const r = await ingest(w.deps, w.tenantId, email());
    expect(r.result?.autoPosted).toBe(1);
    [o] = await listOrders(w.deps, w.tenantId);
    expect(o).toMatchObject({ poNumber: "PO-302", status: "posted", autoPosted: true, touchless: true });

    const m = await dashboardMetrics(w.deps, w.tenantId, 30);
    expect(m.ordersReceived).toBe(3);
    expect(m.ordersPosted).toBe(1);
    expect(m.touchlessRate).toBe(1);
    expect(m.lineAccuracy).toBe(1);
    expect(m.minutesSaved).toBe(8);
  });

  it("holds an auto-post when the price is off, lets a person take list price, then posts", async () => {
    w = await createWorld({
      llm: new FakeLlm({ extraction: extraction([extractedOrder({ po: "PO-400", customerName: "Harbor Point Electric", lines: [extractedLine(1, { part: "EMT-075-10", qty: 10, uom: "BDL", price: 80 })] })]) }),
    });
    await updateSettings(w.deps, w.tenantId, { autoPost: true, shadowMode: false }, SYSTEM);
    const r = await ingest(w.deps, w.tenantId, email());
    expect(r.result?.autoPosted).toBe(0);
    const [o] = await listOrders(w.deps, w.tenantId);
    const before = (await getOrder(w.deps, w.tenantId, o!.id))!.order.draft;
    expect(before.lines[0]!.issues.map((i) => i.code)).toContain("PRICE_MISMATCH");
    expect(before.lines[0]!.erpQuantity).toBe(100);

    const after = await applyEdit(w.deps, w.tenantId, o!.id, { type: "use_list_price", lineNo: 1 }, USER);
    expect(after.lines[0]!.unitPrice.value).toBe(98);
    expect(after.lines[0]!.issues.map((i) => i.code)).not.toContain("PRICE_MISMATCH");
    const res = await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    expect(res.status).toBe("posted");
    const row = (await getOrder(w.deps, w.tenantId, o!.id))!.order;
    expect(row).toMatchObject({ touchless: false, autoPosted: false, editCount: 1 });
  });

  it("learns the sender domain when a person identifies the customer", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: extraction([extractedOrder({ po: "PO-500", customerName: null, lines: [extractedLine(1, { part: "BOX-4SQ-D", qty: 50, uom: "EA", price: 2.35 })] })]) }) });
    await ingest(w.deps, w.tenantId, email({ from: "Dana <dana@newbranch.example>" }));
    const [o] = await listOrders(w.deps, w.tenantId);
    const draft = (await getOrder(w.deps, w.tenantId, o!.id))!.order.draft;
    expect(draft.issues.map((i) => i.code)).toContain("CUSTOMER_UNKNOWN");
    const [cust] = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(customers).where(eq(customers.erpId, "C-1001")));
    await applyEdit(w.deps, w.tenantId, o!.id, { type: "set_customer", customerId: cust!.id }, USER);
    await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    const [after] = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(customers).where(eq(customers.id, cust!.id)));
    expect(after!.domains).toContain("newbranch.example");
  });

  it("sends an acknowledgment built from the tenant's template", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-600") }) });
    await live(w);
    await ingest(w.deps, w.tenantId, email({ from: "buyer@harborpointelectric.com" }));
    const [o] = await listOrders(w.deps, w.tenantId);
    await confirmOrder(w.deps, w.tenantId, o!.id, USER);
    const sent = await sendAcknowledgment(w.deps, w.tenantId, o!.id, USER);
    expect(sent.ok).toBe(true);
    const mail = w.deps.mailer.sent[0]!;
    expect(mail.to).toBe("buyer@harborpointelectric.com");
    expect(mail.subject).toBe("Order received: PO PO-600");
    expect(mail.text).toContain("EMT-075-10");
    expect(mail.text).toMatch(/our order SO-\d+/);
    const [row] = await withTenant(w.deps.db, w.tenantId, (tx) => tx.select().from(orders).where(eq(orders.id, o!.id)));
    expect(row!.acknowledgedAt).not.toBeNull();
  });

  it("keeps tenants apart", async () => {
    w = await createWorld({ llm: new FakeLlm({ extraction: cleanOrder("PO-700") }) });
    await ingest(w.deps, w.tenantId, email());
    const [o] = await listOrders(w.deps, w.tenantId);
    const { ensureTenant } = await import("../src/index.js");
    const other = await ensureTenant(w.deps.db, { kind: "auth_org", key: "org_other", name: "Other Co" });
    expect(await listOrders(w.deps, other.tenantId)).toHaveLength(0);
    expect(await getOrder(w.deps, other.tenantId, o!.id)).toBeNull();
    await expect(confirmOrder(w.deps, other.tenantId, o!.id, USER)).rejects.toThrow(/not found/i);
  });
});
