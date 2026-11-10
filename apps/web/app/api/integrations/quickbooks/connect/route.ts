import { qboAuthorizeUrl, qboScopes } from "@desk/erp";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { appUrl } from "@/lib/env";
import { makeState, QBO_STATE_COOKIE, qboConfig } from "@/lib/server/qbo";
import { canAdmin, getSession } from "@/lib/server/session";

export const runtime = "nodejs";

/** Start the QuickBooks Online OAuth flow (plan §6.3 onboarding: "connect ERP"). */
export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${appUrl()}/sign-in`);
  const back = (msg: string) => NextResponse.redirect(`${appUrl()}/app/settings?error=${encodeURIComponent(msg)}`);
  if (!canAdmin(session)) return back("Only an owner or admin can connect an ERP.");
  const cfg = qboConfig();
  if (!cfg) return back("QuickBooks is not configured on this deployment (QBO_CLIENT_ID / QBO_CLIENT_SECRET).");
  if (!process.env.DESK_SECRETS_KEY) return back("DESK_SECRETS_KEY is not set; it is required to store ERP credentials.");

  const orderEntity = new URL(req.url).searchParams.get("entity") === "sales_order" ? "sales_order" : "estimate";
  const state = makeState(session.tenantId, orderEntity);
  (await cookies()).set(QBO_STATE_COOKIE, state, { httpOnly: true, secure: appUrl().startsWith("https://"), sameSite: "lax", path: "/api/integrations/quickbooks", maxAge: 600 });
  return NextResponse.redirect(qboAuthorizeUrl({ clientId: cfg.clientId, redirectUri: cfg.redirectUri, state, scopes: qboScopes(orderEntity) }));
}
