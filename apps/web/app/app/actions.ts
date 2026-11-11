"use server";

import { randomUUID } from "node:crypto";
import type { TenantSettings } from "@desk/db";
import {
  applyEdit,
  confirmOrder,
  connectSimple,
  deleteAlias,
  disconnectIntegration,
  errorText,
  importCustomersCsv,
  importItemsCsv,
  processMessage,
  receiveMessage,
  rejectOrder,
  reopenOrder,
  resetMessage,
  runSync,
  searchCustomers,
  searchItems,
  sendAcknowledgment,
  sendWeeklyDigest,
  ServiceError,
  setCustomerAutoPost,
  updateCustomer,
  updateIntegrationConfig,
  updateSettings,
  getTenant,
  type OrderEdit,
} from "@desk/service";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { redirect } from "next/navigation";
import { isInngestConfigured, isStripeConfigured } from "@/lib/env";
import { createCheckoutUrl, createPortalUrl, type PlanKey } from "@/lib/server/billing";
import { dispatchProcess } from "@/lib/server/dispatch";
import { requireAdmin, requireSession } from "@/lib/server/session";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

/** Errors meant for the user come back as a message; anything else is logged and generalized. */
function failure(err: unknown): ActionResult {
  if (err instanceof ServiceError) return { ok: false, message: err.message };
  if (err instanceof Error && /only an owner or admin/i.test(err.message)) return { ok: false, message: err.message };
  // Details stay in the server log (truncated: a failed query carries its parameters).
  console.error(`[action] ${errorText(err).slice(0, 600)}`);
  return { ok: false, message: "Something went wrong on our side and nothing was changed. Please try again." };
}

const refresh = () => revalidatePath("/app", "layout");

// ---- Intake ---------------------------------------------------------------------------

export async function uploadPosAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    const sender = String(form.get("sender") ?? "").trim() || null;
    if (files.length === 0) return { ok: false, message: "Choose at least one file." };
    if (files.length > 25) return { ok: false, message: "Upload up to 25 files at a time." };
    let queued = 0;
    let duplicates = 0;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await receiveMessage(s.deps, s.tenantId, { source: "upload", messageId: `upload-${randomUUID()}`, from: sender, to: null, subject: file.name, bodyText: null, attachments: [{ filename: file.name, bytes, mimeType: file.type || null }] });
      if (r.ignored || r.duplicate) {
        duplicates++;
        continue;
      }
      // With a job runner the work is queued; without one, short uploads finish before the page returns.
      if (isInngestConfigured() || files.length > 3) await dispatchProcess(s.tenantId, r.messageRowId);
      else await processMessage(s.deps, s.tenantId, r.messageRowId);
      queued++;
    }
    refresh();
    const parts = [queued ? `${queued} file${queued === 1 ? "" : "s"} received` : null, duplicates ? `${duplicates} already seen before (skipped)` : null].filter(Boolean);
    return { ok: queued > 0, message: parts.join("; ") || "Nothing to process." } as ActionResult;
  } catch (err) {
    return failure(err);
  }
}

export async function retryMessageAction(messageRowId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    await resetMessage(s.deps, s.tenantId, messageRowId, s.actor);
    await dispatchProcess(s.tenantId, messageRowId);
    refresh();
    return { ok: true, message: "Queued for another try." };
  } catch (err) {
    return failure(err);
  }
}

// ---- Review ---------------------------------------------------------------------------

const Id = z.uuid();
const LineNo = z.number().int().min(1).max(100_000);
const Qty = z.number().positive().max(1e9);
/** Server actions are public endpoints: the edit arrives as untrusted JSON. */
const EditSchema: z.ZodType<OrderEdit> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_customer"), customerId: Id }),
  z.object({ type: z.literal("set_line_item"), lineNo: LineNo, itemId: Id }),
  z.object({ type: z.literal("set_line"), lineNo: LineNo, quantity: Qty.optional(), unitPrice: z.number().min(0).max(1e9).nullable().optional(), uom: z.string().max(16).nullable().optional() }),
  z.object({ type: z.literal("use_list_price"), lineNo: LineNo }),
  z.object({ type: z.literal("remove_line"), lineNo: LineNo }),
  z.object({ type: z.literal("add_line"), itemId: Id, quantity: Qty }),
  z.object({ type: z.literal("set_header"), poNumber: z.string().max(80).nullable().optional(), requestedShipDate: z.string().max(10).nullable().optional(), specialInstructions: z.string().max(2000).nullable().optional() }),
]);

export async function editOrderAction(orderId: string, input: OrderEdit): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const parsed = EditSchema.safeParse(input);
    if (!parsed.success || !Id.safeParse(orderId).success) return { ok: false, message: "That change is not valid." };
    const edit = parsed.data;
    await applyEdit(s.deps, s.tenantId, orderId, edit, s.actor);
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function confirmOrderAction(orderId: string): Promise<ActionResult & { status?: string }> {
  try {
    const s = await requireSession();
    const r = await confirmOrder(s.deps, s.tenantId, orderId, s.actor);
    refresh();
    if (r.status === "posted") return { ok: true, status: r.status, message: `Posted to the ERP as ${r.erpOrderNumber ?? r.erpOrderId}.` };
    if (r.shadow) return { ok: true, status: r.status, message: "Confirmed. Shadow mode is on, so nothing was posted to the ERP." };
    return { ok: false, status: r.status, message: r.error ?? "The order was confirmed but could not be posted yet." };
  } catch (err) {
    return failure(err);
  }
}

export async function rejectOrderAction(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    await rejectOrder(s.deps, s.tenantId, orderId, reason, s.actor);
    refresh();
    return { ok: true, message: "Rejected." };
  } catch (err) {
    return failure(err);
  }
}

export async function reopenOrderAction(orderId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    await reopenOrder(s.deps, s.tenantId, orderId, s.actor);
    refresh();
    return { ok: true, message: "Back in the review queue." };
  } catch (err) {
    return failure(err);
  }
}

export async function sendAckAction(orderId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const r = await sendAcknowledgment(s.deps, s.tenantId, orderId, s.actor);
    refresh();
    return r.ok ? { ok: true, message: s.demo ? "Acknowledgment recorded (demo mode sends no real email)." : "Acknowledgment sent." } : { ok: false, message: r.reason ?? "Could not send." };
  } catch (err) {
    return failure(err);
  }
}

export async function searchItemsAction(query: string) {
  const s = await requireSession();
  return searchItems(s.deps, s.tenantId, query);
}

export async function searchCustomersAction(query: string) {
  const s = await requireSession();
  return searchCustomers(s.deps, s.tenantId, query);
}

// ---- Customers --------------------------------------------------------------------------

export async function saveCustomerAction(customerId: string, _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    const list = (name: string) => String(form.get(name) ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    await updateCustomer(s.deps, s.tenantId, customerId, { domains: list("domains"), aka: list("aka"), accountNumber: String(form.get("accountNumber") ?? "") }, s.actor);
    const mode = String(form.get("autoPost") ?? "default");
    if (mode === "default") await setCustomerAutoPost(s.deps, s.tenantId, customerId, null, s.actor);
    else {
      requireAdmin(s);
      const score = Number(form.get("minLineMatchScore"));
      const delta = Number(form.get("maxPriceDeltaPct"));
      await setCustomerAutoPost(s.deps, s.tenantId, customerId, { enabled: mode === "on", ...(score > 0 && score <= 1 ? { minLineMatchScore: score } : {}), ...(delta >= 0 && form.get("maxPriceDeltaPct") !== "" ? { maxPriceDeltaPct: delta } : {}) }, s.actor);
    }
    refresh();
    return { ok: true, message: "Saved." };
  } catch (err) {
    return failure(err);
  }
}

export async function deleteAliasAction(aliasId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    await deleteAlias(s.deps, s.tenantId, aliasId, s.actor);
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

// ---- Catalog imports ------------------------------------------------------------------

export async function importCsvAction(kind: "items" | "customers", _prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a CSV file." };
    if (file.size > 20 * 1024 * 1024) return { ok: false, message: "The file is larger than 20 MB." };
    const text = await file.text();
    const n = kind === "items" ? await importItemsCsv(s.deps, s.tenantId, text, s.actor) : await importCustomersCsv(s.deps, s.tenantId, text, s.actor);
    refresh();
    return { ok: true, message: `Imported ${n} ${kind}.` };
  } catch (err) {
    return failure(err);
  }
}

// ---- Settings -------------------------------------------------------------------------

export async function saveRulesAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    const threshold = Number(form.get("autoPostThreshold"));
    const tolerance = Number(form.get("priceTolerancePct"));
    const minutes = Number(form.get("minutesPerOrder"));
    if (!(threshold >= 0.5 && threshold <= 1)) return { ok: false, message: "Match score must be between 0.5 and 1." };
    if (!(tolerance >= 0 && tolerance <= 100)) return { ok: false, message: "Price tolerance must be between 0 and 100%." };
    const patch: Partial<TenantSettings> = {
      shadowMode: form.get("shadowMode") === "on",
      autoPost: form.get("autoPost") === "on",
      autoPostThreshold: threshold,
      priceTolerancePct: tolerance,
      holdOnStockShort: form.get("holdOnStockShort") === "on",
      minutesPerOrder: minutes > 0 && minutes <= 120 ? minutes : 8,
    };
    await updateSettings(s.deps, s.tenantId, patch, s.actor);
    refresh();
    return { ok: true, message: "Rules saved. They apply to orders that arrive from now on and to any order you edit." };
  } catch (err) {
    return failure(err);
  }
}

export async function saveAckAction(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    const subject = String(form.get("ackSubject") ?? "").trim();
    const body = String(form.get("ackBody") ?? "").trim();
    if (!subject || !body) return { ok: false, message: "Subject and body are required." };
    const emails = String(form.get("digestRecipients") ?? "").split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
    const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad) return { ok: false, message: `"${bad}" is not an email address.` };
    await updateSettings(s.deps, s.tenantId, { ackEnabled: form.get("ackEnabled") === "on", ackAutoSend: form.get("ackAutoSend") === "on", ackSubject: subject.slice(0, 200), ackBody: body.slice(0, 5000), ackReplyTo: String(form.get("ackReplyTo") ?? "").trim() || undefined, digestRecipients: emails }, s.actor);
    refresh();
    return { ok: true, message: "Email settings saved." };
  } catch (err) {
    return failure(err);
  }
}

export async function sendDigestNowAction(): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    const n = await sendWeeklyDigest(s.deps, s.tenantId);
    return n > 0 ? { ok: true, message: `Digest sent to ${n} recipient${n === 1 ? "" : "s"}.` } : { ok: false, message: "Nothing sent: add a recipient, and the digest needs at least one order in the last 7 days." };
  } catch (err) {
    return failure(err);
  }
}

export async function connectSimpleAction(kind: "demo" | "csv"): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    if (kind === "demo" && !s.demo) return { ok: false, message: "The demo ERP is only available in demo mode." };
    const integration = await connectSimple(s.deps, s.tenantId, kind, s.actor);
    if (kind === "demo") await runSync(s.deps, s.tenantId, integration.id, s.actor);
    refresh();
    return { ok: true, message: kind === "csv" ? "CSV export connected. Import your item and customer lists next." : "Demo ERP connected and synced." };
  } catch (err) {
    return failure(err);
  }
}

export async function syncNowAction(integrationId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    const r = await runSync(s.deps, s.tenantId, integrationId, s.actor);
    refresh();
    return { ok: true, message: `Synced ${r.items} items, ${r.customers} customers, ${r.stock} stock levels.` };
  } catch (err) {
    return failure(err);
  }
}

export async function setOrderEntityAction(integrationId: string, entity: "estimate" | "sales_order"): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    await updateIntegrationConfig(s.deps, s.tenantId, integrationId, { orderEntity: entity }, s.actor);
    refresh();
    return { ok: true, message: entity === "sales_order" ? "Orders will post as Sales Orders. Reconnect QuickBooks so the app is granted the sales-order permission." : "Orders will post as Estimates." };
  } catch (err) {
    return failure(err);
  }
}

export async function disconnectAction(integrationId: string): Promise<ActionResult> {
  try {
    const s = await requireSession();
    requireAdmin(s);
    await disconnectIntegration(s.deps, s.tenantId, integrationId, s.actor);
    refresh();
    return { ok: true, message: "Disconnected." };
  } catch (err) {
    return failure(err);
  }
}

// ---- Billing --------------------------------------------------------------------------

export async function startCheckoutAction(plan: PlanKey): Promise<ActionResult> {
  let url: string;
  try {
    const s = await requireSession();
    requireAdmin(s);
    if (!isStripeConfigured()) return { ok: false, message: "Billing is not configured on this deployment (STRIPE_SECRET_KEY)." };
    const tenant = await getTenant(s.deps, s.tenantId);
    url = await createCheckoutUrl(s.deps, s.tenantId, plan, { name: tenant.name });
  } catch (err) {
    return failure(err);
  }
  redirect(url);
}

export async function openBillingPortalAction(): Promise<ActionResult> {
  let url: string;
  try {
    const s = await requireSession();
    requireAdmin(s);
    if (!isStripeConfigured()) return { ok: false, message: "Billing is not configured on this deployment (STRIPE_SECRET_KEY)." };
    url = await createPortalUrl(s.deps, s.tenantId);
  } catch (err) {
    return failure(err);
  }
  redirect(url);
}
