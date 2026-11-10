import type { Metadata } from "next";
import { listOrders } from "@desk/service";
import { OrderTable } from "@/components/app/order-table";
import { PageHeader, SearchBox } from "@/components/app/page-header";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Posted" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { q } = await searchParams;
  const rows = await listOrders(s.deps, s.tenantId, { statuses: ["posted", "confirmed"], q, limit: 200 });
  return (
    <div className="container-page py-8">
      <PageHeader title="Posted" hint="Orders in your ERP, and orders confirmed while posting was off.">
        <SearchBox action="/app/posted" q={q} placeholder="PO number, customer, subject" />
        <a href="/api/export/orders" className="btn-secondary">
          Download CSV
        </a>
      </PageHeader>
      <div className="mt-6">
        <OrderTable rows={rows} empty={q ? "No orders match that search." : "Nothing has been confirmed yet."} showStatus={true} />
      </div>
    </div>
  );
}
