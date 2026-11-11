import { timingSafeEqual } from "node:crypto";
import { htmlToText } from "@desk/extract";
import { receiveMessage, resolveRoute, ServiceError, slugFromRecipient } from "@desk/service";
import { inboundDomain } from "@/lib/env";
import { getDeps } from "@/lib/server/deps";
import { dispatchProcess } from "@/lib/server/dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;

type Addr = { Email?: string };
type PostmarkInbound = {
  From?: string;
  FromFull?: Addr & { Name?: string };
  To?: string;
  ToFull?: Addr[];
  CcFull?: Addr[];
  BccFull?: Addr[];
  OriginalRecipient?: string;
  Subject?: string;
  MessageID?: string;
  Date?: string;
  TextBody?: string;
  HtmlBody?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  Attachments?: Array<{ Name: string; Content: string; ContentType?: string; ContentLength?: number; ContentID?: string }>;
};

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Postmark signs nothing; the webhook URL carries HTTP Basic credentials or a `?token=`. */
function authorized(req: Request, secret: string): boolean {
  const token = new URL(req.url).searchParams.get("token");
  if (token && same(token, secret)) return true;
  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [, pass = ""] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
    return same(pass, secret);
  }
  return false;
}

/**
 * Postmark inbound webhook (plan §6.2 intake). Stores the message durably, then hands it
 * to the pipeline. Always answers 200 once the message is stored or deliberately dropped,
 * so Postmark does not redeliver; a redelivery is harmless anyway (idempotent on Message-ID).
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.POSTMARK_INBOUND_SECRET;
  if (!secret) return Response.json({ error: "Inbound email is not configured" }, { status: 503 });
  if (!authorized(req, secret)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let mail: PostmarkInbound;
  try {
    mail = (await req.json()) as PostmarkInbound;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const deps = await getDeps();
  const domain = inboundDomain();
  const recipients = [mail.OriginalRecipient, ...(mail.ToFull ?? []).map((a) => a.Email), ...(mail.CcFull ?? []).map((a) => a.Email), ...(mail.BccFull ?? []).map((a) => a.Email)].filter((x): x is string => !!x);
  let tenantId: string | null = null;
  let to: string | null = null;
  for (const r of recipients) {
    const slug = slugFromRecipient(r, domain);
    if (!slug) continue;
    tenantId = await resolveRoute(deps.db, "inbound_slug", slug);
    if (tenantId) {
      to = r;
      break;
    }
  }
  if (!tenantId) {
    console.warn(`[postmark] no tenant for recipients ${recipients.join(", ")}`);
    return Response.json({ received: true, routed: false });
  }

  const rfcId = mail.Headers?.find((h) => h.Name.toLowerCase() === "message-id")?.Value;
  const messageId = rfcId || mail.MessageID;
  if (!messageId) return Response.json({ error: "Missing message id" }, { status: 400 });

  const attachments = (mail.Attachments ?? [])
    // Signature logos and tracking pixels are inline images; a photographed PO is not small.
    .filter((a) => !(a.ContentID && a.ContentType?.startsWith("image/") && (a.ContentLength ?? 0) < 30_000))
    .map((a) => ({ filename: a.Name || "attachment", bytes: new Uint8Array(Buffer.from(a.Content ?? "", "base64")), mimeType: a.ContentType ?? null }));

  try {
    const received = await receiveMessage(deps, tenantId, {
      source: "email",
      messageId,
      from: mail.FromFull?.Email ?? mail.From ?? null,
      to,
      subject: mail.Subject ?? null,
      bodyText: mail.TextBody?.trim() ? mail.TextBody : mail.HtmlBody ? htmlToText(mail.HtmlBody) : null,
      attachments,
      receivedAt: mail.Date && !Number.isNaN(Date.parse(mail.Date)) ? new Date(mail.Date) : undefined,
    });
    if (!received.duplicate && !received.ignored) await dispatchProcess(tenantId, received.messageRowId);
    return Response.json({ received: true, routed: true, duplicate: received.duplicate, ignored: received.ignored });
  } catch (err) {
    if (err instanceof ServiceError && err.code === "invalid") return Response.json({ received: true, routed: true, dropped: err.message });
    console.error("[postmark] failed to store inbound message", err);
    // 5xx makes Postmark retry: the message is not stored yet.
    return Response.json({ error: "Temporary failure" }, { status: 500 });
  }
}
