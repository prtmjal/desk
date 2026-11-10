import { exportOrdersCsv } from "@desk/service";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Confirmed and posted orders as one CSV, for import into any ERP (plan §6.2 universal fallback). */
export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const sinceParam = new URL(req.url).searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : undefined;
  const { csv } = await exportOrdersCsv(session.deps, session.tenantId, { since });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="desk-sales-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
