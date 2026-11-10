import Link from "next/link";

const METRICS = [
  { label: "Orders processed", hint: "Last 30 days" },
  { label: "Touchless", hint: "Posted with no human edit" },
  { label: "Line accuracy", hint: "On confirmed orders" },
  { label: "Time saved", hint: "At 8 min per order" },
] as const;

const CHECKLIST = [
  {
    title: "Connect your ERP",
    body: "QuickBooks Online or NetSuite first. We sync items, customers, price lists and ship-tos. Orders post as drafts until you say otherwise.",
    action: { label: "Connect ERP", href: "/app/settings" },
  },
  {
    title: "Forward your orders@ address",
    body: "Point your existing orders inbox (or an inbox rule) at your tenant's DESK address. Multi-order emails and attachments are handled.",
    action: { label: "Get your address", href: "/app/settings" },
  },
  {
    title: "Upload 20 historical POs",
    body: "Faster than waiting for tomorrow's mail. Drafts appear in the review queue so you can see how matching behaves on your documents.",
    action: { label: "Upload POs", href: "/app/review" },
  },
  {
    title: "Set auto-post thresholds",
    body: "Off by default. Turn on per customer once the accuracy numbers above earn it.",
    action: { label: "Review rules", href: "/app/customers" },
  },
] as const;

export default function AppDashboardPage() {
  return (
    <div className="container-page py-8">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted">Nothing has arrived yet. Finish setup and the first drafts will land here.</p>
        </div>
      </header>

      <section aria-labelledby="metrics-heading" className="mt-8">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((m) => (
            <div key={m.label} className="card">
              <dt className="text-sm font-medium text-muted">{m.label}</dt>
              <dd className="mt-2 text-3xl font-semibold tracking-tight tabular-nums" aria-label="No data yet">
                —
              </dd>
              <dd className="mt-1 text-xs text-muted">{m.hint}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="setup-heading" className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 id="setup-heading" className="text-lg font-semibold">
            Get to your first draft order
          </h2>
          <span className="text-xs text-muted">0 of {CHECKLIST.length} done</span>
        </div>
        <ol className="mt-4 grid gap-3">
          {CHECKLIST.map((step, i) => (
            <li key={step.title} className="card flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium text-muted"
                >
                  {i + 1}
                </span>
                <div>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted">{step.body}</p>
                </div>
              </div>
              <Link href={step.action.href} className="btn-secondary shrink-0 !py-1.5">
                {step.action.label}
              </Link>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-muted">
          Phase 0 preview: this checklist is static. ERP connection and intake addresses arrive with
          the MVP.
        </p>
      </section>
    </div>
  );
}
