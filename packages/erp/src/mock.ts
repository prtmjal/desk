import type { CatalogItem, CustomerRecord, OrderDraft } from "@desk/core";
import { ConnectorValidationError, type CreateSalesOrderResult, type ErpConnector, type PriceListEntry, type StockLevel } from "./connector";

/**
 * In-memory connector for tests and demos. Never post to a real ERP from tests (CLAUDE.md).
 * Records every call so tests can assert idempotency.
 */
export class MockConnector implements ErpConnector {
  readonly type = "mock" as const;
  posted = new Map<string, CreateSalesOrderResult>();
  attachments: Array<{ erpOrderId: string; filename: string }> = [];
  calls: string[] = [];
  private seq = 1000;

  constructor(
    private data: {
      items: CatalogItem[];
      customers: CustomerRecord[];
      prices?: PriceListEntry[];
      stock?: Record<string, number>;
      failOnPost?: boolean;
    },
  ) {}

  async ping() {
    this.calls.push("ping");
    return { ok: true, message: "mock connector" };
  }

  async syncItems() {
    this.calls.push("syncItems");
    return { items: this.data.items, cursor: null, syncedAt: new Date().toISOString() };
  }

  async syncCustomers() {
    this.calls.push("syncCustomers");
    return { items: this.data.customers, cursor: null, syncedAt: new Date().toISOString() };
  }

  async syncPrices() {
    this.calls.push("syncPrices");
    const prices =
      this.data.prices ??
      this.data.items.filter((i) => i.listPrice != null).map((i) => ({ customerId: null, itemId: i.id, price: i.listPrice!, currency: "USD" }));
    return { items: prices, cursor: null, syncedAt: new Date().toISOString() };
  }

  async checkStock(itemIds: string[]): Promise<StockLevel[]> {
    this.calls.push("checkStock");
    return itemIds.map((id) => ({ itemId: id, available: this.data.stock?.[id] ?? 9999, onHand: this.data.stock?.[id] ?? 9999 }));
  }

  async createSalesOrder(draft: OrderDraft, opts: { idempotencyKey: string; asDraft?: boolean }): Promise<CreateSalesOrderResult> {
    this.calls.push("createSalesOrder");
    const existing = this.posted.get(opts.idempotencyKey);
    if (existing) return existing;
    if (this.data.failOnPost) throw new ConnectorValidationError("mock rejected order");
    const unmatched = draft.lines.filter((l) => l.match.status !== "matched" || !l.match.best);
    if (unmatched.length) throw new ConnectorValidationError(`Lines without a matched item: ${unmatched.map((l) => l.lineNo).join(", ")}`);
    if (!draft.customer.customerId) throw new ConnectorValidationError("Customer not identified");
    const id = `SO-${this.seq++}`;
    const result: CreateSalesOrderResult = { erpOrderId: id, erpOrderNumber: id, url: null, status: opts.asDraft ? "draft" : "open" };
    this.posted.set(opts.idempotencyKey, result);
    return result;
  }

  async attachDocument(erpOrderId: string, file: { filename: string }) {
    this.calls.push("attachDocument");
    this.attachments.push({ erpOrderId, filename: file.filename });
    return { ok: true, attachmentId: `att-${this.attachments.length}` };
  }
}
