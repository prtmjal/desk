import type { OrderDraft, ValidationIssue } from "@desk/core";
import { customers, orderLines, orders, tenantSettings, withTenant } from "@desk/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { nowOf, type ServiceDeps } from "./context";
import { effectiveSettings } from "./tenants";

export const ISSUE_LABELS: Record<ValidationIssue["code"], string> = {
  ITEM_UNMATCHED: "Item not found",
  ITEM_AMBIGUOUS: "Several possible items",
  ITEM_INACTIVE: "Inactive item",
  PRICE_MISMATCH: "Price differs from list",
  PRICE_MISSING: "No list price",
  STOCK_SHORT: "Short stock",
  UOM_UNKNOWN: "Unknown unit of measure",
  PACK_ROUNDING: "Pack rounding",
  MIN_QTY: "Below minimum quantity",
  QTY_MISSING: "Quantity missing",
  CUSTOMER_UNKNOWN: "Customer not identified",
  CUSTOMER_CREDIT_HOLD: "Customer on credit hold",
  DUPLICATE_PO: "Duplicate PO number",
  PO_MISSING: "No PO number",
  TOTALS_MISMATCH: "Totals do not add up",
  LOW_CONFIDENCE: "Low extraction confidence",
  NOT_AN_ORDER: "May not be an order",
};

export type DashboardMetrics = {
  days: number;
  ordersReceived: number;
  ordersPosted: number;
  ordersConfirmedShadow: number;
  waiting: number;
  rejected: number;
  touchlessRate: number | null;
  /** Share of orders the rules engine would have posted while in shadow mode. */
  shadowTouchlessRate: number | null;
  lineAccuracy: number | null;
  minutesSaved: number;
  exceptionsByType: Array<{ code: string; label: string; count: number }>;
  byCustomer: Array<{ customerId: string | null; name: string; orders: number; touchless: number; waiting: number }>;
  daily: Array<{ day: string; received: number; posted: number }>;
};

/** Dashboard numbers (plan §6.2): processed, touchless %, line accuracy, time saved, exceptions by type and customer. */
export async function dashboardMetrics(deps: Pick<ServiceDeps, "db" | "now">, tenantId: string, days = 30): Promise<DashboardMetrics> {
  const since = new Date(nowOf(deps).getTime() - days * 86_400_000);
  return withTenant(deps.db, tenantId, async (tx) => {
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const minutesPerOrder = effectiveSettings(s?.settings).minutesPerOrder;
    const rows = await tx
      .select({ id: orders.id, status: orders.status, customerId: orders.customerId, customerName: customers.name, touchless: orders.touchless, shadowEligible: orders.shadowEligible, createdAt: orders.createdAt, postedAt: orders.postedAt, draft: orders.draft })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(and(eq(orders.tenantId, tenantId), gte(orders.createdAt, since)));

    const posted = rows.filter((r) => r.status === "posted");
    const confirmed = rows.filter((r) => r.status === "confirmed");
    const waiting = rows.filter((r) => r.status === "new" || r.status === "needs_review");
    const done = [...posted, ...confirmed];

    // Line accuracy on confirmed/posted orders: lines no person had to correct.
    const doneIds = done.map((r) => r.id);
    let lineAccuracy: number | null = null;
    if (doneIds.length) {
      const [agg] = await tx
        .select({ total: sql<number>`count(*)::int`, auto: sql<number>`count(*) filter (where ${orderLines.resolvedBy} = 'auto')::int` })
        .from(orderLines)
        .where(and(eq(orderLines.tenantId, tenantId), inArray(orderLines.orderId, doneIds)));
      lineAccuracy = agg && agg.total > 0 ? agg.auto / agg.total : null;
    }

    const counts = new Map<string, number>();
    for (const r of waiting) {
      const d = r.draft as OrderDraft | null;
      if (!d) continue;
      const codes = new Set([...d.issues, ...d.lines.flatMap((l) => l.issues)].filter((i) => i.severity !== "info").map((i) => i.code));
      for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
    }

    const cust = new Map<string, { customerId: string | null; name: string; orders: number; touchless: number; waiting: number }>();
    for (const r of rows) {
      const key = r.customerId ?? "unknown";
      const e = cust.get(key) ?? { customerId: r.customerId, name: r.customerName ?? "Unidentified", orders: 0, touchless: 0, waiting: 0 };
      e.orders++;
      if (r.touchless || r.shadowEligible) e.touchless++;
      if (r.status === "new" || r.status === "needs_review") e.waiting++;
      cust.set(key, e);
    }

    const daily = new Map<string, { day: string; received: number; posted: number }>();
    for (let i = Math.min(days, 14) - 1; i >= 0; i--) {
      const day = new Date(nowOf(deps).getTime() - i * 86_400_000).toISOString().slice(0, 10);
      daily.set(day, { day, received: 0, posted: 0 });
    }
    for (const r of rows) {
      const d = daily.get(r.createdAt.toISOString().slice(0, 10));
      if (d) d.received++;
      const p = r.postedAt ? daily.get(r.postedAt.toISOString().slice(0, 10)) : undefined;
      if (p) p.posted++;
    }

    const nonRejected = rows.filter((r) => r.status !== "rejected");
    return {
      days,
      ordersReceived: rows.length,
      ordersPosted: posted.length,
      ordersConfirmedShadow: confirmed.length,
      waiting: waiting.length,
      rejected: rows.length - nonRejected.length,
      touchlessRate: posted.length ? posted.filter((r) => r.touchless).length / posted.length : null,
      shadowTouchlessRate: nonRejected.length ? nonRejected.filter((r) => r.touchless || r.shadowEligible).length / nonRejected.length : null,
      lineAccuracy,
      minutesSaved: done.length * minutesPerOrder,
      exceptionsByType: [...counts.entries()].map(([code, count]) => ({ code, label: ISSUE_LABELS[code as ValidationIssue["code"]] ?? code, count })).sort((a, b) => b.count - a.count),
      byCustomer: [...cust.values()].sort((a, b) => b.orders - a.orders).slice(0, 12),
      daily: [...daily.values()],
    };
  });
}
