import { sql } from "drizzle-orm";
import { isAnthropicConfigured, isDatabaseConfigured, isDemoMode, isInngestConfigured, isPostmarkConfigured } from "@/lib/env";
import { getDeps } from "@/lib/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness and readiness for uptime monitors. Reports which parts are on; never any secret or tenant data. */
export async function GET(): Promise<Response> {
  const checks: Record<string, boolean | "n/a"> = {
    database: "n/a",
    extraction: isAnthropicConfigured(),
    email: isPostmarkConfigured(),
    jobs: isInngestConfigured(),
  };
  let ok = true;
  if (isDatabaseConfigured() || isDemoMode()) {
    try {
      await (await getDeps()).db.execute(sql`select 1`);
      checks.database = true;
    } catch {
      checks.database = false;
      ok = false;
    }
  }
  return Response.json({ ok, checks, time: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
