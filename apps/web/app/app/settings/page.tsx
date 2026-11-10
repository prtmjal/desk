import type { Metadata } from "next";
import { getTenant, listIntegrations } from "@desk/service";
import Link from "next/link";
import { connectSimpleAction, disconnectAction, openBillingPortalAction, saveAckAction, saveRulesAction, sendDigestNowAction, setOrderEntityAction, startCheckoutAction, syncNowAction } from "../actions";
import { ActionForm, Check } from "@/components/app/forms";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton, CopyButton } from "@/components/app/ui";
import { money, when } from "@/lib/format";
import { isAnthropicConfigured, isInngestConfigured, isPostmarkConfigured, isQuickBooksConfigured, isStripeConfigured } from "@/lib/env";
import { billingSummary, configuredPlans } from "@/lib/server/billing";
import { canAdmin, requireSession } from "@/lib/server/session";
import { PLANS } from "@/lib/site";

export const metadata: Metadata = { title: "Settings" };

const TYPE_LABEL: Record<string, string> = { quickbooks_online: "QuickBooks Online", csv: "CSV export", demo: "Demo ERP" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; billing?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const [tenant, integrations, billing] = await Promise.all([getTenant(s.deps, s.tenantId), listIntegrations(s.deps, s.tenantId), billingSummary(s.deps, s.tenantId)]);
  const admin = canAdmin(s);
  const st = tenant.settings;
  const active = integrations.find((i) => i.status === "connected") ?? integrations.find((i) => i.status === "error") ?? null;
  const plans = configuredPlans();

  return (
    <div className="container-page py-8">
      <PageHeader title="Settings" hint={`${tenant.name} · ${admin ? "you can change these settings" : "only owners and admins can change these settings"}`}>
        <Link href="/app/settings/audit" className="btn-secondary">
          Audit log
        </Link>
      </PageHeader>

      {sp.error ? <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{sp.error}</p> : null}
      {sp.connected ? <p role="status" className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">QuickBooks is connected. The first sync of items and customers is running; refresh in a minute.</p> : null}
      {sp.billing === "success" ? <p role="status" className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">Thank you. Your subscription will show here in a moment.</p> : null}

      <div className="mt-6 grid gap-6">
        {/* ERP */}
        <section id="erp" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">ERP connection</h2>
          {active ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{TYPE_LABEL[active.type] ?? active.type}</span>
                <span className={active.status === "connected" ? "badge badge-ok" : "badge badge-danger"}>{active.status === "connected" ? "Connected" : "Needs attention"}</span>
                <span className="text-muted">{active.lastSyncAt ? `Last sync ${when(active.lastSyncAt)}` : "Not synced yet"}</span>
              </div>
              {active.lastError ? <p className="text-sm text-danger">{active.lastError}</p> : null}
              {active.type === "csv" ? (
                <p className="text-sm text-muted">
                  Confirmed orders collect in a CSV you import into your ERP:{" "}
                  <a href="/api/export/orders" className="underline underline-offset-2">download sales orders CSV</a>. Item and customer lists are imported on the Items and Customers pages.
                </p>
              ) : null}
              {active.type === "quickbooks_online" ? (
                <div className="text-sm">
                  <p>
                    Orders post as: <span className="font-medium">{(active.config as { orderEntity?: string }).orderEntity === "sales_order" ? "Sales Orders" : "Estimates"}</span>
                  </p>
                  <p className="mt-1 text-muted">
                    Estimates work on every QuickBooks Online plan. Sales Orders use Intuit&apos;s newer Sales Order API and need QuickBooks Online Plus or Advanced with the Sales Orders feature switched on.
                  </p>
                  {admin ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionButton action={setOrderEntityAction.bind(null, active.id, "estimate")}>Post as Estimates</ActionButton>
                      <ActionButton action={setOrderEntityAction.bind(null, active.id, "sales_order")}>Post as Sales Orders</ActionButton>
                      <a href="/api/integrations/quickbooks/connect?entity=sales_order" className="btn-secondary btn-sm">Reconnect with sales-order permission</a>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {admin ? (
                <div className="flex flex-wrap gap-2">
                  {active.type !== "csv" ? <ActionButton className="btn-primary btn-sm" action={syncNowAction.bind(null, active.id)}>Sync now</ActionButton> : null}
                  <ActionButton className="btn-danger btn-sm" action={disconnectAction.bind(null, active.id)} confirm="Disconnect this ERP? Orders will stop posting until you connect again.">Disconnect</ActionButton>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p className="text-muted">Connect the system your sales orders live in. Items, customers, prices and stock sync from it; confirmed orders post to it.</p>
              {admin ? (
                <div className="flex flex-wrap gap-2">
                  {isQuickBooksConfigured() ? (
                    <a href="/api/integrations/quickbooks/connect" className="btn-primary">Connect QuickBooks Online</a>
                  ) : (
                    <span className="btn-secondary cursor-not-allowed opacity-60" title="Set QBO_CLIENT_ID and QBO_CLIENT_SECRET to enable">QuickBooks Online (not configured)</span>
                  )}
                  <ActionButton className="btn-secondary" action={connectSimpleAction.bind(null, "csv")}>Use CSV export</ActionButton>
                  {s.demo ? <ActionButton className="btn-secondary" action={connectSimpleAction.bind(null, "demo")}>Connect demo ERP</ActionButton> : null}
                </div>
              ) : null}
            </div>
          )}
        </section>

        {/* Intake */}
        <section id="intake" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">Order intake</h2>
          <p className="mt-1 text-sm text-muted">Forward customer order emails to this address, or add it as an auto-forward rule on your orders inbox.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded bg-bg-subtle px-2 py-1 text-sm break-all">{tenant.inboundAddress}</code>
            <CopyButton text={tenant.inboundAddress} />
          </div>
        </section>

        {/* Rules */}
        <section id="rules" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">Rules</h2>
          <p className="mt-1 text-sm text-muted">What the desk may do on its own. Per-customer overrides live on each customer&apos;s page.</p>
          <fieldset disabled={!admin} className="mt-4">
            <ActionForm action={saveRulesAction} submit="Save rules">
              <Check name="shadowMode" label="Shadow mode" hint="Read, match and validate every order, but post nothing to the ERP. Use it for the first two weeks to see the numbers before going live." defaultChecked={st.shadowMode} />
              <Check name="autoPost" label="Auto-post clean orders" hint="Post without a person when every line is an exact or learned match, prices are within tolerance and nothing is flagged. A model's guess never auto-posts." defaultChecked={st.autoPost} />
              <Check name="holdOnStockShort" label="Hold orders when stock is short" hint="Off: short lines are flagged but may post as backorders." defaultChecked={st.holdOnStockShort} />
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor="autoPostThreshold" className="label">Minimum match score</label>
                  <input id="autoPostThreshold" name="autoPostThreshold" type="number" step="0.01" min="0.5" max="1" required className="field" defaultValue={st.autoPostThreshold} />
                </div>
                <div>
                  <label htmlFor="priceTolerancePct" className="label">Price tolerance (%)</label>
                  <input id="priceTolerancePct" name="priceTolerancePct" type="number" step="0.1" min="0" max="100" required className="field" defaultValue={st.priceTolerancePct} />
                </div>
                <div>
                  <label htmlFor="minutesPerOrder" className="label">Minutes per manual order</label>
                  <input id="minutesPerOrder" name="minutesPerOrder" type="number" step="1" min="1" max="120" required className="field" defaultValue={st.minutesPerOrder} />
                </div>
              </div>
            </ActionForm>
          </fieldset>
        </section>

        {/* Email */}
        <section id="email" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">Customer acknowledgment and digest</h2>
          <p className="mt-1 text-sm text-muted">
            Placeholders: <code>{"{{poNumber}}"}</code> <code>{"{{orderNumber}}"}</code> <code>{"{{contactName}}"}</code> <code>{"{{customerName}}"}</code> <code>{"{{requestedShipDate}}"}</code> <code>{"{{lines}}"}</code> <code>{"{{companyName}}"}</code>
          </p>
          <fieldset disabled={!admin} className="mt-4">
            <ActionForm action={saveAckAction} submit="Save email settings">
              <Check name="ackEnabled" label="Offer an acknowledgment for each posted order" defaultChecked={st.ackEnabled} />
              <Check name="ackAutoSend" label="Send it automatically after posting" hint="Off: a person sends it from the order page." defaultChecked={st.ackAutoSend} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="ackSubject" className="label">Subject</label>
                  <input id="ackSubject" name="ackSubject" required className="field" defaultValue={st.ackSubject} />
                </div>
                <div>
                  <label htmlFor="ackReplyTo" className="label">Reply-to address</label>
                  <input id="ackReplyTo" name="ackReplyTo" type="email" className="field" defaultValue={st.ackReplyTo ?? ""} placeholder="orders@yourcompany.com" />
                </div>
              </div>
              <div>
                <label htmlFor="ackBody" className="label">Body</label>
                <textarea id="ackBody" name="ackBody" required rows={9} className="field font-mono text-xs" defaultValue={st.ackBody} />
              </div>
              <div>
                <label htmlFor="digestRecipients" className="label">Weekly digest recipients</label>
                <input id="digestRecipients" name="digestRecipients" className="field" defaultValue={(st.digestRecipients ?? []).join(", ")} placeholder="ops@yourcompany.com, owner@yourcompany.com" />
                <p className="mt-1 text-xs text-muted">Mondays: orders posted, touchless rate, hours saved, top exceptions.</p>
              </div>
            </ActionForm>
          </fieldset>
          {admin ? <div className="mt-3"><ActionButton action={sendDigestNowAction}>Send this week&apos;s digest now</ActionButton></div> : null}
        </section>

        {/* Billing */}
        <section id="billing" className="card scroll-mt-6">
          <h2 className="text-lg font-semibold">Plan and billing</h2>
          <p className="mt-1 text-sm">
            Current plan: <span className="font-medium capitalize">{tenant.plan}</span>
            {billing.subscription ? <span className="text-muted"> · {billing.subscription.status}{billing.subscription.currentPeriodEnd ? ` · renews ${when(billing.subscription.currentPeriodEnd)}` : ""}</span> : null}
          </p>
          <p className="mt-1 text-sm text-muted">You are billed only for orders that reach your ERP, never for rejected or unreadable documents.</p>
          {isStripeConfigured() ? (
            admin ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {PLANS.filter((p) => plans.includes(p.name.toLowerCase() as (typeof plans)[number])).map((p) => (
                  <ActionButton key={p.name} className="btn-secondary" action={startCheckoutAction.bind(null, p.name.toLowerCase() as (typeof plans)[number])}>
                    Choose {p.name}
                  </ActionButton>
                ))}
                {plans.length === 0 ? <p className="text-sm text-muted">No Stripe prices are configured yet (STRIPE_PRICE_STARTER, …).</p> : null}
                {billing.subscription ? <ActionButton className="btn-secondary" action={openBillingPortalAction}>Manage billing</ActionButton> : null}
              </div>
            ) : null
          ) : (
            <p className="mt-3 text-sm text-muted">Billing is not configured on this deployment.</p>
          )}
          {billing.invoices.length ? (
            <ul className="mt-4 divide-y divide-border text-sm">
              {billing.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{inv.issuedAt ? when(inv.issuedAt) : "—"}</span>
                  <span className="tabular-nums">{money(inv.amountDue, inv.currency)}</span>
                  <span className="badge">{inv.status}</span>
                  {inv.hostedUrl ? <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">View</a> : <span />}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Deployment status */}
        <section className="card">
          <h2 className="text-lg font-semibold">This deployment</h2>
          <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            <Flag on={isAnthropicConfigured()} label="Extraction model (Anthropic)" off={s.demo ? "offline demo parser in use" : "not configured: orders cannot be read"} />
            <Flag on={isPostmarkConfigured() && Boolean(process.env.POSTMARK_INBOUND_SECRET)} label="Email in and out (Postmark)" off="not configured: upload only, no acknowledgments" />
            <Flag on={isQuickBooksConfigured()} label="QuickBooks Online app" off="not configured" />
            <Flag on={isInngestConfigured()} label="Durable job runner (Inngest)" off="not configured: processing runs in the web process" />
            <Flag on={isStripeConfigured()} label="Billing (Stripe)" off="not configured" />
            <Flag on={Boolean(process.env.S3_ENDPOINT)} label="Document storage (S3 / R2)" off="local disk" />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Flag({ on, label, off }: { on: boolean; label: string; off: string }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${on ? "bg-ok" : "bg-border"}`} />
      <span>
        {label}
        <span className="text-muted"> — {on ? "on" : off}</span>
      </span>
    </li>
  );
}
