import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CatalogItem, CustomerRecord, OrderDraft } from "@desk/core";
import type { CreateSalesOrderResult, ErpConnector, PriceListEntry, StockLevel } from "./connector.js";

/**
 * Universal export connector (plan §6.2, §6.5): item/customer masters come from CSV
 * files the tenant exports; confirmed orders are written as CSV rows an ERP import
 * (QuickBooks IIF/Transaction Pro, NetSuite CSV import, Acumatica import scenario) can read.
 */
export type CsvConnectorOptions = {
  /** Directory where sales-order CSVs are written, one file per order */
  outDir: string;
  items: CatalogItem[];
  customers: CustomerRecord[];
  prices?: PriceListEntry[];
};

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SALES_ORDER_COLUMNS = [
  "ExternalId",
  "CustomerId",
  "CustomerName",
  "PONumber",
  "OrderDate",
  "RequestedShipDate",
  "ShipToName",
  "ShipToLine1",
  "ShipToLine2",
  "ShipToCity",
  "ShipToRegion",
  "ShipToPostalCode",
  "ShipToCountry",
  "PaymentTerms",
  "LineNo",
  "ItemSku",
  "ItemDescription",
  "Quantity",
  "UoM",
  "UnitPrice",
  "CustomerPartNumber",
  "LineNotes",
] as const;

/** Render a confirmed draft as CSV text (header + one row per line). Pure; used by the connector and the UI "download CSV" button. */
export function draftToSalesOrderCsv(draft: OrderDraft, externalId: string): string {
  const h = draft.header;
  const rows = draft.lines.map((l) => {
    const qty = l.erpQuantity ?? l.quantity.value;
    const factor = l.match.uomFactor ?? 1;
    const unitPrice = l.unitPrice.value !== null ? l.unitPrice.value / factor : (l.listPrice ?? null);
    return [
      externalId,
      draft.customer.customerId ?? "",
      draft.customer.name ?? h.customer.name.value ?? "",
      h.poNumber.value ?? "",
      h.orderDate.value ?? "",
      h.requestedShipDate.value ?? "",
      h.shipTo.name.value ?? "",
      h.shipTo.line1.value ?? "",
      h.shipTo.line2.value ?? "",
      h.shipTo.city.value ?? "",
      h.shipTo.region.value ?? "",
      h.shipTo.postalCode.value ?? "",
      h.shipTo.country.value ?? "",
      h.paymentTerms.value ?? "",
      l.lineNo,
      l.match.best?.sku ?? "",
      l.match.best?.description ?? l.rawDescription.value ?? "",
      qty ?? "",
      l.match.erpUom ?? l.rawUom.value ?? "",
      unitPrice === null ? "" : unitPrice.toFixed(4),
      l.rawPartNumber.value ?? "",
      l.notes.value ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });
  return [SALES_ORDER_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export class CsvConnector implements ErpConnector {
  readonly type = "csv" as const;
  constructor(private opts: CsvConnectorOptions) {}

  async ping() {
    return { ok: true, message: `csv export to ${this.opts.outDir}` };
  }
  async syncItems() {
    return { items: this.opts.items, cursor: null, syncedAt: new Date().toISOString() };
  }
  async syncCustomers() {
    return { items: this.opts.customers, cursor: null, syncedAt: new Date().toISOString() };
  }
  async syncPrices() {
    const prices =
      this.opts.prices ??
      this.opts.items.filter((i) => i.listPrice != null).map((i) => ({ customerId: null, itemId: i.id, price: i.listPrice!, currency: "USD" }));
    return { items: prices, cursor: null, syncedAt: new Date().toISOString() };
  }
  async checkStock(itemIds: string[]): Promise<StockLevel[]> {
    // CSV exports carry no live stock; report unknown as "not tracked" via a sentinel the validator treats as null.
    return itemIds.map((id) => ({ itemId: id, available: Number.POSITIVE_INFINITY, onHand: Number.POSITIVE_INFINITY }));
  }

  async createSalesOrder(draft: OrderDraft, opts: { idempotencyKey: string }): Promise<CreateSalesOrderResult> {
    const path = join(this.opts.outDir, `${safeName(opts.idempotencyKey)}.csv`);
    // Idempotent: if the file exists with the same key, return it rather than rewrite.
    try {
      await readFile(path);
      return { erpOrderId: opts.idempotencyKey, erpOrderNumber: null, url: path, status: "draft" };
    } catch {
      /* not yet written */
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, draftToSalesOrderCsv(draft, opts.idempotencyKey), "utf8");
    return { erpOrderId: opts.idempotencyKey, erpOrderNumber: null, url: path, status: "draft" };
  }

  async attachDocument(erpOrderId: string, file: { filename: string; bytes: Uint8Array }) {
    const path = join(this.opts.outDir, `${safeName(erpOrderId)}-${safeName(file.filename)}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    return { ok: true, attachmentId: path };
  }
}

function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

/** Parse a tenant's item-master CSV export into CatalogItems. Header names are matched loosely. */
export function parseItemsCsv(rows: string[][]): CatalogItem[] {
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cSku = col("sku", "itemnumber", "item", "itemid", "partnumber", "productcode", "code", "name");
  const cUpc = col("upc", "barcode", "ean", "gtin");
  const cMpn = col("mpn", "mfgpart", "manufacturerpartnumber", "mfgpartnumber", "vendorpart", "vendorpartnumber", "mfgno");
  const cDesc = col("description", "desc", "itemdescription", "salesdescription", "displayname", "productname");
  const cExtra = col("longdescription", "purchasedescription", "category", "brand", "keywords");
  const cUom = col("uom", "unit", "baseuom", "unitofmeasure", "stockuom", "salesunit");
  const cPack = col("pack", "casepack", "caseqty", "qtypercase", "packsize");
  const cPrice = col("price", "listprice", "saleprice", "unitprice", "rate", "baseprice");
  const cActive = col("active", "isactive", "status", "inactive");
  const cId = col("id", "internalid", "erpid", "listid");
  if (cSku < 0) throw new Error(`Item CSV needs a SKU/Item column; got: ${rows[0]!.join(", ")}`);

  const out: CatalogItem[] = [];
  for (const r of rows.slice(1)) {
    const sku = (r[cSku] ?? "").trim();
    if (!sku) continue;
    const pack = cPack >= 0 ? Number(r[cPack]) : NaN;
    const activeRaw = cActive >= 0 ? (r[cActive] ?? "").trim().toLowerCase() : "";
    const inactiveHeader = cActive >= 0 && header[cActive] === "inactive";
    let active = true;
    if (activeRaw) {
      const truthy = ["true", "yes", "y", "1", "active"].includes(activeRaw);
      const falsy = ["false", "no", "n", "0", "inactive", "discontinued"].includes(activeRaw);
      active = inactiveHeader ? !truthy : truthy || !falsy;
    }
    const price = cPrice >= 0 ? Number(String(r[cPrice] ?? "").replace(/[$,]/g, "")) : NaN;
    out.push({
      id: (cId >= 0 && r[cId]?.trim()) || sku,
      sku,
      upc: cUpc >= 0 ? r[cUpc]?.trim() || null : null,
      mpn: cMpn >= 0 ? r[cMpn]?.trim() || null : null,
      description: (cDesc >= 0 ? r[cDesc] : "")?.trim() || sku,
      extra: cExtra >= 0 ? r[cExtra]?.trim() || null : null,
      active,
      pack: {
        baseUom: (cUom >= 0 ? r[cUom]?.trim() : "") || "EA",
        factors: Number.isFinite(pack) && pack > 1 ? { CS: pack } : undefined,
      },
      listPrice: Number.isFinite(price) ? price : null,
    });
  }
  return out;
}

/** Parse a customers CSV export. */
export function parseCustomersCsv(rows: string[][]): CustomerRecord[] {
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const cId = col("id", "internalid", "customerid", "erpid", "listid", "accountnumber", "account");
  const cName = col("name", "customername", "companyname", "company", "displayname");
  const cEmail = col("email", "emails", "contactemail", "mainemail");
  const cDomain = col("domain", "domains", "emaildomain", "website", "url");
  const cAcct = col("accountnumber", "account", "customernumber", "custno");
  const cActive = col("active", "isactive", "status", "inactive");
  const cHold = col("credithold", "onhold", "hold");
  if (cName < 0) throw new Error(`Customer CSV needs a Name column; got: ${rows[0]!.join(", ")}`);

  const out: CustomerRecord[] = [];
  for (const r of rows.slice(1)) {
    const name = (r[cName] ?? "").trim();
    if (!name) continue;
    const domains = new Set<string>();
    const addDomain = (v: string | undefined) => {
      for (const part of (v ?? "").split(/[;,\s]+/)) {
        const m = part.toLowerCase().match(/(?:@|^(?:https?:\/\/)?(?:www\.)?)([a-z0-9.-]+\.[a-z]{2,})/);
        if (m) domains.add(m[1]!);
      }
    };
    if (cEmail >= 0) addDomain(r[cEmail]);
    if (cDomain >= 0) addDomain(r[cDomain]);
    const activeRaw = cActive >= 0 ? (r[cActive] ?? "").trim().toLowerCase() : "";
    const inactiveHeader = cActive >= 0 && header[cActive] === "inactive";
    let active = true;
    if (activeRaw) {
      const truthy = ["true", "yes", "y", "1", "active"].includes(activeRaw);
      active = inactiveHeader ? !truthy : truthy || !["false", "no", "n", "0", "inactive"].includes(activeRaw);
    }
    out.push({
      id: (cId >= 0 && r[cId]?.trim()) || name,
      name,
      domains: [...domains],
      accountNumber: cAcct >= 0 ? r[cAcct]?.trim() || null : null,
      active,
      creditHold: cHold >= 0 ? ["true", "yes", "y", "1"].includes((r[cHold] ?? "").trim().toLowerCase()) : false,
    });
  }
  return out;
}
