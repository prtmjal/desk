import type { Metadata } from "next";
import { listOrders } from "@desk/service";
import { OrderTable } from "@/components/app/order-table";
import { PageHeader, SearchBox } from "@/components/app/page-header";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Rejected" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { q } = await searchParams;
  const rows = await listOrders(s.deps, s.tenantId, { statuses: ["rejected"], q, limit: 200 });
  return (
    <div className="container-page py-8">
      <PageHeader title="Rejected" hint="Declined in review. A rejected order can be reopened from its page.">
        <SearchBox action="/app/rejected" q={q} placeholder="PO number, customer, subject" />
      </PageHeader>
      <div className="mt-6">
        <OrderTable rows={rows} empty={q ? "No orders match that search." : "No rejected orders."} showStatus={false} />
      </div>
    </div>
  );
}
