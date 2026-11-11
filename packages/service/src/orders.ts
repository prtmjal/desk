/**
 * Review, confirmation and posting of order drafts (plan §6.2, §6.3).
 *
 * State machine:  new | needs_review  --confirm-->  confirmed  --post-->  posted
 *                         \--reject--> rejected
 * `confirmed` is held by the partial unique index on (tenant, customer, PO number),
 * so the same PO can never be confirmed twice; posting is idempotent on the order id.
 */
import {
  evaluateAutoPost,
  headerConfidence,
  lineConfidence,
  matchLine,
  normalizePartNumber,
  validateHeader,
  validateLine,
  type DraftLine,
  type OrderDraft,
  type ValidationIssue,
} from "@desk/core";
import { customers, documents, events, inboundMessages, integrations, items, orderLines, orders, rules, tenantSettings, toCatalogItem, usageMeters, withTenant, type Tx } from "@desk/db";
import { ConnectorAuthError, ConnectorValidationError } from "@desk/erp";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { logEvent, SYSTEM, type Actor } from "./audit";
import { itemErpIds } from "./catalog-sync";
import { errorText, nowOf, ServiceError, type ServiceDeps } from "./context";
import { postingAllowance } from "./entitlements";
import { learnFromOrder } from "./learn";
import { sendAcknowledgment } from "./notify";
import { ScopedCatalog, scopeIn, type Run } from "./scope";
import { effectiveSettings } from "./tenants";
import { autoPostPolicyFor, PgValidationContext, validationPolicyFrom } from "./validation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = OrderRow["status"];

/** Issues a person may knowingly accept by confirming. Everything else must be fixed first. */
const HARD_BLOCKERS: ReadonlySet<ValidationIssue["code"]> = new Set([
  "ITEM_UNMATCHED",
  "ITEM_AMBIGUOUS",
  "ITEM_INACTIVE",
  "QTY_MISSING",
  "UOM_UNKNOWN",
  "CUSTOMER_UNKNOWN",
  "CUSTOMER_CREDIT_HOLD",
  "DUPLICATE_PO",
]);

export function blockersOf(draft: OrderDraft): ValidationIssue[] {
  const all = [...draft.issues, ...draft.lines.flatMap((l) => l.issues)];
  const out = all.filter((i) => i.severity === "error" && HARD_BLOCKERS.has(i.code));
  if (draft.lines.length === 0) out.push({ code: "QTY_MISSING", severity: "error", lineNo: null, message: "The order has no lines", data: {} });
  return out;
}

export function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function bumpUsage(tx: Tx, tenantId: string, at: Date, delta: { received?: number; posted?: number; touchless?: number }): Promise<void> {
  const r = delta.received ?? 0;
  const p = delta.posted ?? 0;
  const t = delta.touchless ?? 0;
  await tx
    .insert(usageMeters)
    .values({ tenantId, period: periodOf(at), ordersReceived: r, ordersPosted: p, ordersTouchless: t })
    .onConflictDoUpdate({
      target: [usageMeters.tenantId, usageMeters.period],
      set: {
        ordersReceived: sql`${usageMeters.ordersReceived} + ${r}`,
        ordersPosted: sql`${usageMeters.ordersPosted} + ${p}`,
        ordersTouchless: sql`${usageMeters.ordersTouchless} + ${t}`,
        updatedAt: new Date(),
      },
    });
}

function columnsFromDraft(draft: OrderDraft) {
  const h = draft.header;
  const money = (n: number | null) => (n === null ? null : n.toFixed(2));
  return {
    customerId: draft.customer.customerId,
    poNumber: h.poNumber.value?.trim() || null,
    orderDate: isoDate(h.orderDate.value),
    requestedDate: isoDate(h.requestedShipDate.value),
    currency: h.currency.value,
    subtotal: money(h.subtotal.value),
    tax: money(h.tax.value),
    shipping: money(h.freight.value),
    total: money(h.total.value),
    confidence: draft.confidence.overall,
    draft,
  };
}

function isoDate(v: string | null): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Rewrite the order_lines mirror of a draft, keeping who resolved each line. */
async function writeLines(tx: Tx, tenantId: string, orderId: string, draft: OrderDraft, touched: { lineNos: number[]; by: string; at: Date } | null) {
  const prev = await tx.select({ lineNo: orderLines.lineNo, resolvedBy: orderLines.resolvedBy, resolvedAt: orderLines.resolvedAt }).from(orderLines).where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)));
  const prevBy = new Map(prev.map((p) => [p.lineNo, p]));
  await tx.delete(orderLines).where(and(eq(orderLines.tenantId, tenantId), eq(orderLines.orderId, orderId)));
  if (draft.lines.length === 0) return;
  await tx.insert(orderLines).values(
    draft.lines.map((l) => {
      const isTouched = touched?.lineNos.includes(l.lineNo) ?? false;
      const old = prevBy.get(l.lineNo);
      return {
        tenantId,
        orderId,
        lineNo: l.lineNo,
        rawText: [l.rawPartNumber.value, l.rawDescription.value].filter(Boolean).join(" ") || null,
        rawPartNumber: l.rawPartNumber.value,
        rawDescription: l.rawDescription.value,
        qty: l.quantity.value === null ? null : String(l.quantity.value),
        rawUom: l.rawUom.value,
        rawPrice: l.unitPrice.value === null ? null : String(l.unitPrice.value),
        matchedItemId: l.match.status === "matched" ? (l.match.best?.itemId ?? null) : null,
        matchMethod: l.match.best?.method ?? null,
        confidence: lineConfidence(l),
        qtyBase: l.erpQuantity === null ? null : String(l.erpQuantity),
        uomFactor: l.match.uomFactor === null ? null : String(l.match.uomFactor),
        resolvedBy: isTouched ? touched!.by : (old?.resolvedBy ?? "auto"),
        resolvedAt: isTouched ? touched!.at : (old?.resolvedAt ?? null),
      };
    }),
  );
}

/** Insert a freshly built draft (from the pipeline). */
export async function insertDraft(tx: Tx, tenantId: string, draft: OrderDraft, refs: { documentId: string | null; messageId: string | null }, at: Date): Promise<OrderRow> {
  const status: OrderStatus = draft.status === "confirmed" ? "new" : draft.status === "needs_review" ? "needs_review" : "new";
  const stored: OrderDraft = { ...draft, status };
  const [row] = await tx
    .insert(orders)
    .values({ id: draft.id, tenantId, documentId: refs.documentId, messageId: refs.messageId, status, ...columnsFromDraft(stored) })
    .returning();
  await writeLines(tx, tenantId, draft.id, stored, null);
  await bumpUsage(tx, tenantId, at, { received: 1 });
  await logEvent(tx, {
    tenantId,
    actor: SYSTEM,
    action: "created",
    entity: "order",
    entityId: draft.id,
    after: { poNumber: stored.header.poNumber.value, customer: stored.customer.name, lines: stored.lines.length, status, autoPostEligible: stored.autoPost.eligible },
  });
  return row!;
}

/** Re-run validation and the rules engine after a change. Pure with respect to the DB (reads only). */
export async function revalidate(run: Run, tenantId: string, draft: OrderDraft, self: { id: string; createdAt: Date }): Promise<OrderDraft> {
  const [settingsRow, ruleRows] = await run(async (tx) => [
    (await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)))[0],
    await tx.select().from(rules).where(eq(rules.tenantId, tenantId)),
  ] as const);
  const ctx = new PgValidationContext(run, tenantId, self);
  const policy = validationPolicyFrom(settingsRow?.settings);
  const lines: DraftLine[] = [];
  for (const l of draft.lines) {
    const clean: DraftLine = { ...l, normalizedPartNumber: normalizePartNumber(l.rawPartNumber.value), erpQuantity: null, listPrice: null, priceDeltaPct: null, issues: [] };
    lines.push(await validateLine(clean, draft.customer, ctx, policy));
  }
  const issues = await validateHeader(draft.header, draft.customer, lines, ctx, policy);
  const lineConfs = lines.map(lineConfidence);
  const hConf = headerConfidence(draft.header);
  const lConf = lineConfs.length ? lineConfs.reduce((a, b) => a + b, 0) / lineConfs.length : 0;
  const autoPost = evaluateAutoPost(
    { lines, headerIssues: issues, headerConfidence: hConf, lineConfidences: lineConfs, documentType: draft.documentType },
    autoPostPolicyFor(settingsRow?.settings, ruleRows, draft.customer.customerId),
  );
  const hasBlocking = issues.some((i) => i.severity === "error") || lines.some((l) => l.issues.some((i) => i.severity === "error"));
  return {
    ...draft,
    lines,
    issues,
    confidence: { header: hConf, lines: lConf, overall: lines.length ? 0.4 * hConf + 0.6 * lConf : hConf * 0.5 },
    autoPost,
    status: hasBlocking ? "needs_review" : "new",
  };
}

export type OrderEdit =
  | { type: "set_customer"; customerId: string }
  | { type: "set_line_item"; lineNo: number; itemId: string }
  | { type: "set_line"; lineNo: number; quantity?: number; unitPrice?: number | null; uom?: string | null }
  | { type: "use_list_price"; lineNo: number }
  | { type: "remove_line"; lineNo: number }
  | { type: "add_line"; itemId: string; quantity: number }
  | { type: "set_header"; poNumber?: string | null; requestedShipDate?: string | null; specialInstructions?: string | null };

const manual = <T>(value: T) => ({ value, confidence: 1, provenance: null });

async function loadForUpdate(tx: Tx, tenantId: string, orderId: string): Promise<OrderRow & { draft: OrderDraft }> {
  const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId))).for("update");
  if (!row || !row.draft) throw new ServiceError("not_found", "Order not found");
  return row as OrderRow & { draft: OrderDraft };
}

/** Apply one human edit in review, re-validate, and record the field change in the audit log. */
export async function applyEdit(deps: Pick<ServiceDeps, "db" | "now">, tenantId: string, orderId: string, edit: OrderEdit, actor: Actor): Promise<OrderDraft> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const row = await loadForUpdate(tx, tenantId, orderId);
    if (row.status !== "new" && row.status !== "needs_review") throw new ServiceError("conflict", `This order is ${row.status} and can no longer be edited`);
    const run = scopeIn(tx);
    const draft: OrderDraft = structuredClone(row.draft);
    const touched: number[] = [];
    let before: unknown = null;
    let after: unknown = null;
    const lineOf = (n: number) => {
      const l = draft.lines.find((x) => x.lineNo === n);
      if (!l) throw new ServiceError("not_found", `Line ${n} not found`);
      return l;
    };
    const itemOf = async (id: string) => {
      const [it] = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, id)));
      if (!it) throw new ServiceError("not_found", "Item not found");
      return toCatalogItem(it);
    };

    switch (edit.type) {
      case "set_customer": {
        const [c] = await tx.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, edit.customerId)));
        if (!c) throw new ServiceError("not_found", "Customer not found");
        before = { customer: draft.customer.name };
        draft.customer = { customerId: c.id, name: c.name, method: "manual", confidence: 1, candidates: draft.customer.candidates };
        after = { customer: c.name };
        // Aliases are per customer: lines that were not resolved may resolve now (deterministic layers only).
        const catalog = new ScopedCatalog(run, tenantId);
        for (const l of draft.lines) {
          if (l.match.status === "matched") continue;
          l.match = await matchLine(l, { catalog, customerId: c.id, reranker: null });
        }
        break;
      }
      case "set_line_item": {
        const l = lineOf(edit.lineNo);
        const item = await itemOf(edit.itemId);
        before = { lineNo: l.lineNo, item: l.match.best?.sku ?? null };
        const m = await matchLine({ ...l, rawPartNumber: manual(item.sku) }, { catalog: new ScopedCatalog(run, tenantId), customerId: null, reranker: null });
        l.match = {
          status: "matched",
          best: { itemId: item.id, sku: item.sku, description: item.description, method: "manual", score: 1, evidence: "Chosen in review" },
          candidates: l.match.candidates,
          uomFactor: m.uomFactor,
          erpUom: m.erpUom ?? item.pack.baseUom,
          abstainReason: null,
        };
        after = { lineNo: l.lineNo, item: item.sku };
        touched.push(l.lineNo);
        break;
      }
      case "set_line": {
        const l = lineOf(edit.lineNo);
        before = { lineNo: l.lineNo, quantity: l.quantity.value, unitPrice: l.unitPrice.value, uom: l.rawUom.value };
        if (edit.quantity !== undefined) {
          if (!(edit.quantity > 0)) throw new ServiceError("invalid", "Quantity must be greater than zero");
          l.quantity = manual(edit.quantity);
        }
        if (edit.unitPrice !== undefined) {
          if (edit.unitPrice !== null && !(edit.unitPrice >= 0)) throw new ServiceError("invalid", "Price cannot be negative");
          l.unitPrice = manual(edit.unitPrice) as DraftLine["unitPrice"];
        }
        if (edit.uom !== undefined) {
          l.rawUom = manual(edit.uom) as DraftLine["rawUom"];
          if (l.match.status === "matched" && l.match.best) {
            // Recompute the UoM factor against the item's pack definition.
            const item = await itemOf(l.match.best.itemId);
            const m = await matchLine({ ...l, rawPartNumber: manual(item.sku) }, { catalog: new ScopedCatalog(run, tenantId), customerId: null, reranker: null });
            l.match = { ...l.match, uomFactor: m.uomFactor, erpUom: m.erpUom ?? item.pack.baseUom };
          }
        }
        l.extendedPrice = manual(l.quantity.value !== null && l.unitPrice.value !== null ? Number((l.quantity.value * l.unitPrice.value).toFixed(2)) : null) as DraftLine["extendedPrice"];
        after = { lineNo: l.lineNo, quantity: l.quantity.value, unitPrice: l.unitPrice.value, uom: l.rawUom.value };
        touched.push(l.lineNo);
        break;
      }
      case "use_list_price": {
        const l = lineOf(edit.lineNo);
        if (l.listPrice === null) throw new ServiceError("invalid", "No list price is known for this item");
        before = { lineNo: l.lineNo, unitPrice: l.unitPrice.value };
        const price = Number((l.listPrice * (l.match.uomFactor ?? 1)).toFixed(4));
        l.unitPrice = manual(price);
        l.extendedPrice = manual(l.quantity.value !== null ? Number((l.quantity.value * price).toFixed(2)) : null) as DraftLine["extendedPrice"];
        after = { lineNo: l.lineNo, unitPrice: price };
        touched.push(l.lineNo);
        break;
      }
      case "remove_line": {
        const l = lineOf(edit.lineNo);
        before = { lineNo: l.lineNo, part: l.rawPartNumber.value, description: l.rawDescription.value, quantity: l.quantity.value };
        draft.lines = draft.lines.filter((x) => x.lineNo !== edit.lineNo);
        after = { removed: true };
        break;
      }
      case "add_line": {
        if (!(edit.quantity > 0)) throw new ServiceError("invalid", "Quantity must be greater than zero");
        const item = await itemOf(edit.itemId);
        const lineNo = draft.lines.reduce((m, l) => Math.max(m, l.lineNo), 0) + 1;
        const none = { value: null, confidence: 1, provenance: null };
        draft.lines.push({
          lineNo,
          customerLineRef: none,
          rawPartNumber: manual(item.sku),
          rawDescription: manual(item.description),
          quantity: manual(edit.quantity),
          rawUom: manual(item.pack.baseUom),
          unitPrice: none,
          extendedPrice: none,
          requestedDate: none,
          notes: none,
          match: {
            status: "matched",
            best: { itemId: item.id, sku: item.sku, description: item.description, method: "manual", score: 1, evidence: "Added in review" },
            candidates: [],
            uomFactor: 1,
            erpUom: item.pack.baseUom,
            abstainReason: null,
          },
          normalizedPartNumber: normalizePartNumber(item.sku),
          erpQuantity: null,
          listPrice: null,
          priceDeltaPct: null,
          issues: [],
        });
        after = { lineNo, item: item.sku, quantity: edit.quantity };
        touched.push(lineNo);
        break;
      }
      case "set_header": {
        before = { poNumber: draft.header.poNumber.value, requestedShipDate: draft.header.requestedShipDate.value, specialInstructions: draft.header.specialInstructions.value };
        if (edit.poNumber !== undefined) draft.header.poNumber = manual(edit.poNumber?.trim() || null) as OrderDraft["header"]["poNumber"];
        if (edit.requestedShipDate !== undefined) {
          if (edit.requestedShipDate && !isoDate(edit.requestedShipDate)) throw new ServiceError("invalid", "Use a date like 2026-12-31");
          draft.header.requestedShipDate = manual(edit.requestedShipDate || null) as OrderDraft["header"]["requestedShipDate"];
        }
        if (edit.specialInstructions !== undefined) draft.header.specialInstructions = manual(edit.specialInstructions || null) as OrderDraft["header"]["specialInstructions"];
        after = { poNumber: draft.header.poNumber.value, requestedShipDate: draft.header.requestedShipDate.value, specialInstructions: draft.header.specialInstructions.value };
        break;
      }
    }

    const next = await revalidate(run, tenantId, draft, { id: row.id, createdAt: row.createdAt });
    const at = nowOf(deps);
    await tx
      .update(orders)
      .set({ ...columnsFromDraft(next), status: next.status as OrderStatus, editCount: row.editCount + 1, updatedAt: at })
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    await writeLines(tx, tenantId, orderId, next, touched.length ? { lineNos: touched, by: actor.kind === "user" ? actor.id : "auto", at } : null);
    await logEvent(tx, { tenantId, actor, action: `edited:${edit.type}`, entity: "order", entityId: orderId, before, after, at });
    return next;
  });
}

export type ConfirmResult = { status: OrderStatus; erpOrderId: string | null; erpOrderNumber: string | null; shadow: boolean; error: string | null; acknowledged: boolean };

/**
 * Confirm a draft and post it to the ERP.
 *  - `auto`: called by the rules engine (no human) — only posts when not in shadow mode.
 *  - Human confirm in shadow mode marks the order confirmed and learns from it, but posts nothing.
 * Safe to call again on a confirmed order: posting is idempotent on the order id.
 */
export async function confirmOrder(deps: ServiceDeps, tenantId: string, orderId: string, actor: Actor, opts: { auto?: boolean } = {}): Promise<ConfirmResult> {
  const at = nowOf(deps);
  const auto = opts.auto ?? false;

  // 1. Claim: move to `confirmed` under the unique PO index.
  let claimed;
  try {
    claimed = await withTenant(deps.db, tenantId, async (tx) => {
      const row = await loadForUpdate(tx, tenantId, orderId);
      if (row.status === "posted" || row.status === "rejected") return { row, already: true as const };
      if (row.status !== "confirmed") {
        const fresh = await revalidate(scopeIn(tx), tenantId, row.draft, { id: row.id, createdAt: row.createdAt });
        const blockers = blockersOf(fresh);
        if (blockers.length) {
          await tx.update(orders).set({ ...columnsFromDraft(fresh), status: "needs_review" }).where(eq(orders.id, orderId));
          throw new ServiceError("blocked", `Fix before confirming: ${blockers.map((b) => (b.lineNo ? `line ${b.lineNo}: ` : "") + b.message).join("; ")}`, blockers);
        }
        if (auto && !fresh.autoPost.eligible) throw new ServiceError("blocked", "Order is no longer eligible for auto-post", fresh.autoPost.reasons);
        const confirmedDraft: OrderDraft = { ...fresh, status: "confirmed" };
        await tx
          .update(orders)
          .set({ ...columnsFromDraft(confirmedDraft), status: "confirmed", reviewedBy: actor.kind === "user" && UUID_RE.test(actor.id) ? actor.id : null, reviewedAt: at, autoPosted: auto, postError: null })
          .where(eq(orders.id, orderId));
        await logEvent(tx, { tenantId, actor, action: auto ? "auto_confirmed" : "confirmed", entity: "order", entityId: orderId, before: { status: row.status }, after: { status: "confirmed" }, at });
        return { row: { ...row, draft: confirmedDraft, status: "confirmed" as const, autoPosted: auto }, already: false as const };
      }
      return { row, already: false as const };
    });
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    const text = errorText(err);
    if (/orders_tenant_customer_po_uq|duplicate key/i.test(text)) {
      throw new ServiceError("conflict", "This customer already has a confirmed order with the same PO number. Reject this one or change the PO number.");
    }
    throw err;
  }
  const row = claimed.row;
  if (claimed.already) return { status: row.status, erpOrderId: row.erpOrderId, erpOrderNumber: row.erpOrderNumber, shadow: false, error: null, acknowledged: !!row.acknowledgedAt };

  // 2. Learn from the confirmation whether or not it posts (shadow mode still trains the desk).
  const learned = await withTenant(deps.db, tenantId, (tx) => learnFromOrder(tx, tenantId, row.draft, row.messageId, actor));

  // 3. Shadow mode / no ERP: stop at confirmed.
  const { settings, integration } = await withTenant(deps.db, tenantId, async (tx) => {
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const list = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), inArray(integrations.status, ["connected", "error"]))).orderBy(desc(integrations.updatedAt));
    return { settings: effectiveSettings(s?.settings), integration: list.find((i) => i.status === "connected") ?? list[0] ?? null };
  });
  const stop = async (reason: string, shadow: boolean): Promise<ConfirmResult> => {
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.update(orders).set({ postError: shadow ? null : reason }).where(eq(orders.id, orderId));
      await logEvent(tx, { tenantId, actor: SYSTEM, action: shadow ? "shadow_hold" : "post_skipped", entity: "order", entityId: orderId, after: { reason, aliasesLearned: learned } });
    });
    return { status: "confirmed", erpOrderId: null, erpOrderNumber: null, shadow, error: shadow ? null : reason, acknowledged: false };
  };
  if (settings.shadowMode) return stop("Shadow mode is on: nothing is posted to the ERP", true);
  if (!integration) return stop("No ERP is connected. Connect one in Settings, then post this order.", false);
  const allowance = await postingAllowance(deps, tenantId);
  if (!allowance.allowed) return stop(allowance.reason ?? "Posting is not available on this plan.", false);
  const connector = await deps.connectorFor(tenantId, integration);
  if (!connector) return stop(`The ${integration.type} connection needs attention before orders can post.`, false);

  // 4. Post. The connector receives the draft in ERP id space.
  try {
    const erpDraft = await withTenant(deps.db, tenantId, (tx) => toErpIds(tx, tenantId, row.draft));
    const posted = await connector.createSalesOrder(erpDraft, { idempotencyKey: `desk-${orderId}`, asDraft: true });
    let attached = false;
    if (row.documentId) {
      const doc = await withTenant(deps.db, tenantId, async (tx) => (await tx.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.id, row.documentId!))))[0]);
      const blob = doc?.storageRef ? await deps.blobs.get(doc.storageRef) : null;
      if (doc && blob) {
        try {
          attached = (await connector.attachDocument(posted.erpOrderId, { filename: doc.filename, mimeType: doc.mimeType ?? blob.contentType ?? "application/octet-stream", bytes: blob.bytes })).ok;
        } catch (err) {
          console.warn(`[desk] attachDocument failed for order ${orderId}: ${errorText(err)}`);
        }
      }
    }
    const touchless = row.autoPosted && row.editCount === 0;
    const firstPost = await withTenant(deps.db, tenantId, async (tx) => {
      const cur = await loadForUpdate(tx, tenantId, orderId);
      if (cur.status === "posted") return false;
      await tx
        .update(orders)
        .set({ status: "posted", draft: { ...cur.draft, status: "posted" }, erpOrderId: posted.erpOrderId, erpOrderNumber: posted.erpOrderNumber, erpUrl: posted.url, postedAt: at, touchless, postError: null })
        .where(eq(orders.id, orderId));
      await bumpUsage(tx, tenantId, at, { posted: 1, touchless: touchless ? 1 : 0 });
      await logEvent(tx, { tenantId, actor: { kind: "integration", id: integration.id }, action: "posted", entity: "order", entityId: orderId, after: { erpOrderId: posted.erpOrderId, erpOrderNumber: posted.erpOrderNumber, erpStatus: posted.status, documentAttached: attached, touchless } });
      return true;
    });
    if (firstPost && deps.usage) {
      try {
        await deps.usage.orderPosted({ tenantId, orderId, touchless, at });
      } catch (err) {
        console.warn(`[desk] usage report failed for order ${orderId}: ${errorText(err)}`);
      }
    }
    let acknowledged = false;
    if (firstPost && settings.ackEnabled && settings.ackAutoSend) {
      acknowledged = (await sendAcknowledgment(deps, tenantId, orderId, SYSTEM).catch(() => ({ ok: false }))).ok;
    }
    return { status: "posted", erpOrderId: posted.erpOrderId, erpOrderNumber: posted.erpOrderNumber, shadow: false, error: null, acknowledged };
  } catch (err) {
    const message = errorText(err);
    const backToReview = err instanceof ConnectorValidationError;
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.update(orders).set({ status: backToReview ? "needs_review" : "confirmed", postError: message }).where(eq(orders.id, orderId));
      if (err instanceof ConnectorAuthError) await tx.update(integrations).set({ status: "error", lastError: message }).where(eq(integrations.id, integration.id));
      await logEvent(tx, { tenantId, actor: { kind: "integration", id: integration.id }, action: "post_failed", entity: "order", entityId: orderId, after: { error: message, returnedToReview: backToReview } });
    });
    return { status: backToReview ? "needs_review" : "confirmed", erpOrderId: null, erpOrderNumber: null, shadow: false, error: message, acknowledged: false };
  }
}

/** Translate our row ids into the ERP's ids, which is what connectors expect. */
async function toErpIds(tx: Tx, tenantId: string, draft: OrderDraft): Promise<OrderDraft> {
  const out: OrderDraft = structuredClone(draft);
  if (out.customer.customerId) {
    const [c] = await tx.select({ erpId: customers.erpId }).from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, out.customer.customerId)));
    if (!c) throw new ConnectorValidationError("The customer no longer exists");
    out.customer.customerId = c.erpId;
  }
  const ids = out.lines.map((l) => l.match.best?.itemId).filter((x): x is string => !!x);
  const erp = await itemErpIds(tx, tenantId, ids);
  for (const l of out.lines) {
    if (!l.match.best) continue;
    const erpId = erp.get(l.match.best.itemId);
    if (!erpId) throw new ConnectorValidationError(`Item ${l.match.best.sku} has no ERP id. Run a sync and try again.`);
    l.match.best = { ...l.match.best, itemId: erpId };
  }
  return out;
}

export async function rejectOrder(deps: Pick<ServiceDeps, "db" | "now">, tenantId: string, orderId: string, reason: string, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const row = await loadForUpdate(tx, tenantId, orderId);
    if (row.status === "posted") throw new ServiceError("conflict", "This order is already in the ERP. Cancel it there.");
    if (row.status === "rejected") return;
    await tx.update(orders).set({ status: "rejected", draft: { ...row.draft, status: "rejected" }, rejectReason: reason.trim().slice(0, 500) || "No reason given", reviewedAt: nowOf(deps) }).where(eq(orders.id, orderId));
    await logEvent(tx, { tenantId, actor, action: "rejected", entity: "order", entityId: orderId, before: { status: row.status }, after: { status: "rejected", reason } });
  });
}

/** Put a rejected order back in the review queue. */
export async function reopenOrder(deps: Pick<ServiceDeps, "db">, tenantId: string, orderId: string, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const row = await loadForUpdate(tx, tenantId, orderId);
    if (row.status !== "rejected" && row.status !== "confirmed") throw new ServiceError("conflict", `A ${row.status} order cannot be reopened`);
    const fresh = await revalidate(scopeIn(tx), tenantId, row.draft, { id: row.id, createdAt: row.createdAt });
    await tx.update(orders).set({ ...columnsFromDraft(fresh), status: fresh.status as OrderStatus, rejectReason: null, postError: null }).where(eq(orders.id, orderId));
    await logEvent(tx, { tenantId, actor, action: "reopened", entity: "order", entityId: orderId, before: { status: row.status }, after: { status: fresh.status } });
  });
}

export type OrderListItem = Pick<OrderRow, "id" | "status" | "poNumber" | "total" | "confidence" | "createdAt" | "postedAt" | "erpOrderNumber" | "erpUrl" | "autoPosted" | "touchless" | "shadowEligible" | "rejectReason" | "postError" | "editCount"> & {
  customerName: string | null;
  lineCount: number;
  issueCount: number;
  sender: string | null;
  subject: string | null;
};

export async function listOrders(deps: Pick<ServiceDeps, "db">, tenantId: string, opts: { statuses?: OrderStatus[]; q?: string; limit?: number; offset?: number } = {}): Promise<OrderListItem[]> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const q = opts.q?.trim();
    const rows = await tx
      .select({ order: orders, customerName: customers.name, sender: inboundMessages.fromAddress, subject: inboundMessages.subject })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(inboundMessages, eq(inboundMessages.id, orders.messageId))
      .where(
        and(
          eq(orders.tenantId, tenantId),
          opts.statuses?.length ? inArray(orders.status, opts.statuses) : undefined,
          q ? or(ilike(orders.poNumber, `%${q}%`), ilike(customers.name, `%${q}%`), ilike(inboundMessages.subject, `%${q}%`), ilike(orders.erpOrderNumber, `%${q}%`)) : undefined,
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(Math.min(opts.limit ?? 100, 500))
      .offset(opts.offset ?? 0);
    return rows.map(({ order: o, customerName, sender, subject }) => {
      const d = o.draft;
      return {
        id: o.id,
        status: o.status,
        poNumber: o.poNumber,
        // The printed total when the document has one, otherwise what the lines add up to.
        total: o.total ?? (d && d.lines.some((l) => l.unitPrice.value !== null) ? d.lines.reduce((sum, l) => sum + (l.quantity.value ?? 0) * (l.unitPrice.value ?? 0), 0).toFixed(2) : null),
        confidence: o.confidence,
        createdAt: o.createdAt,
        postedAt: o.postedAt,
        erpOrderNumber: o.erpOrderNumber,
        erpUrl: o.erpUrl,
        autoPosted: o.autoPosted,
        touchless: o.touchless,
        shadowEligible: o.shadowEligible,
        rejectReason: o.rejectReason,
        postError: o.postError,
        editCount: o.editCount,
        customerName: customerName ?? d?.customer.name ?? d?.header.customer.name.value ?? null,
        lineCount: d?.lines.length ?? 0,
        issueCount: d ? d.issues.filter((i) => i.severity !== "info").length + d.lines.reduce((n, l) => n + l.issues.filter((i) => i.severity !== "info").length, 0) : 0,
        sender,
        subject,
      };
    });
  });
}

export type OrderDetail = {
  order: OrderRow & { draft: OrderDraft };
  message: typeof inboundMessages.$inferSelect | null;
  documents: Array<typeof documents.$inferSelect>;
  history: Array<{ id: string; actor: string; action: string; before: unknown; after: unknown; at: Date }>;
  /** Next order waiting for review, for keyboard navigation. */
  nextId: string | null;
  prevId: string | null;
};

export async function getOrder(deps: Pick<ServiceDeps, "db">, tenantId: string, orderId: string): Promise<OrderDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
  return withTenant(deps.db, tenantId, async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    if (!order || !order.draft) return null;
    const message = order.messageId ? ((await tx.select().from(inboundMessages).where(eq(inboundMessages.id, order.messageId)))[0] ?? null) : null;
    const docs = order.messageId
      ? await tx.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.messageId, order.messageId))).orderBy(documents.createdAt)
      : order.documentId
        ? await tx.select().from(documents).where(eq(documents.id, order.documentId))
        : [];
    const history = await tx
      .select({ id: events.id, actor: events.actor, action: events.action, before: events.before, after: events.after, at: events.at })
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.entity, "order"), eq(events.entityId, orderId)))
      .orderBy(desc(events.at))
      .limit(100);
    const queue = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.status, ["new", "needs_review"])))
      .orderBy(desc(orders.createdAt))
      .limit(500);
    const idx = queue.findIndex((q) => q.id === orderId);
    const nextId = idx >= 0 ? (queue[idx + 1]?.id ?? null) : (queue[0]?.id ?? null);
    const prevId = idx > 0 ? queue[idx - 1]!.id : null;
    return { order: order as OrderRow & { draft: OrderDraft }, message, documents: docs, history, nextId, prevId };
  });
}

/** Mark orders the rules engine would have posted while shadow mode is on. */
export async function markShadowEligible(tx: Tx, orderId: string): Promise<void> {
  await tx.update(orders).set({ shadowEligible: true }).where(eq(orders.id, orderId));
}
