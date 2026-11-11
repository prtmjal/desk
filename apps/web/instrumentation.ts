/**
 * Server error reporting. Every unhandled request error is logged as one JSON line; when
 * SENTRY_DSN is set it is also sent to Sentry's envelope endpoint with plain fetch
 * (no SDK dependency). Request bodies, headers and query strings are never included.
 */
type RequestInfo = { path: string; method: string };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

export function parseDsn(dsn: string): { url: string; key: string } | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+/, "");
    if (!u.username || !project) return null;
    return { url: `${u.protocol}//${u.host}/api/${project}/envelope/`, key: u.username };
  } catch {
    return null;
  }
}

export async function onRequestError(err: unknown, request: RequestInfo, context: ErrorContext): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  const digest = (err as { digest?: string }).digest;
  const path = request.path.split("?")[0];
  console.error(JSON.stringify({ level: "error", msg: e.message.slice(0, 500), name: e.name, digest, method: request.method, path, route: context.routePath, kind: context.routeType }));

  const dsn = process.env.SENTRY_DSN ? parseDsn(process.env.SENTRY_DSN) : null;
  if (!dsn) return;
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    transaction: `${request.method} ${context.routePath}`,
    tags: { routeType: context.routeType, digest },
    exception: { values: [{ type: e.name, value: e.message.slice(0, 1000), stacktrace: e.stack ? { frames: [], raw: e.stack.slice(0, 4000) } : undefined }] },
    extra: { stack: e.stack?.slice(0, 4000) },
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  try {
    await fetch(dsn.url, { method: "POST", headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=desk/1` }, body, signal: AbortSignal.timeout(3000) });
  } catch {
    /* reporting must never break a request */
  }
}
