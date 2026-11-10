import { qboExchangeCode } from "@desk/erp";
import { connectQuickBooks, errorText, runSync } from "@desk/service";
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { QBO_STATE_COOKIE, qboConfig, readState } from "@/lib/server/qbo";
import { canAdmin, getSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** QuickBooks redirects here with ?code&state&realmId. Verify, store tokens, start the first sync. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const done = (query: string) => NextResponse.redirect(`${appUrl()}/app/settings?${query}`);
  const fail = (msg: string) => done(`error=${encodeURIComponent(msg)}`);

  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl()}/sign-in`);
  if (!canAdmin(session)) return fail("Only an owner or admin can connect an ERP.");
  const cfg = qboConfig();
  if (!cfg) return fail("QuickBooks is not configured on this deployment.");
  if (url.searchParams.get("error")) return fail(`QuickBooks did not authorize the connection (${url.searchParams.get("error")}).`);

  const jar = await cookies();
  const state = url.searchParams.get("state");
  const cookieState = jar.get(QBO_STATE_COOKIE)?.value;
  jar.delete(QBO_STATE_COOKIE);
  const parsed = readState(state);
  // The state must be ours, unexpired, issued to this browser, and for this tenant.
  if (!parsed || !cookieState || cookieState !== state || parsed.tenantId !== session.tenantId) return fail("The QuickBooks connection could not be verified. Start again from Settings.");

  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!code || !realmId) return fail("QuickBooks returned an incomplete response.");

  try {
    const tokens = await qboExchangeCode({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri, code });
    const integration = await connectQuickBooks(session.deps, session.tenantId, { realmId, tokens, orderEntity: parsed.orderEntity }, session.actor);
    after(async () => {
      try {
        await runSync(session.deps, session.tenantId, integration.id, session.actor);
      } catch (err) {
        console.error("[qbo] first sync failed", err);
      }
    });
    return done("connected=quickbooks");
  } catch (err) {
    return fail(errorText(err));
  }
}
