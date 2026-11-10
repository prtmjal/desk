import {
  DEFAULT_AUTOPOST,
  DEFAULT_POLICY,
  type AutoPostPolicy,
  type CatalogItem,
  type CustomerRecord,
  type ValidationContext,
  type ValidationPolicy,
} from "@desk/core";
import { customers, items, orders, priceListItems, rules, toCatalogItem, type TenantSettings } from "@desk/db";
import { and, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import type { Run } from "./scope.js";
import { effectiveSettings } from "./tenants.js";

/** ERP facts for the validator, read from the mirrored tables (plan §6.2 "validation against ERP"). */
export class PgValidationContext implements ValidationContext {
  constructor(
    private run: Run,
    private tenantId: string,
    /** The order being (re)validated, so it does not flag itself as its own duplicate. */
    private self: { id: string; createdAt: Date } | null = null,
  ) {}

  getItem(itemId: string): Promise<CatalogItem | undefined> {
    return this.run(async (tx) => {
      const [row] = await tx.select().from(items).where(and(eq(items.tenantId, this.tenantId), eq(items.id, itemId)));
      return row ? toCatalogItem(row) : undefined;
    });
  }

  getPrice(customerId: string | null, itemId: string): Promise<number | null> {
    return this.run(async (tx) => {
      if (customerId) {
        const [c] = await tx.select({ priceListId: customers.priceListId }).from(customers).where(and(eq(customers.tenantId, this.tenantId), eq(customers.id, customerId)));
        if (c?.priceListId) {
          const [p] = await tx
            .select({ price: priceListItems.price })
            .from(priceListItems)
            .where(and(eq(priceListItems.tenantId, this.tenantId), eq(priceListItems.priceListId, c.priceListId), eq(priceListItems.itemId, itemId)));
          if (p) return Number(p.price);
        }
      }
      const [row] = await tx.select({ listPrice: items.listPrice }).from(items).where(and(eq(items.tenantId, this.tenantId), eq(items.id, itemId)));
      return row?.listPrice == null ? null : Number(row.listPrice);
    });
  }

  getStock(itemId: string): Promise<number | null> {
    return this.run(async (tx) => {
      const [row] = await tx.select({ stock: items.stockAvailable }).from(items).where(and(eq(items.tenantId, this.tenantId), eq(items.id, itemId)));
      return row?.stock == null ? null : Number(row.stock);
    });
  }

  isDuplicatePo(customerId: string | null, poNumber: string): Promise<boolean> {
    if (!customerId || !poNumber) return Promise.resolve(false);
    return this.run(async (tx) => {
      const committed = inArray(orders.status, ["confirmed", "posted"]);
      const self = this.self;
      const rows = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.tenantId, this.tenantId),
            eq(orders.customerId, customerId),
            sql`lower(${orders.poNumber}) = lower(${poNumber})`,
            self
              ? and(ne(orders.id, self.id), or(committed, and(ne(orders.status, "rejected"), lt(orders.createdAt, self.createdAt))))
              : ne(orders.status, "rejected"),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  customerOnCreditHold(customerId: string): Promise<boolean> {
    return this.run(async (tx) => {
      const [row] = await tx.select({ hold: customers.creditHold }).from(customers).where(and(eq(customers.tenantId, this.tenantId), eq(customers.id, customerId)));
      return row?.hold ?? false;
    });
  }
}

export async function loadCustomerRecords(run: Run, tenantId: string): Promise<CustomerRecord[]> {
  const rows = await run((tx) => tx.select().from(customers).where(eq(customers.tenantId, tenantId)));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    domains: c.domains,
    accountNumber: c.accountNumber,
    aka: c.aka,
    active: c.active,
    creditHold: c.creditHold,
    priceListId: c.priceListId,
  }));
}

export function validationPolicyFrom(settings: TenantSettings | null | undefined): ValidationPolicy {
  const s = effectiveSettings(settings);
  return { ...DEFAULT_POLICY, priceTolerancePct: s.priceTolerancePct, stockShortSeverity: s.holdOnStockShort ? "error" : "warning" };
}

export type AutoPostRuleParams = { enabled?: boolean; minLineMatchScore?: number; maxPriceDeltaPct?: number };

/**
 * Auto-post policy for one customer: tenant settings, overridden by a per-customer
 * `auto_post` rule when one exists (plan §6.2 "per-customer auto-post thresholds").
 * Shadow mode is applied by the caller, not here: the policy answers "would this post".
 */
export function autoPostPolicyFor(
  settings: TenantSettings | null | undefined,
  ruleRows: Array<Pick<typeof rules.$inferSelect, "customerId" | "type" | "params" | "active">>,
  customerId: string | null,
): AutoPostPolicy {
  const s = effectiveSettings(settings);
  const base: AutoPostPolicy = {
    ...DEFAULT_AUTOPOST,
    enabled: s.autoPost,
    minLineMatchScore: s.autoPostThreshold,
    maxPriceDeltaPct: s.priceTolerancePct,
    // Shadow mode is enforced where posting happens, so drafts still record "would have posted".
    shadowMode: false,
  };
  const rule = customerId ? ruleRows.find((r) => r.active && r.type === "auto_post" && r.customerId === customerId) : undefined;
  if (!rule) return base;
  const p = rule.params as AutoPostRuleParams;
  return {
    ...base,
    enabled: p.enabled ?? base.enabled,
    minLineMatchScore: p.minLineMatchScore ?? base.minLineMatchScore,
    maxPriceDeltaPct: p.maxPriceDeltaPct ?? base.maxPriceDeltaPct,
  };
}
