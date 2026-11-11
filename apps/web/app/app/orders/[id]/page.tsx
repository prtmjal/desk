import type { Metadata } from "next";
import { extractAddress, getOrder, getTenant } from "@desk/service";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/app/document-viewer";
import { ReviewPane } from "@/components/app/review-pane";
import { pct, STATUS_LABEL, statusBadge, when } from "@/lib/format";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Review order" };

const ACTION_LABEL: Record<string, string> = {
  created: "Draft created",
  confirmed: "Confirmed",
  auto_confirmed: "Confirmed by rules",
  posted: "Posted to ERP",
  post_failed: "Posting failed",
  post_skipped: "Not posted",
  shadow_hold: "Held (shadow mode)",
  rejected: "Rejected",
  reopened: "Reopened",
  acknowledged: "Acknowledgment sent",
  acknowledgment_skipped: "Acknowledgment not sent",
};

function describe(action: string): string {
  if (action.startsWith("edited:")) return `Edited: ${action.slice(7).replace(/_/g, " ")}`;
  return ACTION_LABEL[action] ?? action.replace(/_/g, " ");
}

function who(actor: string, me: string): string {
  if (actor === "system") return "DESK";
  if (actor.startsWith("integration:")) return "ERP connector";
  return actor === `user:${me}` ? "You" : "A teammate";
}

/** Split screen (plan §6.2): source document on the left, draft order on the right. */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const [detail, tenant] = await Promise.all([getOrder(s.deps, s.tenantId, id), getTenant(s.deps, s.tenantId)]);
  if (!detail) notFound();
  const { order, message, documents, history } = detail;
  const draft = order.draft;
  const ackTo = draft.header.customer.email.value ?? extractAddress(message?.fromAddress);

  return (
    <div className="px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/app/review" className="text-sm text-muted underline-offset-2 hover:underline">
            ← Queue
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{draft.customer.name ?? "Unidentified customer"}{order.poNumber ? ` · PO ${order.poNumber}` : ""}</h1>
          <span className={statusBadge(order.status)}>{STATUS_LABEL[order.status] ?? order.status}</span>
          {order.shadowEligible ? <span className="badge badge-accent">Would auto-post</span> : null}
        </div>
        <p className="text-xs text-muted">
          Received {when(order.createdAt)} · confidence {pct(order.confidence)}
        </p>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] 2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-auto">
          <DocumentViewer deps={s.deps} docs={documents} sender={message?.fromAddress ?? null} subject={message?.subject ?? null} />
        </div>
        <div className="min-w-0">
          <ReviewPane
            orderId={order.id}
            status={order.status}
            draft={draft}
            nextId={detail.nextId}
            prevId={detail.prevId}
            postError={order.postError}
            erp={order.erpOrderId ? { number: order.erpOrderNumber ?? order.erpOrderId, url: order.erpUrl } : null}
            acknowledgedAt={order.acknowledgedAt ? order.acknowledgedAt.toISOString() : null}
            ack={{ enabled: tenant.settings.ackEnabled, to: ackTo }}
            shadowMode={tenant.settings.shadowMode}
          />

          <section aria-labelledby="history-heading" className="mt-6">
            <h2 id="history-heading" className="text-sm font-semibold">
              History
            </h2>
            <ol className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
              {history.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <span>
                    <span className="font-medium">{describe(e.action)}</span> <span className="text-muted">by {who(e.actor, s.actor.kind === "user" ? s.actor.id : "")}</span>
                    {e.action.startsWith("edited:") && e.after ? <span className="block font-mono text-xs break-all text-muted">{JSON.stringify(e.before)} → {JSON.stringify(e.after)}</span> : null}
                  </span>
                  <time dateTime={e.at.toISOString()} className="shrink-0 text-xs text-muted">
                    {when(e.at)}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
