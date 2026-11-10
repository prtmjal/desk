import type { Metadata } from "next";
import { listEvents } from "@desk/service";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { when } from "@/lib/format";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Audit log" };

const ENTITIES = ["order", "message", "alias", "customer", "settings", "rule", "integration", "items", "customers"];

/** Every change, who or what made it, and the before/after values (plan §6.2, §4.5 moat #3). */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; before?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const entity = sp.entity && ENTITIES.includes(sp.entity) ? sp.entity : undefined;
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined;
  const rows = await listEvents(s.deps, s.tenantId, { entity, before, limit: 200 });
  const last = rows.at(-1);
  const me = s.actor.kind === "user" ? `user:${s.actor.id}` : "";

  return (
    <div className="container-page py-8">
      <Link href="/app/settings" className="text-sm text-muted underline-offset-2 hover:underline">
        ← Settings
      </Link>
      <div className="mt-2">
        <PageHeader title="Audit log" hint="Append-only. Entries cannot be edited or deleted from the application.">
          <form action="/app/settings/audit" className="flex gap-2">
            <label htmlFor="entity" className="sr-only">Filter by type</label>
            <select id="entity" name="entity" defaultValue={entity ?? ""} className="field">
              <option value="">Everything</option>
              {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            <button type="submit" className="btn-secondary">Filter</button>
          </form>
        </PageHeader>
      </div>
      <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="text-xs whitespace-nowrap text-muted">{when(e.at)}</td>
                <td className="text-xs whitespace-nowrap">{e.actor === "system" ? "DESK" : e.actor === me ? "You" : e.actor.startsWith("integration:") ? "ERP connector" : e.actor}</td>
                <td className="text-sm">
                  {e.entity === "order" && e.entityId ? (
                    <Link href={`/app/orders/${e.entityId}`} className="underline underline-offset-2">order</Link>
                  ) : (
                    e.entity
                  )}{" "}
                  <span className="font-medium">{e.action.replace(/[_:]/g, " ")}</span>
                </td>
                <td className="max-w-64 font-mono text-xs break-all text-muted">{e.before == null ? "—" : JSON.stringify(e.before)}</td>
                <td className="max-w-80 font-mono text-xs break-all">{e.after == null ? "—" : JSON.stringify(e.after)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-sm text-muted">Nothing recorded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length === 200 && last ? (
        <Link href={`/app/settings/audit?${entity ? `entity=${entity}&` : ""}before=${encodeURIComponent(last.at.toISOString())}`} className="btn-secondary mt-4">
          Older entries
        </Link>
      ) : null}
    </div>
  );
}
