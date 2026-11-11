import type { CatalogItem, CustomerRecord, OrderDraft } from "@desk/core";

/**
 * One interface for every ERP (plan §7.3 #3). CSV export is a connector too, so any
 * prospect can pilot before their ERP connector exists (plan §6.2).
 */
export type ConnectorType = "mock" | "csv" | "quickbooks_online" | "netsuite" | "acumatica" | "odoo" | "fishbowl";

export type SyncResult<T> = { items: T[]; cursor: string | null; syncedAt: string };

export type PriceListEntry = { customerId: string | null; itemId: string; price: number; currency: string; minQty?: number | null };

export type StockLevel = { itemId: string; available: number; onHand: number; location?: string | null };

export type CreateSalesOrderResult = {
  erpOrderId: string;
  erpOrderNumber: string | null;
  /** Deep link into the ERP record, when the ERP has one */
  url: string | null;
  status: "draft" | "pending_approval" | "open";
  raw?: unknown;
};

/**
 * Id convention: everything that crosses this interface is in the ERP's id space.
 * `sync*` return records whose `id` is the ERP id; `createSalesOrder` receives a draft
 * whose `customer.customerId` and `lines[].match.best.itemId` are ERP ids (the service
 * layer translates from its own row ids before calling).
 */
export interface ErpConnector {
  readonly type: ConnectorType;
  /** Cheap health probe used by the integrations page and the scheduler. */
  ping(): Promise<{ ok: boolean; message: string }>;
  syncItems(cursor?: string | null): Promise<SyncResult<CatalogItem>>;
  syncCustomers(cursor?: string | null): Promise<SyncResult<CustomerRecord>>;
  syncPrices(cursor?: string | null): Promise<SyncResult<PriceListEntry>>;
  checkStock(itemIds: string[]): Promise<StockLevel[]>;
  /**
   * Post a confirmed draft as a sales order. Must be idempotent on `idempotencyKey`
   * (plan §6.4: no duplicate posts). Connectors that cannot enforce this natively
   * look the key up in their own external-id field before creating.
   */
  createSalesOrder(draft: OrderDraft, opts: { idempotencyKey: string; asDraft?: boolean }): Promise<CreateSalesOrderResult>;
  attachDocument(erpOrderId: string, file: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<{ ok: boolean; attachmentId: string | null }>;
}

/** Thrown by connectors for errors the user must act on (expired OAuth, missing permission). */
export class ConnectorAuthError extends Error {
  constructor(message: string, public readonly type: ConnectorType) {
    super(message);
    this.name = "ConnectorAuthError";
  }
}

/** Thrown when the ERP rejected the order body (validation); the draft goes back to review. */
export class ConnectorValidationError extends Error {
  constructor(message: string, public readonly details: unknown = null) {
    super(message);
    this.name = "ConnectorValidationError";
  }
}
