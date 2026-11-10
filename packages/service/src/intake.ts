/**
 * Intake (plan §6.2, §6.6): receive a message durably, then turn it into drafts.
 *
 *   receiveMessage  — persist the raw email/upload and its files. Idempotent on
 *                     (tenant, message id) and (tenant, file hash): at-least-once delivery is safe.
 *   processMessage  — normalize → classify → extract → identify → match → validate → rules → draft,
 *                     persist the drafts, then auto-post the eligible ones. Safe to retry.
 */
import { createHash } from "node:crypto";
import { documents, inboundMessages, orders, rules, tenantSettings, withTenant } from "@desk/db";
import { normalizeInput, processDocument, type RawAttachment } from "@desk/extract";
import { and, desc, eq, inArray } from "drizzle-orm";
import { logEvent, SYSTEM, type Actor } from "./audit";
import { joinKey, safeFilename } from "./blobs";
import { errorText, nowOf, ServiceError, type ServiceDeps } from "./context";
import { confirmOrder, insertDraft, markShadowEligible } from "./orders";
import { ScopedCatalog, scopeOf } from "./scope";
import { effectiveSettings } from "./tenants";
import { autoPostPolicyFor, loadCustomerRecords, PgValidationContext, validationPolicyFrom } from "./validation";

export type InboundInput = {
  source: "email" | "upload";
  /** RFC 5322 Message-ID, provider message id, or a generated id for uploads. */
  messageId: string;
  from: string | null;
  to: string | null;
  subject: string | null;
  bodyText: string | null;
  attachments: RawAttachment[];
  receivedAt?: Date;
};

export const BODY_FILENAME = "email-body.txt";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const sha256 = (...parts: Array<string | Uint8Array>) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};

export type ReceiveResult = { messageRowId: string; duplicate: boolean; ignored: boolean };

export async function receiveMessage(deps: Pick<ServiceDeps, "db" | "blobs" | "now">, tenantId: string, input: InboundInput): Promise<ReceiveResult> {
  const at = input.receivedAt ?? nowOf(deps);
  const body = input.bodyText?.trim() ? input.bodyText : null;
  const files = input.attachments.filter((a) => a.bytes.byteLength > 0 && a.bytes.byteLength <= MAX_ATTACHMENT_BYTES);
  if (!body && files.length === 0) throw new ServiceError("invalid", "The message has no readable body and no attachments");

  // Blobs first: keys are content-addressed, so a retry overwrites identical bytes.
  const staged = [] as Array<{ filename: string; mimeType: string | null; hash: string; key: string }>;
  for (const f of files) {
    const hash = sha256(f.bytes);
    const key = joinKey("t", tenantId, "d", hash, safeFilename(f.filename));
    await deps.blobs.put(key, f.bytes, f.mimeType ?? null);
    staged.push({ filename: f.filename, mimeType: f.mimeType ?? null, hash, key });
  }
  let bodyDoc: { hash: string; key: string } | null = null;
  if (body) {
    const hash = sha256("body:", input.messageId, "\n", body);
    const key = joinKey("t", tenantId, "d", hash, BODY_FILENAME);
    await deps.blobs.put(key, new TextEncoder().encode(body), "text/plain; charset=utf-8");
    bodyDoc = { hash, key };
  }

  return withTenant(deps.db, tenantId, async (tx) => {
    const inserted = await tx
      .insert(inboundMessages)
      .values({ tenantId, messageId: input.messageId, fromAddress: input.from, toAddress: input.to, subject: input.subject, receivedAt: at, source: input.source, status: "received" })
      .onConflictDoNothing({ target: [inboundMessages.tenantId, inboundMessages.messageId] })
      .returning({ id: inboundMessages.id });
    if (inserted.length === 0) {
      const [existing] = await tx.select({ id: inboundMessages.id, status: inboundMessages.status }).from(inboundMessages).where(and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.messageId, input.messageId)));
      return { messageRowId: existing!.id, duplicate: true, ignored: existing!.status === "ignored" };
    }
    const messageRowId = inserted[0]!.id;

    let fresh = 0;
    for (const s of staged) {
      const rows = await tx
        .insert(documents)
        .values({ tenantId, messageId: messageRowId, filename: s.filename, mimeType: s.mimeType, hash: s.hash, storageRef: s.key })
        .onConflictDoNothing({ target: [documents.tenantId, documents.hash] })
        .returning({ id: documents.id });
      fresh += rows.length;
    }
    if (bodyDoc) {
      await tx
        .insert(documents)
        .values({ tenantId, messageId: messageRowId, filename: BODY_FILENAME, mimeType: "text/plain", hash: bodyDoc.hash, storageRef: bodyDoc.key })
        .onConflictDoNothing({ target: [documents.tenantId, documents.hash] });
    }

    // The same PO file sent again (a customer "just checking") must not become a second order.
    if (staged.length > 0 && fresh === 0) {
      await tx.update(inboundMessages).set({ status: "ignored", classification: "duplicate", error: "Every attachment was already received in an earlier message" }).where(eq(inboundMessages.id, messageRowId));
      await logEvent(tx, { tenantId, actor: SYSTEM, action: "ignored_duplicate", entity: "message", entityId: messageRowId, after: { from: input.from, subject: input.subject } });
      return { messageRowId, duplicate: false, ignored: true };
    }
    await logEvent(tx, { tenantId, actor: SYSTEM, action: "received", entity: "message", entityId: messageRowId, after: { source: input.source, from: input.from, subject: input.subject, attachments: staged.map((s) => s.filename) } });
    return { messageRowId, duplicate: false, ignored: false };
  });
}

export type ProcessResult = { status: "processed" | "ignored" | "failed" | "skipped"; orderIds: string[]; autoPosted: number; error: string | null };

export async function processMessage(deps: ServiceDeps, tenantId: string, messageRowId: string): Promise<ProcessResult> {
  const run = scopeOf(deps.db, tenantId);
  const loaded = await run(async (tx) => {
    const [msg] = await tx.select().from(inboundMessages).where(and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.id, messageRowId)));
    if (!msg) return null;
    const docs = await tx.select().from(documents).where(and(eq(documents.tenantId, tenantId), eq(documents.messageId, messageRowId))).orderBy(documents.createdAt);
    const existing = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.messageId, messageRowId)));
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const ruleRows = await tx.select().from(rules).where(eq(rules.tenantId, tenantId));
    return { msg, docs, existing, settings: s?.settings ?? {}, ruleRows };
  });
  if (!loaded) throw new ServiceError("not_found", "Message not found");
  const { msg, docs, existing, settings, ruleRows } = loaded;

  // Retry after a crash between "drafts saved" and "message marked processed".
  if (existing.length > 0) {
    if (msg.status !== "processed") await run((tx) => tx.update(inboundMessages).set({ status: "processed" }).where(eq(inboundMessages.id, messageRowId)));
    return { status: "skipped", orderIds: existing.map((e) => e.id), autoPosted: 0, error: null };
  }
  if (msg.status === "ignored" || msg.status === "processed") return { status: "skipped", orderIds: [], autoPosted: 0, error: null };

  const fail = async (error: string): Promise<ProcessResult> => {
    await run(async (tx) => {
      await tx.update(inboundMessages).set({ status: "failed", error }).where(eq(inboundMessages.id, messageRowId));
      await logEvent(tx, { tenantId, actor: SYSTEM, action: "failed", entity: "message", entityId: messageRowId, after: { error } });
    });
    return { status: "failed", orderIds: [], autoPosted: 0, error };
  };
  if (!deps.llm) return fail("No extraction model is configured (set ANTHROPIC_API_KEY). The message is stored and can be reprocessed.");

  await run((tx) => tx.update(inboundMessages).set({ status: "processing", error: null }).where(eq(inboundMessages.id, messageRowId)));

  try {
    let bodyText: string | null = null;
    const attachments: RawAttachment[] = [];
    for (const d of docs) {
      const blob = d.storageRef ? await deps.blobs.get(d.storageRef) : null;
      if (!blob) continue;
      if (d.filename === BODY_FILENAME) bodyText = new TextDecoder().decode(blob.bytes);
      else attachments.push({ filename: d.filename, bytes: blob.bytes, mimeType: d.mimeType });
    }
    const doc = await normalizeInput({ source: msg.source === "upload" ? "upload" : "email", sender: msg.fromAddress, subject: msg.subject, receivedAt: msg.receivedAt.toISOString(), bodyText, attachments });
    if (doc.parts.length === 0) {
      const why = doc.rejected.map((r) => `${r.filename}: ${r.reason}`).join("; ") || "nothing readable in the message";
      return fail(`Could not read this message (${why})`);
    }

    const result = await processDocument(doc, {
      tenantId,
      llm: deps.llm,
      catalog: new ScopedCatalog(run, tenantId),
      customers: await loadCustomerRecords(run, tenantId),
      validation: new PgValidationContext(run, tenantId, null),
      skipClassify: msg.source === "upload",
      validationPolicy: validationPolicyFrom(settings),
      autoPostPolicy: (customerId) => autoPostPolicyFor(settings, ruleRows, customerId),
      now: deps.now,
    });

    const primaryDoc = docs.find((d) => d.filename !== BODY_FILENAME) ?? docs[0] ?? null;
    const classification = result.extraction?.documentType ?? result.classification?.documentType ?? "unknown";
    const at = nowOf(deps);
    const orderIds = await run(async (tx) => {
      const ids: string[] = [];
      for (const draft of result.drafts) {
        const row = await insertDraft(tx, tenantId, { ...draft, tenantId, documentId: primaryDoc?.id ?? draft.documentId }, { documentId: primaryDoc?.id ?? null, messageId: messageRowId }, at);
        ids.push(row.id);
      }
      const ignored = result.drafts.length === 0;
      await tx
        .update(inboundMessages)
        .set({
          status: ignored ? "ignored" : "processed",
          classification,
          costUsd: result.cost.usd.toFixed(5),
          error: ignored ? `No order found (${classification.replace(/_/g, " ")})${doc.rejected.length ? `; unreadable: ${doc.rejected.map((r) => r.filename).join(", ")}` : ""}` : null,
        })
        .where(eq(inboundMessages.id, messageRowId));
      await logEvent(tx, { tenantId, actor: SYSTEM, action: ignored ? "ignored" : "processed", entity: "message", entityId: messageRowId, after: { classification, orders: ids.length, costUsd: Number(result.cost.usd.toFixed(5)), timingsMs: result.timingsMs }, at });
      return ids;
    });

    // Rules engine: post what is eligible, or record that it would have posted (shadow mode).
    let autoPosted = 0;
    const shadow = effectiveSettings(settings).shadowMode;
    for (const draft of result.drafts) {
      if (!draft.autoPost.eligible) continue;
      if (shadow) {
        await run((tx) => markShadowEligible(tx, draft.id));
        continue;
      }
      try {
        const r = await confirmOrder(deps, tenantId, draft.id, SYSTEM, { auto: true });
        if (r.status === "posted") autoPosted++;
      } catch (err) {
        console.warn(`[desk] auto-post of ${draft.id} did not complete: ${errorText(err)}`);
      }
    }
    return { status: result.drafts.length ? "processed" : "ignored", orderIds, autoPosted, error: null };
  } catch (err) {
    return fail(errorText(err));
  }
}

/** Receive and process in one call (uploads, tests, and the inline fallback when no job runner is configured). */
export async function ingest(deps: ServiceDeps, tenantId: string, input: InboundInput): Promise<ReceiveResult & { result: ProcessResult | null }> {
  const received = await receiveMessage(deps, tenantId, input);
  if (received.duplicate || received.ignored) return { ...received, result: null };
  return { ...received, result: await processMessage(deps, tenantId, received.messageRowId) };
}

/** Requeue a failed or ignored message (after fixing the cause, e.g. adding the API key or the customer). */
export async function resetMessage(deps: Pick<ServiceDeps, "db">, tenantId: string, messageRowId: string, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [msg] = await tx.select().from(inboundMessages).where(and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.id, messageRowId)));
    if (!msg) throw new ServiceError("not_found", "Message not found");
    if (msg.classification === "duplicate") throw new ServiceError("conflict", "This message only repeats files that were already received");
    await tx.update(inboundMessages).set({ status: "received", error: null }).where(eq(inboundMessages.id, messageRowId));
    await logEvent(tx, { tenantId, actor, action: "requeued", entity: "message", entityId: messageRowId });
  });
}

export async function listMessages(deps: Pick<ServiceDeps, "db">, tenantId: string, opts: { statuses?: string[]; limit?: number } = {}) {
  return withTenant(deps.db, tenantId, (tx) =>
    tx
      .select()
      .from(inboundMessages)
      .where(and(eq(inboundMessages.tenantId, tenantId), opts.statuses?.length ? inArray(inboundMessages.status, opts.statuses) : undefined))
      .orderBy(desc(inboundMessages.receivedAt))
      .limit(opts.limit ?? 50),
  );
}
