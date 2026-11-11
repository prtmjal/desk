import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { QboEnvironment, QboOrderEntity } from "@desk/erp";
import { appUrl } from "@/lib/env";

export const QBO_STATE_COOKIE = "desk_qbo_state";

export function qboConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const environment: QboEnvironment = process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";
  return { clientId, clientSecret, environment, redirectUri: `${appUrl()}/api/integrations/quickbooks/callback` };
}

type StatePayload = { t: string; e: QboOrderEntity; n: string; x: number };

function sign(body: string): string {
  const key = process.env.DESK_SECRETS_KEY;
  if (!key) throw new Error("DESK_SECRETS_KEY is not set");
  return createHmac("sha256", key).update(body).digest("base64url");
}

/** OAuth `state`: binds the callback to the tenant that started the flow, for 10 minutes. */
export function makeState(tenantId: string, orderEntity: QboOrderEntity): string {
  const body = Buffer.from(JSON.stringify({ t: tenantId, e: orderEntity, n: randomBytes(12).toString("hex"), x: Date.now() + 10 * 60_000 } satisfies StatePayload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readState(state: string | null): { tenantId: string; orderEntity: QboOrderEntity } | null {
  if (!state) return null;
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (typeof p.x !== "number" || p.x < Date.now()) return null;
    return { tenantId: p.t, orderEntity: p.e === "sales_order" ? "sales_order" : "estimate" };
  } catch {
    return null;
  }
}
