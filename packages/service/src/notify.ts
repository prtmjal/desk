/** Customer acknowledgment emails (plan §6.2) and the weekly tenant digest (plan §9.5). */
import type { OrderDraft } from "@desk/core";
import { inboundMessages, orders, tenantSettings, tenants, withTenant } from "@desk/db";
import { and, eq } from "drizzle-orm";
import { logEvent, type Actor } from "./audit";
import { nowOf, ServiceError, type ServiceDeps } from "./context";
import { dashboardMetrics } from "./metrics";
import { effectiveSettings } from "./tenants";

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

export function acknowledgmentLines(draft: OrderDraft): string {
  return draft.lines
    .map((l) => {
      const qty = l.quantity.value ?? "?";
      const uom = l.rawUom.value ?? l.match.erpUom ?? "";
      const what = l.match.best ? `${l.match.best.sku}  ${l.match.best.description}` : (l.rawDescription.value ?? l.rawPartNumber.value ?? "item");
      const yours = l.rawPartNumber.value && l.rawPartNumber.value !== l.match.best?.sku ? ` (your part ${l.rawPartNumber.value})` : "";
      return `  ${qty} ${uom}  ${what}${yours}`.replace(/\s+$/, "");
    })
    .join("\n");
}

export function renderAcknowledgment(input: { subject: string; body: string; draft: OrderDraft; orderNumber: string | null; companyName: string }): { subject: string; text: string } {
  const h = input.draft.header;
  const vars = {
    poNumber: h.poNumber.value ?? "(no PO number)",
    orderNumber: input.orderNumber ?? "(pending)",
    contactName: h.customer.contactName.value ?? "there",
    customerName: input.draft.customer.name ?? h.customer.name.value ?? "",
    requestedShipDate: h.requestedShipDate.value ?? "as soon as available",
    lines: acknowledgmentLines(input.draft),
    companyName: input.companyName,
  };
  return { subject: renderTemplate(input.subject, vars), text: renderTemplate(input.body, vars) };
}

export async function previewAcknowledgment(deps: Pick<ServiceDeps, "db">, tenantId: string, orderId: string): Promise<{ to: string | null; subject: string; text: string }> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, orderId)));
    if (!o?.draft) throw new ServiceError("not_found", "Order not found");
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const msg = o.messageId ? (await tx.select().from(inboundMessages).where(eq(inboundMessages.id, o.messageId)))[0] : undefined;
    const settings = effectiveSettings(s?.settings);
    const to = o.draft.header.customer.email.value ?? extractAddress(msg?.fromAddress) ?? null;
    return { to, ...renderAcknowledgment({ subject: settings.ackSubject, body: settings.ackBody, draft: o.draft, orderNumber: o.erpOrderNumber ?? o.erpOrderId, companyName: t?.name ?? "" }) };
  });
}

export function extractAddress(from: string | null | undefined): string | null {
  const m = from?.match(/[^\s<>"]+@[^\s<>"]+/);
  return m ? m[0].toLowerCase() : null;
}

export async function sendAcknowledgment(deps: Pick<ServiceDeps, "db" | "mailer" | "now">, tenantId: string, orderId: string, actor: Actor): Promise<{ ok: boolean; reason?: string }> {
  const preview = await previewAcknowledgment(deps, tenantId, orderId);
  if (!preview.to) return { ok: false, reason: "No customer email address on this order" };
  const settings = await withTenant(deps.db, tenantId, async (tx) => effectiveSettings((await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)))[0]?.settings));
  const res = await deps.mailer.send({ to: preview.to, subject: preview.subject, text: preview.text, replyTo: settings.ackReplyTo ?? null, tag: "acknowledgment" });
  await withTenant(deps.db, tenantId, async (tx) => {
    if (res.ok) await tx.update(orders).set({ acknowledgedAt: nowOf(deps) }).where(eq(orders.id, orderId));
    await logEvent(tx, { tenantId, actor, action: res.ok ? "acknowledged" : "acknowledgment_skipped", entity: "order", entityId: orderId, after: { to: preview.to, subject: preview.subject, providerId: res.id, reason: res.skipped ?? null } });
  });
  return res.ok ? { ok: true } : { ok: false, reason: res.skipped ?? "The email provider did not accept the message" };
}

export function renderDigest(input: { companyName: string; appUrl: string; m: Awaited<ReturnType<typeof dashboardMetrics>> }): { subject: string; text: string } {
  const { m } = input;
  const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
  const hours = (m.minutesSaved / 60).toFixed(1);
  const top = m.exceptionsByType.slice(0, 5).map((e) => `  ${e.count}  ${e.label}`).join("\n") || "  none";
  return {
    subject: `${input.companyName}: ${m.ordersPosted} orders posted, ${hours} hours saved this week`,
    text: [
      `Your order desk, last ${m.days} days`,
      "",
      `Orders received:   ${m.ordersReceived}`,
      `Orders posted:     ${m.ordersPosted}`,
      `Touchless:         ${pct(m.touchlessRate)}`,
      `Line accuracy:     ${pct(m.lineAccuracy)}`,
      `Time saved:        ${hours} hours`,
      `Waiting on review: ${m.waiting}`,
      "",
      "Most common exceptions:",
      top,
      "",
      `Open the review queue: ${input.appUrl}/app/review`,
    ].join("\n"),
  };
}

/** Send the weekly digest to the tenant's digest recipients. Returns how many were sent. */
export async function sendWeeklyDigest(deps: Pick<ServiceDeps, "db" | "mailer" | "now" | "appUrl">, tenantId: string): Promise<number> {
  const { name, recipients } = await withTenant(deps.db, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return { name: t?.name ?? "", recipients: effectiveSettings(s?.settings).digestRecipients ?? [] };
  });
  if (recipients.length === 0) return 0;
  const m = await dashboardMetrics(deps, tenantId, 7);
  if (m.ordersReceived === 0) return 0;
  const mail = renderDigest({ companyName: name, appUrl: deps.appUrl, m });
  let sent = 0;
  for (const to of recipients) {
    const r = await deps.mailer.send({ to, subject: mail.subject, text: mail.text, tag: "digest" });
    if (r.ok) sent++;
  }
  return sent;
}
