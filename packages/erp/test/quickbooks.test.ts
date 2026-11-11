import type { OrderDraft } from "@desk/core";
import { fixtures } from "@desk/extract";
import { describe, expect, it } from "vitest";
import { buildEstimate, buildSalesOrderInput, ConnectorAuthError, ConnectorValidationError, qboAuthorizeUrl, qboScopes, QuickBooksConnector, type QboTokens } from "../src/index";

// Recorded-shape fixtures (never a real ERP from tests — CLAUDE.md).
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(routes: Array<(c: Call) => Response | undefined>) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = { url: String(input), method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
    calls.push(call);
    for (const r of routes) {
      const res = r(call);
      if (res) return res;
    }
    return new Response(JSON.stringify({ Fault: { Error: [{ Message: "unrouted" }] } }), { status: 500 });
  }) as typeof fetch;
  return { f, calls };
}

const sqlOf = (url: string) => new URL(url).searchParams.get("query") ?? "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fresh = (): QboTokens => ({ accessToken: "at-1", refreshToken: "rt-1", expiresAt: Date.now() + 3_600_000 });
const base = { clientId: "cid", clientSecret: "secret", environment: "sandbox" as const, realmId: "9130" };

function draft(): OrderDraft {
  const { extractedLine, extractedOrder } = fixtures;
  const { lines, ...header } = extractedOrder({ po: "PO-77", customerName: "Harbor Point", email: "buyer@harbor.example", lines: [extractedLine(1, { part: "HP-EMT34", desc: "3/4 emt", qty: 2, uom: "BDL", price: 98 })] });
  return {
    id: "o1",
    tenantId: "t1",
    documentId: "d1",
    documentType: "order",
    status: "confirmed",
    customer: { customerId: "58", name: "Harbor Point Electric LLC", method: "domain", confidence: 0.97, candidates: [] },
    header,
    lines: lines.map((l) => ({
      ...l,
      match: { status: "matched", best: { itemId: "19", sku: "EMT-075-10", description: "3/4 in EMT Conduit, 10 ft", method: "L1_alias", score: 0.99, evidence: "alias" }, candidates: [], uomFactor: 10, erpUom: "EA", abstainReason: null },
      normalizedPartNumber: "HPEMT34",
      erpQuantity: 20,
      listPrice: 9.8,
      priceDeltaPct: 0,
      issues: [],
    })),
    issues: [],
    confidence: { header: 0.98, lines: 0.98, overall: 0.98 },
    autoPost: { eligible: false, reasons: [] },
    meta: { extractorVersion: "t", promptVersion: "t", model: "t", createdAt: "2026-11-10T00:00:00.000Z", cost: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, calls: 0 }, warnings: [] },
  };
}

describe("QuickBooks OAuth helpers", () => {
  it("builds the authorize URL and asks for sales-order scopes only when needed", () => {
    const u = new URL(qboAuthorizeUrl({ clientId: "cid", redirectUri: "https://app.test/cb", state: "s1", scopes: qboScopes("estimate") }));
    expect(u.origin + u.pathname).toBe("https://appcenter.intuit.com/connect/oauth2");
    expect(u.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(u.searchParams.get("state")).toBe("s1");
    expect(qboScopes("sales_order")).toContain("sales.sales-order.write");
  });
});

describe("QuickBooksConnector", () => {
  it("maps items and customers and pages with STARTPOSITION", async () => {
    const { f, calls } = fakeFetch([
      (c) =>
        sqlOf(c.url).includes("FROM Item")
          ? json({ QueryResponse: { Item: [{ Id: "19", Name: "EMT 3/4", Sku: "EMT-075-10", Description: "3/4 in EMT Conduit, 10 ft", Active: true, UnitPrice: 9.8, Type: "Inventory" }, { Id: "20", Name: "Delivery", Active: false, Type: "Service" }] } })
          : undefined,
      (c) =>
        sqlOf(c.url).includes("FROM Customer")
          ? json({ QueryResponse: { Customer: [{ Id: "58", DisplayName: "Harbor Point Electric LLC", CompanyName: "Harbor Point Electric", PrimaryEmailAddr: { Address: "ap@harborpointelectric.com" } }, { Id: "59", DisplayName: "Walk-in", PrimaryEmailAddr: { Address: "someone@gmail.com" } }] } })
          : undefined,
    ]);
    const qbo = new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f });
    const items = await qbo.syncItems();
    expect(items.cursor).toBeNull();
    expect(items.items[0]).toMatchObject({ id: "19", sku: "EMT-075-10", description: "3/4 in EMT Conduit, 10 ft", listPrice: 9.8, active: true, extra: "EMT 3/4" });
    expect(items.items[1]).toMatchObject({ id: "20", sku: "Delivery", active: false });
    const customers = await qbo.syncCustomers();
    expect(customers.items[0]).toMatchObject({ id: "58", domains: ["harborpointelectric.com"], aka: ["Harbor Point Electric"] });
    expect(customers.items[1]!.domains).toEqual([]);
    expect(calls[0]!.url).toContain("sandbox-quickbooks.api.intuit.com/v3/company/9130/query");
    expect(sqlOf(calls[0]!.url)).toBe("SELECT * FROM Item WHERE Type IN ('Inventory', 'NonInventory', 'Service') STARTPOSITION 1 MAXRESULTS 500");
    expect(calls[0]!.headers.authorization).toBe("Bearer at-1");
  });

  it("reports stock only for inventory-tracked items", async () => {
    const { f } = fakeFetch([(c) => (c.url.includes("/query") ? json({ QueryResponse: { Item: [{ Id: "19", Name: "a", TrackQtyOnHand: true, QtyOnHand: 140 }, { Id: "20", Name: "b" }] } }) : undefined)]);
    const stock = await new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f }).checkStock(["19", "20"]);
    expect(stock).toEqual([{ itemId: "19", available: 140, onHand: 140 }]);
  });

  it("posts an estimate in base units with an idempotent requestid", async () => {
    const { f, calls } = fakeFetch([(c) => (c.url.includes("/estimate") ? json({ Estimate: { Id: "301", DocNumber: "1042" } }) : undefined)]);
    const qbo = new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f });
    const res = await qbo.createSalesOrder(draft(), { idempotencyKey: "desk-o1" });
    expect(res).toMatchObject({ erpOrderId: "301", erpOrderNumber: "1042", status: "pending_approval" });
    expect(res.url).toContain("app.sandbox.qbo.intuit.com/app/estimate?txnId=301");
    expect(new URL(calls[0]!.url).searchParams.get("requestid")).toBe("desk-o1");
    const body = JSON.parse(String(calls[0]!.body));
    expect(body.CustomerRef).toEqual({ value: "58" });
    expect(body.CustomerMemo).toEqual({ value: "PO PO-77" });
    // 2 bundles of 10 at 98.00 per bundle = 20 EA at 9.80.
    expect(body.Line[0]).toMatchObject({ DetailType: "SalesItemLineDetail", Amount: 196, SalesItemLineDetail: { ItemRef: { value: "19" }, Qty: 20, UnitPrice: 9.8 } });
    expect(body.Line[0].Description).toContain("Customer part HP-EMT34");
  });

  it("refreshes an expired token, persists the rotated pair, and retries", async () => {
    const saved: QboTokens[] = [];
    const { f, calls } = fakeFetch([
      (c) => (c.url.includes("oauth2/v1/tokens/bearer") ? json({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }) : undefined),
      (c) => (c.url.includes("/companyinfo/") ? (c.headers.authorization === "Bearer at-2" ? json({ CompanyInfo: { CompanyName: "Acme Supply" } }) : json({}, 401)) : undefined),
    ]);
    const qbo = new QuickBooksConnector({ ...base, tokens: { ...fresh(), expiresAt: Date.now() - 1000 }, fetch: f, onTokens: async (t) => void saved.push(t) });
    expect(await qbo.ping()).toEqual({ ok: true, message: "Connected to Acme Supply" });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2" });
    expect(String(calls[0]!.body)).toContain("grant_type=refresh_token");
  });

  it("raises an auth error when the refresh token is dead", async () => {
    const { f } = fakeFetch([(c) => (c.url.includes("tokens/bearer") ? json({ error: "invalid_grant" }, 400) : undefined)]);
    const qbo = new QuickBooksConnector({ ...base, tokens: { ...fresh(), expiresAt: 0 }, fetch: f });
    await expect(qbo.syncItems()).rejects.toBeInstanceOf(ConnectorAuthError);
  });

  it("turns a QuickBooks validation fault into a ConnectorValidationError", async () => {
    const { f } = fakeFetch([(c) => (c.url.includes("/estimate") ? json({ Fault: { type: "ValidationFault", Error: [{ Message: "Invalid Reference Id", Detail: "Item 19 not found" }] } }, 400) : undefined)]);
    const qbo = new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f });
    await expect(qbo.createSalesOrder(draft(), { idempotencyKey: "desk-o1" })).rejects.toThrow(/Invalid Reference Id: Item 19 not found/);
    const d = draft();
    d.customer.customerId = null;
    await expect(qbo.createSalesOrder(d, { idempotencyKey: "k" })).rejects.toBeInstanceOf(ConnectorValidationError);
  });

  it("sales_order mode posts the GraphQL mutation with the realm header", async () => {
    const { f, calls } = fakeFetch([(c) => (c.url.includes("/graphql") ? json({ data: { salesCreateSalesOrder: { id: "so_9", referenceNumber: "SO-9", status: "OPEN" } } }) : undefined)]);
    const qbo = new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f, orderEntity: "sales_order" });
    const res = await qbo.createSalesOrder(draft(), { idempotencyKey: "desk-o1" });
    expect(res).toMatchObject({ erpOrderId: "so_9", erpOrderNumber: "SO-9", status: "open" });
    expect(calls[0]!.url).toBe("https://qb-sandbox.api.intuit.com/graphql");
    expect(calls[0]!.headers["intuit-realm-id"]).toBe("9130");
    const sent = JSON.parse(String(calls[0]!.body));
    expect(sent.query).toContain("salesCreateSalesOrder");
    expect(sent.variables.input).toEqual(buildSalesOrderInput(draft(), "desk-o1"));
    expect(buildEstimate(draft(), "k").Line).toHaveLength(1);
  });

  it("attaches the source document to the order", async () => {
    const { f, calls } = fakeFetch([(c) => (c.url.includes("/upload") ? json({ AttachableResponse: [{ Attachable: { Id: "att-5" } }] }) : undefined)]);
    const res = await new QuickBooksConnector({ ...base, tokens: fresh(), fetch: f }).attachDocument("301", { filename: "po.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) });
    expect(res).toEqual({ ok: true, attachmentId: "att-5" });
    expect(calls[0]!.body).toBeInstanceOf(FormData);
  });
});
