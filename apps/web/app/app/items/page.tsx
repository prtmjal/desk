import type { Metadata } from "next";
import { listItems } from "@desk/service";
import { importCsvAction } from "../actions";
import { ActionForm } from "@/components/app/forms";
import { PageHeader, SearchBox } from "@/components/app/page-header";
import { money, num } from "@/lib/format";
import { canAdmin, requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Items" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { q } = await searchParams;
  const { rows, total } = await listItems(s.deps, s.tenantId, { q, limit: 200 });
  return (
    <div className="container-page py-8">
      <PageHeader title="Items" hint={`${total} items mirrored from your ERP. Orders are matched against this list.`}>
        <SearchBox action="/app/items" q={q} placeholder="SKU, description, MPN, UPC" />
      </PageHeader>
      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Description</th>
              <th scope="col">MPN / UPC</th>
              <th scope="col">Unit</th>
              <th scope="col" className="text-right">List price</th>
              <th scope="col" className="text-right">Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className={i.active ? undefined : "opacity-60"}>
                <td className="font-mono text-xs whitespace-nowrap">{i.sku}</td>
                <td>
                  {i.description}
                  {i.active ? null : <span className="badge ml-2">Inactive</span>}
                </td>
                <td className="font-mono text-xs text-muted">{[i.mpn, i.upc].filter(Boolean).join(" / ") || "—"}</td>
                <td className="text-xs">
                  {i.uom}
                  {i.packNote ? <span className="block text-muted">{i.packNote}</span> : null}
                </td>
                <td className="text-right tabular-nums">{money(i.listPrice)}</td>
                <td className="text-right tabular-nums">{i.stockAvailable === null ? <span className="text-muted">not tracked</span> : num(i.stockAvailable, 0)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">
                  {q ? "No items match that search." : "No items yet. Connect your ERP in Settings, or import an item list below."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length === 200 && total > 200 ? <p className="mt-2 text-xs text-muted">Showing the first 200. Search to narrow the list.</p> : null}
      {canAdmin(s) ? (
        <section className="card mt-8 max-w-2xl">
          <h2 className="font-semibold">Import items from CSV</h2>
          <p className="mt-1 text-sm text-muted">
            Export your item master from the ERP. Needs a header row with <code>SKU</code> and <code>Description</code>; optional <code>UPC</code>, <code>MPN</code>, <code>UoM</code>, <code>Price</code>. Re-importing updates existing items by SKU.
          </p>
          <div className="mt-4">
            <ActionForm action={importCsvAction.bind(null, "items")} submit="Import items">
              <input name="file" type="file" accept=".csv,text/csv" required aria-label="Items CSV file" className="field" />
            </ActionForm>
          </div>
        </section>
      ) : null}
    </div>
  );
}
