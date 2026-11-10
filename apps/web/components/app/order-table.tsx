import type { OrderListItem } from "@desk/service";
import Link from "next/link";
import { ago, money, STATUS_LABEL, statusBadge } from "@/lib/format";

export function OrderTable({ rows, empty, showStatus = true }: { rows: OrderListItem[]; empty: string; showStatus?: boolean }) {
  if (rows.length === 0) return <p className="card text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">PO</th>
            <th scope="col" className="text-right">Lines</th>
            <th scope="col" className="text-right">Total</th>
            {showStatus ? <th scope="col">Status</th> : null}
            <th scope="col">Notes</th>
            <th scope="col">Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className="hover:bg-bg-subtle">
              <td>
                <Link href={`/app/orders/${o.id}`} className="font-medium underline-offset-2 hover:underline">
                  {o.customerName ?? "Unidentified customer"}
                </Link>
                {o.sender ? <div className="text-xs text-muted">{o.sender}</div> : null}
              </td>
              <td className="font-mono text-xs">{o.poNumber ?? "—"}</td>
              <td className="text-right tabular-nums">{o.lineCount}</td>
              <td className="text-right tabular-nums">{money(o.total)}</td>
              {showStatus ? (
                <td>
                  <span className={statusBadge(o.status)}>{STATUS_LABEL[o.status] ?? o.status}</span>
                </td>
              ) : null}
              <td className="text-xs text-muted">
                {o.status === "posted" ? (
                  <>
                    {o.erpUrl ? (
                      <a href={o.erpUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                        {o.erpOrderNumber ?? "Open in ERP"}
                      </a>
                    ) : (
                      (o.erpOrderNumber ?? "")
                    )}
                    {o.touchless ? <span className="badge badge-ok ml-2">Touchless</span> : null}
                  </>
                ) : o.status === "rejected" ? (
                  o.rejectReason
                ) : o.postError ? (
                  <span className="text-danger">{o.postError}</span>
                ) : (
                  <>
                    {o.issueCount > 0 ? `${o.issueCount} to check` : "No issues"}
                    {o.shadowEligible ? <span className="badge badge-accent ml-2">Would auto-post</span> : null}
                  </>
                )}
              </td>
              <td className="text-xs whitespace-nowrap text-muted">{ago(o.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
