/**
 * Connector factory: turns a tenant's `integrations` row into a live ErpConnector.
 *   demo               — in-memory mock ERP (demo mode and tests); accepts every valid order
 *   csv                — universal export fallback (plan §6.2): "posting" assigns an export id,
 *                        the order then appears in the CSV download for import into any ERP
 *   quickbooks_online  — Intuit QuickBooks Online; OAuth tokens live in the secrets table
 */
import type { CatalogItem, CustomerRecord, OrderDraft } from "@desk/core";
import { integrations, withTenant, type Db } from "@desk/db";
import { ConnectorValidationError, MockConnector, QuickBooksConnector, type CreateSalesOrderResult, type ErpConnector, type QboEnvironment, type QboTokens, type StockLevel } from "@desk/erp";
import { eq } from "drizzle-orm";
import type { IntegrationRow } from "./context.js";
import { getSecret, putSecret } from "./secrets.js";

export type ConnectorKind = "demo" | "csv" | "quickbooks_online";

/** "Posts" by assigning an export id. Item and customer masters come from CSV imports, not from here. */
export class CsvExportConnector implements ErpConnector {
  readonly type = "csv" as const;
  async ping() {
    return { ok: true, message: "CSV export: confirmed orders are available as a download" };
  }
  async syncItems() {
    return { items: [] as CatalogItem[], cursor: null, syncedAt: new Date().toISOString() };
  }
  async syncCustomers() {
    return { items: [] as CustomerRecord[], cursor: null, syncedAt: new Date().toISOString() };
  }
  async syncPrices() {
    return { items: [], cursor: null, syncedAt: new Date().toISOString() };
  }
  async checkStock(): Promise<StockLevel[]> {
    return [];
  }
  async createSalesOrder(draft: OrderDraft, opts: { idempotencyKey: string }): Promise<CreateSalesOrderResult> {
    if (!draft.customer.customerId) throw new ConnectorValidationError("Customer not identified");
    const id = `CSV-${opts.idempotencyKey.replace(/^desk-/, "").slice(0, 8).toUpperCase()}`;
    return { erpOrderId: id, erpOrderNumber: id, url: null, status: "open" };
  }
  async attachDocument() {
    return { ok: false, attachmentId: null };
  }
}

export type ConnectorFactoryConfig = {
  db: Db;
  secretsKey: string | null;
  quickbooks: { clientId: string; clientSecret: string; environment: QboEnvironment } | null;
  /** Demo ERP master data (returned by sync). */
  demo?: { items: CatalogItem[]; customers: CustomerRecord[]; stock?: Record<string, number> };
  fetch?: typeof fetch;
};

export function makeConnectorFactory(cfg: ConnectorFactoryConfig) {
  // One mock ERP per tenant per process, so idempotency holds across calls in demo mode.
  const demos = new Map<string, MockConnector>();
  return async function connectorFor(tenantId: string, integration: IntegrationRow): Promise<ErpConnector | null> {
    switch (integration.type as ConnectorKind) {
      case "demo": {
        let c = demos.get(tenantId);
        if (!c) {
          c = new MockConnector({ items: cfg.demo?.items ?? [], customers: cfg.demo?.customers ?? [], stock: cfg.demo?.stock });
          demos.set(tenantId, c);
        }
        return c;
      }
      case "csv":
        return new CsvExportConnector();
      case "quickbooks_online": {
        if (!cfg.quickbooks || !cfg.secretsKey || !integration.credentialsRef) return null;
        const key = cfg.secretsKey;
        const ref = integration.credentialsRef;
        const tokens = await withTenant(cfg.db, tenantId, (tx) => getSecret<QboTokens>(tx, tenantId, ref, key));
        const realmId = (integration.config as { realmId?: string }).realmId;
        if (!tokens || !realmId) return null;
        return new QuickBooksConnector({
          ...cfg.quickbooks,
          realmId,
          tokens,
          orderEntity: (integration.config as { orderEntity?: "estimate" | "sales_order" }).orderEntity ?? "estimate",
          fetch: cfg.fetch,
          // Intuit rotates refresh tokens: persist every refresh or the connection dies in 24h.
          onTokens: async (t) => {
            await withTenant(cfg.db, tenantId, async (tx) => {
              await putSecret(tx, tenantId, ref, t, key);
              await tx.update(integrations).set({ status: "connected", lastError: null }).where(eq(integrations.id, integration.id));
            });
          },
        });
      }
      default:
        return null;
    }
  };
}
