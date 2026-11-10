import type { Metadata } from "next";
import { getCustomer, getTenant } from "@desk/service";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAliasAction, saveCustomerAction } from "../../actions";
import { ActionForm } from "@/components/app/forms";
import { PageHeader } from "@/components/app/page-header";
import { ActionButton } from "@/components/app/ui";
import { ago, money, STATUS_LABEL, statusBadge } from "@/lib/format";
import { canAdmin, requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const [data, tenant] = await Promise.all([getCustomer(s.deps, s.tenantId, id), getTenant(s.deps, s.tenantId)]);
  if (!data) notFound();
  const { customer: c, aliases, rule, recent } = data;
  const mode = rule?.enabled === undefined ? "default" : rule.enabled ? "on" : "off";
  const admin = canAdmin(s);

  return (
    <div className="container-page py-8">
      <Link href="/app/customers" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Customers
      </Link>
      <div className="mt-2">
        <PageHeader title={c.name} hint={`ERP id ${c.erpId}${c.terms ? ` · ${c.terms}` : ""}${c.creditHold ? " · on credit hold" : ""}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-semibold">Identification and auto-post</h2>
          <div className="mt-4">
            <ActionForm action={saveCustomerAction.bind(null, c.id)}>
              <div>
                <label htmlFor="domains" className="label">Email domains</label>
                <input id="domains" name="domains" className="field" defaultValue={c.domains.join(", ")} placeholder="customer.com, branch.customer.com" />
                <p className="mt-1 text-xs text-muted">Orders from these domains are assigned to this customer. Learned automatically when you pick the customer in review.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="accountNumber" className="label">Account number on their POs</label>
                  <input id="accountNumber" name="accountNumber" className="field" defaultValue={c.accountNumber ?? ""} />
                </div>
                <div>
                  <label htmlFor="aka" className="label">Other names they use</label>
                  <input id="aka" name="aka" className="field" defaultValue={c.aka.join(", ")} />
                </div>
              </div>
              <fieldset disabled={!admin} className="grid gap-4 sm:grid-cols-3">
                <legend className="label">Auto-post for this customer{admin ? "" : " (admins only)"}</legend>
                <div>
                  <label htmlFor="autoPost" className="sr-only">Auto-post mode</label>
                  <select id="autoPost" name="autoPost" className="field" defaultValue={mode}>
                    <option value="default">Company default ({tenant.settings.autoPost ? "on" : "off"})</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="minLineMatchScore" className="sr-only">Minimum match score</label>
                  <input id="minLineMatchScore" name="minLineMatchScore" type="number" step="0.01" min="0.5" max="1" className="field" placeholder={`Match score (${tenant.settings.autoPostThreshold})`} defaultValue={rule?.minLineMatchScore ?? ""} />
                </div>
                <div>
                  <label htmlFor="maxPriceDeltaPct" className="sr-only">Price tolerance percent</label>
                  <input id="maxPriceDeltaPct" name="maxPriceDeltaPct" type="number" step="0.1" min="0" max="100" className="field" placeholder={`Price tolerance % (${tenant.settings.priceTolerancePct})`} defaultValue={rule?.maxPriceDeltaPct ?? ""} />
                </div>
              </fieldset>
            </ActionForm>
          </div>
        </section>

        <section className="card">
          <h2 className="font-semibold">Recent orders</h2>
          {recent.length ? (
            <ul className="mt-3 divide-y divide-border text-sm">
              {recent.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/app/orders/${o.id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                    {o.poNumber ?? "(no PO)"}
                  </Link>
                  <span className="text-muted tabular-nums">{money(o.total)}</span>
                  <span className={statusBadge(o.status)}>{STATUS_LABEL[o.status]}</span>
                  <span className="text-xs text-muted">{ago(o.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No orders from this customer yet.</p>
          )}
        </section>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">What the desk has learned</h2>
        <p className="mt-1 text-sm text-muted">Each row was confirmed by a person. The next order that uses the same part number or wording matches without help.</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">They write</th>
                <th scope="col">Your item</th>
                <th scope="col" className="text-right">Unit factor</th>
                <th scope="col" className="text-right">Times confirmed</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs">{a.rawPartKey ?? <span className="font-sans italic">“{a.rawDescriptionKey}”</span>}</td>
                  <td>
                    <span className="font-mono text-xs">{a.sku}</span> <span className="text-muted">{a.description}</span>
                  </td>
                  <td className="text-right tabular-nums">{a.uomFactor ? Number(a.uomFactor) : "—"}</td>
                  <td className="text-right tabular-nums">{a.hits}</td>
                  <td className="text-right">
                    <ActionButton action={deleteAliasAction.bind(null, a.id)} confirm="Forget this alias? The next order using it will need review again.">
                      Forget
                    </ActionButton>
                  </td>
                </tr>
              ))}
              {aliases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-sm text-muted">Nothing yet. Aliases appear after you confirm an order where you picked the item.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
