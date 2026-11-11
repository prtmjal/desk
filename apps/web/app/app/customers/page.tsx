import type { Metadata } from "next";
import { listCustomers } from "@desk/service";
import Link from "next/link";
import { importCsvAction } from "../actions";
import { ActionForm } from "@/components/app/forms";
import { PageHeader, SearchBox } from "@/components/app/page-header";
import { canAdmin, requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { q } = await searchParams;
  const rows = await listCustomers(s.deps, s.tenantId, { q });
  return (
    <div className="container-page py-8">
      <PageHeader title="Customers" hint="Who orders from you, what the desk has learned about how they write part numbers, and who may auto-post.">
        <SearchBox action="/app/customers" q={q} placeholder="Name or account number" />
      </PageHeader>
      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Email domains</th>
              <th scope="col" className="text-right">Learned aliases</th>
              <th scope="col" className="text-right">Orders</th>
              <th scope="col">Auto-post</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-bg-subtle">
                <td>
                  <Link href={`/app/customers/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {c.accountNumber ? `Account ${c.accountNumber}` : "No account number"}
                    {c.creditHold ? <span className="badge badge-danger ml-2">Credit hold</span> : null}
                    {c.active ? null : <span className="badge ml-2">Inactive</span>}
                  </div>
                </td>
                <td className="text-xs text-muted">{c.domains.join(", ") || "—"}</td>
                <td className="text-right tabular-nums">{c.aliasCount}</td>
                <td className="text-right tabular-nums">{c.orderCount}</td>
                <td>
                  <span className={c.autoPost === "on" ? "badge badge-ok" : c.autoPost === "off" ? "badge badge-warn" : "badge"}>{c.autoPost === "default" ? "Company default" : c.autoPost === "on" ? "On" : "Off"}</span>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">
                  {q ? "No customers match that search." : "No customers yet. Connect your ERP in Settings, or import a customer list below."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {canAdmin(s) ? (
        <section className="card mt-8 max-w-2xl">
          <h2 className="font-semibold">Import customers from CSV</h2>
          <p className="mt-1 text-sm text-muted">
            Export your customer list from the ERP. Needs a header row with <code>Name</code>; optional <code>ID</code>, <code>Account</code>, <code>Email</code> or <code>Domain</code>. Re-importing updates existing customers.
          </p>
          <div className="mt-4">
            <ActionForm action={importCsvAction.bind(null, "customers")} submit="Import customers">
              <input name="file" type="file" accept=".csv,text/csv" required aria-label="Customers CSV file" className="field" />
            </ActionForm>
          </div>
        </section>
      ) : null}
    </div>
  );
}
