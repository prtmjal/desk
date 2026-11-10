import type { Metadata } from "next";
import { listOrders } from "@desk/service";
import { OrderTable } from "@/components/app/order-table";
import { PageHeader, SearchBox } from "@/components/app/page-header";
import { requireSession } from "@/lib/server/session";

export const metadata: Metadata = { title: "Needs review" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireSession();
  const { q } = await searchParams;
  const rows = await listOrders(s.deps, s.tenantId, { statuses: ["needs_review", "new"], q, limit: 200 });
  // Exceptions first: they are the ones that need thought.
  rows.sort((a, b) => Number(b.status === "needs_review") - Number(a.status === "needs_review"));
  return (
    <div className="container-page py-8">
      <PageHeader title="Needs review" hint="Exceptions first, then drafts that only need a confirm. Press Enter on a row to open it.">
        <SearchBox action="/app/review" q={q} placeholder="PO number, customer, subject" />
      </PageHeader>
      <div className="mt-6">
        <OrderTable rows={rows} empty={q ? "No orders match that search." : "The queue is empty. New orders appear here when they need a person."} showStatus={true} />
      </div>
    </div>
  );
}
