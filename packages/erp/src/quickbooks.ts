/**
 * QuickBooks Online connector (plan §6.5 Phase 2).
 *
 * Reads (items, customers, stock) use the Accounting REST API v3, which is stable.
 * Order posting has two modes, chosen per integration (`orderEntity`):
 *
 *   "estimate" (default)  POST /v3/company/{realm}/estimate — the long-standing way to
 *                         hold a non-posting order in QBO; idempotent via `requestid`.
 *   "sales_order"         Intuit's Sales Order API (GraphQL, launched October 2026):
 *                         mutation `salesCreateSalesOrder` at qb.api.intuit.com/graphql,
 *                         restricted scopes sales.sales-order.read / .write, and the
 *                         Sales Orders feature enabled in the company (Plus, Advanced, IES).
 *
 * VERIFY BEFORE PRODUCTION (docs/DECISIONS.md D-006): the GraphQL input shape in
 * `buildSalesOrderInput` follows Intuit's launch announcement and their other GraphQL
 * APIs, but has not been run against a sandbox. Check the field names in Intuit's
 * GraphQL explorer and adjust that one function. The estimate mode needs no such check.
 */
import type { CatalogItem, CustomerRecord, OrderDraft } from "@desk/core";
import { domainOf, isFreeMailDomain } from "@desk/core";
import { ConnectorAuthError, ConnectorValidationError, type CreateSalesOrderResult, type ErpConnector, type PriceListEntry, type StockLevel, type SyncResult } from "./connector.js";

export type QboEnvironment = "sandbox" | "production";
export type QboOrderEntity = "estimate" | "sales_order";

export type QboTokens = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
};

export const QBO_SCOPES = {
  accounting: "com.intuit.quickbooks.accounting",
  salesOrderRead: "sales.sales-order.read",
  salesOrderWrite: "sales.sales-order.write",
} as const;

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const MINOR_VERSION = "75";
const PAGE = 500;

const restBase = (env: QboEnvironment) => (env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");
const graphqlUrl = (env: QboEnvironment) => (env === "production" ? "https://qb.api.intuit.com/graphql" : "https://qb-sandbox.api.intuit.com/graphql");
const appBase = (env: QboEnvironment) => (env === "production" ? "https://app.qbo.intuit.com" : "https://app.sandbox.qbo.intuit.com");

export function qboScopes(orderEntity: QboOrderEntity): string[] {
  return orderEntity === "sales_order" ? [QBO_SCOPES.accounting, QBO_SCOPES.salesOrderRead, QBO_SCOPES.salesOrderWrite] : [QBO_SCOPES.accounting];
}

/** Step 1 of OAuth: where to send the user. `state` must be unguessable and verified on return. */
export function qboAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; scopes: string[] }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", input.scopes.join(" "));
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("state", input.state);
  return u.toString();
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };

async function tokenRequest(creds: { clientId: string; clientSecret: string }, body: Record<string, string>, f: typeof fetch): Promise<QboTokens> {
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new ConnectorAuthError(`QuickBooks authorization failed: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}. Reconnect QuickBooks in Settings.`, "quickbooks_online");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

/** Step 2 of OAuth: exchange the authorization code for tokens. */
export function qboExchangeCode(input: { clientId: string; clientSecret: string; redirectUri: string; code: string; fetch?: typeof fetch }): Promise<QboTokens> {
  return tokenRequest(input, { grant_type: "authorization_code", code: input.code, redirect_uri: input.redirectUri }, input.fetch ?? fetch);
}

export async function qboRevoke(input: { clientId: string; clientSecret: string; refreshToken: string; fetch?: typeof fetch }): Promise<void> {
  await (input.fetch ?? fetch)(REVOKE_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}` },
    body: JSON.stringify({ token: input.refreshToken }),
  }).catch(() => undefined);
}

export type QuickBooksOptions = {
  clientId: string;
  clientSecret: string;
  environment: QboEnvironment;
  realmId: string;
  tokens: QboTokens;
  orderEntity?: QboOrderEntity;
  /** Called after every token refresh. Intuit rotates refresh tokens, so this must persist them. */
  onTokens?: (tokens: QboTokens) => Promise<void>;
  fetch?: typeof fetch;
};

type QboItem = { Id: string; Name: string; Sku?: string; Description?: string; Active?: boolean; UnitPrice?: number; Type?: string; TrackQtyOnHand?: boolean; QtyOnHand?: number; FullyQualifiedName?: string };
type QboCustomer = { Id: string; DisplayName: string; CompanyName?: string; FullyQualifiedName?: string; Active?: boolean; PrimaryEmailAddr?: { Address?: string }; Notes?: string };
type QboFault = { Fault?: { Error?: Array<{ Message?: string; Detail?: string; code?: string }>; type?: string } };

/** QBO query-language string literal. */
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export class QuickBooksConnector implements ErpConnector {
  readonly type = "quickbooks_online" as const;
  private tokens: QboTokens;
  private f: typeof fetch;
  private entity: QboOrderEntity;

  constructor(private opts: QuickBooksOptions) {
    this.tokens = opts.tokens;
    this.f = opts.fetch ?? fetch;
    this.entity = opts.orderEntity ?? "estimate";
  }

  // ---- auth -----------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.tokens = await tokenRequest(this.opts, { grant_type: "refresh_token", refresh_token: this.tokens.refreshToken }, this.f);
    await this.opts.onTokens?.(this.tokens);
  }

  /** Authenticated request with one refresh-and-retry on expiry or 401. */
  private async request(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    if (this.tokens.expiresAt - Date.now() < 60_000) await this.refresh();
    const send = () => this.f(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}), authorization: `Bearer ${this.tokens.accessToken}` } });
    let res = await send();
    if (res.status === 401) {
      await this.refresh();
      res = await send();
      if (res.status === 401) throw new ConnectorAuthError("QuickBooks rejected the connection. Reconnect QuickBooks in Settings.", this.type);
    }
    if (res.status === 403) throw new ConnectorAuthError("QuickBooks denied access. The app may be missing a permission (scope) or the company feature is off.", this.type);
    return res;
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const u = new URL(`${restBase(this.opts.environment)}/v3/company/${encodeURIComponent(this.opts.realmId)}/${path}`);
    u.searchParams.set("minorversion", MINOR_VERSION);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  private async rest<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, params: Record<string, string> = {}): Promise<T> {
    const res = await this.request(this.url(path, params), init);
    const json = (await res.json().catch(() => ({}))) as T & QboFault;
    if (!res.ok || json.Fault) {
      const e = json.Fault?.Error?.[0];
      const message = [e?.Message, e?.Detail].filter(Boolean).join(": ") || `HTTP ${res.status}`;
      if (res.status === 400 || json.Fault?.type === "ValidationFault") throw new ConnectorValidationError(`QuickBooks rejected the request: ${message}`, json.Fault ?? null);
      throw new Error(`QuickBooks request failed: ${message}`);
    }
    return json;
  }

  private async query<T>(entity: string, where: string, cursor: string | null | undefined): Promise<SyncResult<T>> {
    const start = cursor ? Number(cursor) : 1;
    const sql = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${PAGE}`;
    const json = await this.rest<{ QueryResponse?: Record<string, unknown> }>("query", {}, { query: sql });
    const rows = ((json.QueryResponse?.[entity] as T[] | undefined) ?? []) as T[];
    return { items: rows, cursor: rows.length === PAGE ? String(start + PAGE) : null, syncedAt: new Date().toISOString() };
  }

  // ---- ErpConnector ---------------------------------------------------------------------

  async ping() {
    try {
      const json = await this.rest<{ CompanyInfo?: { CompanyName?: string } }>(`companyinfo/${encodeURIComponent(this.opts.realmId)}`);
      return { ok: true, message: `Connected to ${json.CompanyInfo?.CompanyName ?? "QuickBooks Online"}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async syncItems(cursor?: string | null): Promise<SyncResult<CatalogItem>> {
    // Categories and bundles are not orderable lines.
    const page = await this.query<QboItem>("Item", "Type IN ('Inventory', 'NonInventory', 'Service')", cursor);
    return {
      ...page,
      items: page.items.map((i) => ({
        id: i.Id,
        sku: (i.Sku?.trim() || i.Name).trim(),
        upc: null,
        mpn: null,
        description: (i.Description?.trim() || i.Name).trim(),
        extra: i.Sku && i.Name !== i.Sku ? i.Name : null,
        active: i.Active !== false,
        // QBO has no units of measure: everything is sold in its base unit.
        pack: { baseUom: "EA" },
        listPrice: typeof i.UnitPrice === "number" ? i.UnitPrice : null,
      })),
    };
  }

  async syncCustomers(cursor?: string | null): Promise<SyncResult<CustomerRecord>> {
    const page = await this.query<QboCustomer>("Customer", "", cursor);
    return {
      ...page,
      items: page.items.map((c) => {
        const dom = domainOf(c.PrimaryEmailAddr?.Address);
        const aka = [c.CompanyName, c.FullyQualifiedName].filter((n): n is string => !!n && n !== c.DisplayName);
        return { id: c.Id, name: c.DisplayName, domains: dom && !isFreeMailDomain(dom) ? [dom] : [], accountNumber: null, aka: [...new Set(aka)], active: c.Active !== false, creditHold: false };
      }),
    };
  }

  /** QBO exposes one sales price per item (returned by syncItems); price rules are not in the API. */
  async syncPrices(): Promise<SyncResult<PriceListEntry>> {
    return { items: [], cursor: null, syncedAt: new Date().toISOString() };
  }

  /** Only inventory-tracked items report a quantity; the rest are omitted (stock unknown). */
  async checkStock(itemIds: string[]): Promise<StockLevel[]> {
    const out: StockLevel[] = [];
    for (let i = 0; i < itemIds.length; i += 100) {
      const ids = itemIds.slice(i, i + 100).map(q).join(", ");
      const page = await this.query<QboItem>("Item", `Id IN (${ids})`, null);
      for (const it of page.items) {
        if (it.TrackQtyOnHand && typeof it.QtyOnHand === "number") out.push({ itemId: it.Id, available: it.QtyOnHand, onHand: it.QtyOnHand });
      }
    }
    return out;
  }

  async createSalesOrder(draft: OrderDraft, opts: { idempotencyKey: string; asDraft?: boolean }): Promise<CreateSalesOrderResult> {
    if (!draft.customer.customerId) throw new ConnectorValidationError("Customer not identified");
    const unmatched = draft.lines.filter((l) => l.match.status !== "matched" || !l.match.best);
    if (unmatched.length) throw new ConnectorValidationError(`Lines without a matched item: ${unmatched.map((l) => l.lineNo).join(", ")}`);
    if (draft.lines.length === 0) throw new ConnectorValidationError("The order has no lines");
    return this.entity === "sales_order" ? this.createViaGraphql(draft, opts.idempotencyKey) : this.createEstimate(draft, opts.idempotencyKey);
  }

  private async createEstimate(draft: OrderDraft, idempotencyKey: string): Promise<CreateSalesOrderResult> {
    const body = buildEstimate(draft, idempotencyKey);
    // `requestid` makes the create idempotent on Intuit's side: a retry returns the first result.
    const json = await this.rest<{ Estimate: { Id: string; DocNumber?: string } }>(
      "estimate",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { requestid: idempotencyKey.replace(/[^A-Za-z0-9-]/g, "").slice(0, 50) },
    );
    const id = json.Estimate.Id;
    return { erpOrderId: id, erpOrderNumber: json.Estimate.DocNumber ?? null, url: `${appBase(this.opts.environment)}/app/estimate?txnId=${encodeURIComponent(id)}`, status: "pending_approval", raw: json.Estimate };
  }

  private async createViaGraphql(draft: OrderDraft, idempotencyKey: string): Promise<CreateSalesOrderResult> {
    const res = await this.request(graphqlUrl(this.opts.environment), {
      method: "POST",
      headers: { "content-type": "application/json", "intuit-realm-id": this.opts.realmId, "idempotency-key": idempotencyKey },
      body: JSON.stringify({ query: SALES_ORDER_MUTATION, variables: { input: buildSalesOrderInput(draft, idempotencyKey) } }),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: { salesCreateSalesOrder?: { id?: string; referenceNumber?: string; status?: string } }; errors?: Array<{ message?: string }> };
    if (json.errors?.length || !res.ok) {
      const message = json.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      throw new ConnectorValidationError(`QuickBooks rejected the sales order: ${message}`, json.errors ?? null);
    }
    const so = json.data?.salesCreateSalesOrder;
    if (!so?.id) throw new Error("QuickBooks returned no sales order id");
    return { erpOrderId: so.id, erpOrderNumber: so.referenceNumber ?? null, url: `${appBase(this.opts.environment)}/app/salesorder?txnId=${encodeURIComponent(so.id)}`, status: "open", raw: so };
  }

  async attachDocument(erpOrderId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }) {
    const form = new FormData();
    const meta = { AttachableRef: [{ EntityRef: { type: this.entity === "sales_order" ? "SalesOrder" : "Estimate", value: erpOrderId } }], FileName: file.filename, ContentType: file.mimeType };
    form.append("file_metadata_01", new Blob([JSON.stringify(meta)], { type: "application/json" }), "metadata.json");
    form.append("file_content_01", new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType }), file.filename);
    const res = await this.request(this.url("upload"), { method: "POST", body: form });
    const json = (await res.json().catch(() => ({}))) as { AttachableResponse?: Array<{ Attachable?: { Id?: string } }> };
    const id = json.AttachableResponse?.[0]?.Attachable?.Id ?? null;
    return { ok: res.ok && id !== null, attachmentId: id };
  }
}

function lineFacts(l: OrderDraft["lines"][number]) {
  const factor = l.match.uomFactor ?? 1;
  const qty = l.erpQuantity ?? (l.quantity.value ?? 0) * factor;
  // Price per base unit: the PO price is per ordered unit (e.g. per case).
  const unitPrice = l.unitPrice.value !== null ? l.unitPrice.value / factor : l.listPrice;
  const note = [l.rawPartNumber.value && l.rawPartNumber.value !== l.match.best!.sku ? `Customer part ${l.rawPartNumber.value}` : null, l.notes.value].filter(Boolean).join(". ");
  return { qty, unitPrice, description: [l.match.best!.description, note].filter(Boolean).join(" — ") };
}

function memo(draft: OrderDraft, idempotencyKey: string): string {
  return [`Entered by DESK (${idempotencyKey})`, draft.header.specialInstructions.value].filter(Boolean).join("\n").slice(0, 4000);
}

/** Accounting REST v3 Estimate body. Exported for tests. */
export function buildEstimate(draft: OrderDraft, idempotencyKey: string): Record<string, unknown> {
  const h = draft.header;
  const ship = h.shipTo;
  const hasShip = [ship.line1.value, ship.city.value, ship.postalCode.value].some(Boolean);
  return {
    CustomerRef: { value: draft.customer.customerId },
    ...(h.orderDate.value ? { TxnDate: h.orderDate.value } : {}),
    ...(h.requestedShipDate.value ? { ShipDate: h.requestedShipDate.value } : {}),
    PrivateNote: memo(draft, idempotencyKey),
    ...(h.poNumber.value ? { CustomerMemo: { value: `PO ${h.poNumber.value}` } } : {}),
    ...(h.customer.email.value ? { BillEmail: { Address: h.customer.email.value } } : {}),
    ...(hasShip
      ? {
          ShipAddr: {
            Line1: ship.name.value ?? ship.line1.value ?? undefined,
            Line2: ship.name.value ? (ship.line1.value ?? undefined) : (ship.line2.value ?? undefined),
            Line3: ship.name.value ? (ship.line2.value ?? undefined) : undefined,
            City: ship.city.value ?? undefined,
            CountrySubDivisionCode: ship.region.value ?? undefined,
            PostalCode: ship.postalCode.value ?? undefined,
            Country: ship.country.value ?? undefined,
          },
        }
      : {}),
    Line: draft.lines.map((l, i) => {
      const { qty, unitPrice, description } = lineFacts(l);
      return {
        LineNum: i + 1,
        DetailType: "SalesItemLineDetail",
        Description: description,
        Amount: Number((qty * (unitPrice ?? 0)).toFixed(2)),
        SalesItemLineDetail: { ItemRef: { value: l.match.best!.itemId }, Qty: qty, ...(unitPrice !== null ? { UnitPrice: unitPrice } : {}) },
      };
    }),
  };
}

export const SALES_ORDER_MUTATION = /* GraphQL */ `
  mutation DeskCreateSalesOrder($input: Sales_CreateSalesOrderInput!) {
    salesCreateSalesOrder(input: $input) {
      id
      referenceNumber
      status
    }
  }
`;

/** Sales Order API input. UNVERIFIED field names — see the note at the top of this file. */
export function buildSalesOrderInput(draft: OrderDraft, idempotencyKey: string): Record<string, unknown> {
  const h = draft.header;
  const ship = h.shipTo;
  return {
    customer: { id: draft.customer.customerId },
    ...(h.orderDate.value ? { txnDate: h.orderDate.value } : {}),
    ...(h.requestedShipDate.value ? { shipDate: h.requestedShipDate.value } : {}),
    ...(h.poNumber.value ? { customerMemo: `PO ${h.poNumber.value}` } : {}),
    privateNote: memo(draft, idempotencyKey),
    ...([ship.line1.value, ship.city.value].some(Boolean)
      ? { shippingAddress: { streetAddressLine1: ship.line1.value, streetAddressLine2: ship.line2.value, city: ship.city.value, state: ship.region.value, zipCode: ship.postalCode.value, country: ship.country.value } }
      : {}),
    lines: draft.lines.map((l, i) => {
      const { qty, unitPrice, description } = lineFacts(l);
      return { sequence: i + 1, description, item: { id: l.match.best!.itemId }, quantity: qty, ...(unitPrice !== null ? { unitPrice } : {}) };
    }),
  };
}
