import { dashboardMetrics, getTenant, listMessages, listOrders, onboardingStatus, postingAllowance, requeueStuckMessages } from "@desk/service";
import Link from "next/link";
import { retryMessageAction } from "./actions";
import { OrderTable } from "@/components/app/order-table";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton, AutoRefresh, CopyButton } from "@/components/app/ui";
import { UploadForm } from "@/components/app/upload-form";
import { ago, hours, pct } from "@/lib/format";
import { isInngestConfigured } from "@/lib/env";
import { dispatchProcess } from "@/lib/server/dispatch";
import { requireSession } from "@/lib/server/session";

export default async function InboxPage() {
  const s = await requireSession();
  // Without a job runner nothing else notices interrupted work, so the inbox does.
  if (!isInngestConfigured()) for (const id of await requeueStuckMessages(s.deps, s.tenantId)) await dispatchProcess(s.tenantId, id);
  const [tenant, m, status, recent, messages, allowance] = await Promise.all([
    getTenant(s.deps, s.tenantId),
    dashboardMetrics(s.deps, s.tenantId, 30),
    onboardingStatus(s.deps, s.tenantId),
    listOrders(s.deps, s.tenantId, { limit: 12 }),
    listMessages(s.deps, s.tenantId, { statuses: ["received", "processing", "failed", "ignored"], limit: 8 }),
    postingAllowance(s.deps, s.tenantId),
  ]);
  const working = messages.some((x) => x.status === "received" || x.status === "processing");
  const shadow = tenant.settings.shadowMode;

  const steps = [
    { done: status.erpConnected, title: "Connect your ERP", body: status.erpConnected ? `Connected: ${status.erpType?.replace(/_/g, " ")}.` : "QuickBooks Online, or CSV export if your ERP is not supported yet.", href: "/app/settings#erp", cta: "Connect" },
    { done: status.itemCount > 0 && status.customerCount > 0, title: "Load items and customers", body: `${status.itemCount} items and ${status.customerCount} customers loaded. They sync from the ERP, or import a CSV.`, href: "/app/items", cta: "Review items" },
    { done: status.messageCount > 0, title: "Send in your first orders", body: "Forward your orders inbox to the address below, or upload 20 recent POs.", href: "#intake", cta: "Upload POs" },
    { done: status.reviewedCount > 0, title: "Confirm a draft", body: "Fix what the desk flagged; every correction is remembered for that customer.", href: "/app/review", cta: "Open review" },
    { done: !shadow && tenant.settings.autoPost, title: "Turn on auto-post", body: shadow ? "Shadow mode is on: nothing posts to your ERP yet. Switch it off when the numbers earn it." : "Set thresholds, then let clean orders post on their own.", href: "/app/settings#rules", cta: "Review rules" },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  const maxDaily = Math.max(1, ...m.daily.map((d) => d.received));

  return (
    <div className="container-page py-8">
      <PageHeader title="Inbox" hint={m.waiting > 0 ? `${m.waiting} order${m.waiting === 1 ? "" : "s"} waiting on a person.` : "Nothing is waiting on a person."}>
        <AutoRefresh active={working} />
        <Link href="/app/review" className="btn-primary">
          Review queue{m.waiting ? ` (${m.waiting})` : ""}
        </Link>
      </PageHeader>

      {shadow ? (
        <p className="mt-4 rounded-md border border-border bg-warn-soft px-3 py-2 text-sm text-warn">
          Shadow mode is on. Orders are read, matched and validated, and you can confirm them, but nothing is posted to your ERP.{" "}
          <Link href="/app/settings#rules" className="underline underline-offset-2">
            Change in Settings
          </Link>
        </p>
      ) : null}

      {!allowance.allowed ? (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          Posting is paused. {allowance.reason}{" "}
          <Link href="/app/settings#billing" className="underline underline-offset-2">
            Open billing
          </Link>
        </p>
      ) : allowance.trialRemaining !== null && allowance.trialRemaining <= 10 && !shadow ? (
        <p className="mt-4 rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm">
          {allowance.trialRemaining} posted order{allowance.trialRemaining === 1 ? "" : "s"} left in the trial.{" "}
          <Link href="/app/settings#billing" className="underline underline-offset-2">
            Choose a plan
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="metrics-heading" className="mt-6">
        <h2 id="metrics-heading" className="sr-only">
          Last 30 days
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Orders processed" value={String(m.ordersReceived)} hint={`${m.ordersPosted} posted, ${m.ordersConfirmedShadow} confirmed, ${m.rejected} rejected`} />
          <Metric label="Touchless" value={pct(shadow ? m.shadowTouchlessRate : m.touchlessRate)} hint={shadow ? "Would have posted with no human (shadow)" : "Posted with no human action"} />
          <Metric label="Line accuracy" value={pct(m.lineAccuracy)} hint="Lines no one had to correct, on confirmed orders" />
          <Metric label="Time saved" value={m.minutesSaved ? hours(m.minutesSaved) : "—"} hint={`At ${tenant.settings.minutesPerOrder} min per order`} />
        </dl>
      </section>

      {doneCount < steps.length ? (
        <section aria-labelledby="setup-heading" className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 id="setup-heading" className="text-lg font-semibold">
              Get to your first posted order
            </h2>
            <span className="text-xs text-muted">
              {doneCount} of {steps.length} done
            </span>
          </div>
          <ol className="mt-3 grid gap-2">
            {steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <span aria-hidden="true" className={`mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${step.done ? "bg-ok-soft text-ok" : "border border-border text-muted"}`}>
                    {step.done ? "✓" : i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-medium">
                      {step.title} <span className="sr-only">{step.done ? "(done)" : "(to do)"}</span>
                    </h3>
                    <p className="text-sm text-muted">{step.body}</p>
                  </div>
                </div>
                {step.done ? null : (
                  <Link href={step.href} className="btn-secondary btn-sm shrink-0">
                    {step.cta}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section id="intake" aria-labelledby="intake-heading" className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 id="intake-heading" className="font-semibold">
            Your orders address
          </h2>
          <p className="mt-1 text-sm text-muted">Forward or auto-forward customer order emails here. Attachments and multi-order emails are handled.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded bg-bg-subtle px-2 py-1 text-sm break-all">{tenant.inboundAddress}</code>
            <CopyButton text={tenant.inboundAddress} />
          </div>
          {s.demo ? <p className="mt-2 text-xs text-muted">Demo mode does not receive email. Use the upload on the right.</p> : null}
        </div>
        <div className="card">
          <h2 className="font-semibold">Upload purchase orders</h2>
          <div className="mt-3">
            <UploadForm compact />
          </div>
          {s.demo ? (
            <p className="mt-3 text-xs text-muted">
              The demo parser reads text and CSV only. Try a .txt file with lines like <code>20 EA EMT-075-10 3/4 EMT conduit @ 9.80</code> and a line <code>PO# 12345</code>.
            </p>
          ) : null}
        </div>
      </section>

      {messages.length > 0 ? (
        <section aria-labelledby="messages-heading" className="mt-8">
          <h2 id="messages-heading" className="text-lg font-semibold">
            Messages that did not become orders
          </h2>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {messages.map((msg) => (
              <li key={msg.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{msg.subject ?? "(no subject)"}</p>
                  <p className="text-xs text-muted">
                    {msg.fromAddress ?? "upload"} · {ago(msg.receivedAt)} ·{" "}
                    <span className={msg.status === "failed" ? "text-danger" : ""}>{msg.status === "received" || msg.status === "processing" ? "processing" : (msg.error ?? msg.status)}</span>
                  </p>
                </div>
                {msg.status === "failed" || (msg.status === "ignored" && msg.classification !== "duplicate") ? (
                  <ActionButton action={retryMessageAction.bind(null, msg.id)}>Try again</ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="recent-heading" className="mt-8">
        <h2 id="recent-heading" className="text-lg font-semibold">
          Recent orders
        </h2>
        <div className="mt-3">
          <OrderTable rows={recent} empty="No orders yet. Upload a few purchase orders above to see drafts here." />
        </div>
      </section>

      {m.ordersReceived > 0 ? (
        <section className="mt-8 grid gap-4 lg:grid-cols-3">
          <div className="card">
            <h2 className="font-semibold">Orders per day</h2>
            <ol className="mt-4 flex h-28 items-end gap-1" aria-label="Orders received per day, last 14 days">
              {m.daily.map((d) => (
                <li key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.received} received, ${d.posted} posted`}>
                  <div className="rounded-t bg-accent" style={{ height: `${(d.received / maxDaily) * 100}%`, minHeight: d.received ? 2 : 0 }} />
                  <span className="sr-only">
                    {d.day}: {d.received} received
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted">Last 14 days</p>
          </div>
          <div className="card">
            <h2 className="font-semibold">Exceptions by type</h2>
            {m.exceptionsByType.length ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {m.exceptionsByType.slice(0, 7).map((e) => (
                  <li key={e.code} className="flex justify-between gap-3">
                    <span>{e.label}</span>
                    <span className="text-muted tabular-nums">{e.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">No open exceptions.</p>
            )}
          </div>
          <div className="card">
            <h2 className="font-semibold">By customer</h2>
            <ul className="mt-3 space-y-1.5 text-sm">
              {m.byCustomer.slice(0, 7).map((c) => (
                <li key={c.customerId ?? "unknown"} className="flex justify-between gap-3">
                  {c.customerId ? (
                    <Link href={`/app/customers/${c.customerId}`} className="truncate underline-offset-2 hover:underline">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="truncate">{c.name}</span>
                  )}
                  <span className="shrink-0 text-muted tabular-nums">
                    {c.orders} orders{c.waiting ? `, ${c.waiting} waiting` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card !p-5">
      <dt className="text-sm font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-muted">{hint}</dd>
    </div>
  );
}
