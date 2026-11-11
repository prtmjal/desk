/**
 * pnpm preflight [--env apps/web/.env.local]   (not `pnpm doctor`: that is pnpm's own command)
 *
 * Preflight for a deployment: reads the environment, then actually calls each configured
 * service with a harmless request and says, per service, whether launch can proceed.
 * Prints no secret values. Exit code 1 when a required check fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

export type Level = "ok" | "warn" | "fail" | "off";
export type Check = { area: string; level: Level; detail: string };
type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

const has = (env: Env, ...keys: string[]) => keys.every((k) => !!env[k]?.trim());
const missing = (env: Env, ...keys: string[]) => keys.filter((k) => !env[k]?.trim());

async function probe(f: Fetch, url: string, init: RequestInit, okStatuses = [200]): Promise<{ ok: boolean; status: number; json: unknown }> {
  try {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(10_000) });
    const json = await res.json().catch(() => null);
    return { ok: okStatuses.includes(res.status), status: res.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: { error: err instanceof Error ? err.message : String(err) } };
  }
}

export type DoctorDeps = { fetch?: Fetch; checkDatabase?: (url: string) => Promise<{ migrations: number; appRole: boolean; trgm: boolean }>; expectedMigrations?: number };

export async function runDoctor(env: Env, deps: DoctorDeps = {}): Promise<Check[]> {
  const f = deps.fetch ?? fetch;
  const out: Check[] = [];
  const add = (area: string, level: Level, detail: string) => out.push({ area, level, detail });
  const prod = /^https:\/\//.test(env.APP_URL ?? "") && !/localhost/.test(env.APP_URL ?? "");

  // --- required ------------------------------------------------------------------------
  if (!env.APP_URL) add("App URL", "fail", "APP_URL is not set (the public https address of the app)");
  else add("App URL", prod ? "ok" : "warn", prod ? env.APP_URL : `${env.APP_URL} is not a public https address`);

  if (!has(env, "DATABASE_URL")) add("Database", "fail", "DATABASE_URL is not set");
  else if (deps.checkDatabase) {
    try {
      const r = await deps.checkDatabase(env.DATABASE_URL as string);
      const want = deps.expectedMigrations ?? r.migrations;
      if (r.migrations < want) add("Database", "fail", `${r.migrations} of ${want} migrations applied: run pnpm db:migrate`);
      else if (!r.appRole) add("Database", "fail", "role app_user is missing: run pnpm db:migrate with the owner role");
      else if (!r.trgm) add("Database", "fail", "extension pg_trgm is not installed");
      else add("Database", "ok", `connected, ${r.migrations} migrations applied, row-level security role present`);
    } catch (err) {
      add("Database", "fail", `cannot connect: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  } else add("Database", "warn", "DATABASE_URL is set (connection not tested)");

  if (!has(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY")) add("Sign-in (Clerk)", "fail", `missing ${missing(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY").join(", ")}`);
  else {
    const r = await probe(f, "https://api.clerk.com/v1/organizations?limit=1", { headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
    const test = env.CLERK_SECRET_KEY!.startsWith("sk_test");
    if (r.ok) add("Sign-in (Clerk)", test && prod ? "warn" : "ok", test ? "key works (development instance: switch to a production instance before launch)" : "key works, organizations enabled");
    else add("Sign-in (Clerk)", "fail", r.status === 401 ? "CLERK_SECRET_KEY was rejected" : r.status === 403 || r.status === 404 ? "Organizations are not enabled on this Clerk instance" : `Clerk API returned ${r.status}`);
  }

  if (!has(env, "DESK_SECRETS_KEY")) add("Secrets key", "fail", "DESK_SECRETS_KEY is not set (openssl rand -base64 48)");
  else add("Secrets key", env.DESK_SECRETS_KEY!.length >= 32 ? "ok" : "fail", env.DESK_SECRETS_KEY!.length >= 32 ? "set" : "too short: use at least 32 characters");

  if (!has(env, "ANTHROPIC_API_KEY")) add("Extraction (Anthropic)", "fail", "ANTHROPIC_API_KEY is not set: orders cannot be read");
  else {
    const r = await probe(f, "https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" } });
    if (!r.ok) add("Extraction (Anthropic)", "fail", r.status === 401 ? "ANTHROPIC_API_KEY was rejected" : `Anthropic API returned ${r.status}`);
    else {
      const ids = new Set(((r.json as { data?: Array<{ id: string }> } | null)?.data ?? []).map((m) => m.id));
      const wanted = [env.DESK_EXTRACT_MODEL || "claude-opus-5-5", env.DESK_CLASSIFY_MODEL || "claude-haiku-5-5"];
      const unknown = ids.size ? wanted.filter((m) => !ids.has(m)) : [];
      add("Extraction (Anthropic)", unknown.length ? "fail" : "ok", unknown.length ? `model id not available to this key: ${unknown.join(", ")} (set DESK_EXTRACT_MODEL / DESK_CLASSIFY_MODEL)` : `key works, models ${wanted.join(" and ")}`);
    }
  }

  // --- needed for a real launch, app still runs without -----------------------------------
  if (!has(env, "POSTMARK_SERVER_TOKEN")) add("Email (Postmark)", "warn", "not configured: customers cannot email orders in; upload only, no acknowledgments");
  else {
    const r = await probe(f, "https://api.postmarkapp.com/server", { headers: { accept: "application/json", "x-postmark-server-token": env.POSTMARK_SERVER_TOKEN as string } });
    if (!r.ok) add("Email (Postmark)", "fail", r.status === 401 ? "POSTMARK_SERVER_TOKEN was rejected" : `Postmark returned ${r.status}`);
    else {
      const s = r.json as { InboundHookUrl?: string; InboundDomain?: string } | null;
      const problems = [
        !has(env, "POSTMARK_INBOUND_SECRET") ? "POSTMARK_INBOUND_SECRET is not set" : null,
        !has(env, "INBOUND_DOMAIN") || env.INBOUND_DOMAIN === "orders.example.com" ? "INBOUND_DOMAIN is not set to your domain" : null,
        !s?.InboundHookUrl ? "no inbound webhook URL is set on the Postmark server" : env.APP_URL && !s.InboundHookUrl.includes("/api/webhooks/postmark") ? "the inbound webhook does not point at /api/webhooks/postmark" : null,
        s?.InboundDomain && env.INBOUND_DOMAIN && s.InboundDomain !== env.INBOUND_DOMAIN ? `Postmark inbound domain is ${s.InboundDomain}, INBOUND_DOMAIN is ${env.INBOUND_DOMAIN}` : null,
        !has(env, "POSTMARK_FROM") ? "POSTMARK_FROM is not set" : null,
      ].filter(Boolean);
      add("Email (Postmark)", problems.length ? "warn" : "ok", problems.length ? problems.join("; ") : "token works, inbound webhook and domain set");
    }
  }

  if (!has(env, "INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY")) add("Jobs (Inngest)", "warn", "not configured: processing runs in the web process, no hourly ERP sync, no weekly digest, no automatic retry");
  else add("Jobs (Inngest)", "ok", "keys set (sync the app URL /api/inngest in the Inngest dashboard)");

  if (!has(env, "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")) add("Document storage", prod ? "fail" : "warn", "not configured: documents go to local disk, which serverless hosts erase");
  else add("Document storage", "ok", `bucket ${env.S3_BUCKET || "desk-documents"}`);

  if (!has(env, "QBO_CLIENT_ID", "QBO_CLIENT_SECRET")) add("QuickBooks Online", "warn", "not configured: customers can only use CSV export");
  else add("QuickBooks Online", env.QBO_ENVIRONMENT === "production" ? "ok" : "warn", env.QBO_ENVIRONMENT === "production" ? "production keys set" : "sandbox keys: real companies cannot connect until Intuit approves the app for production");

  if (!has(env, "STRIPE_SECRET_KEY")) add("Billing (Stripe)", "warn", "not configured: nobody can pay and nothing is limited");
  else {
    const prices = ["STRIPE_PRICE_STARTER", "STRIPE_PRICE_STARTER_OVERAGE", "STRIPE_PRICE_GROWTH", "STRIPE_PRICE_GROWTH_OVERAGE", "STRIPE_PRICE_SCALE", "STRIPE_PRICE_SCALE_OVERAGE"];
    const r = await probe(f, "https://api.stripe.com/v1/prices?limit=100&active=true", { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    if (!r.ok) add("Billing (Stripe)", "fail", r.status === 401 ? "STRIPE_SECRET_KEY was rejected" : `Stripe returned ${r.status}`);
    else {
      const ids = new Set(((r.json as { data?: Array<{ id: string }> } | null)?.data ?? []).map((p) => p.id));
      const unset = missing(env, ...prices);
      const wrong = prices.filter((k) => env[k] && !ids.has(env[k] as string));
      const test = env.STRIPE_SECRET_KEY!.startsWith("sk_test");
      const problems = [unset.length ? `not set: ${unset.join(", ")} (run pnpm stripe:setup)` : null, wrong.length ? `not found in this Stripe account: ${wrong.join(", ")}` : null, !has(env, "STRIPE_WEBHOOK_SECRET") ? "STRIPE_WEBHOOK_SECRET is not set: plans will not activate after checkout" : null].filter(Boolean);
      add("Billing (Stripe)", problems.length ? "fail" : test && prod ? "warn" : "ok", problems.length ? problems.join("; ") : test ? "test-mode key works, all six prices found (switch to live keys to take money)" : "live key works, all six prices found");
    }
  }

  const legalMissing = missing(env, "LEGAL_ENTITY_NAME", "LEGAL_ENTITY_ADDRESS", "LEGAL_CONTACT_EMAIL", "LEGAL_JURISDICTION", "LEGAL_EFFECTIVE_DATE");
  add("Legal pages", legalMissing.length ? "fail" : "ok", legalMissing.length ? `/terms and /privacy show placeholders until you set ${legalMissing.join(", ")}` : "company details set (have a lawyer read /terms and /privacy)");

  add("Error reporting", has(env, "SENTRY_DSN") ? "ok" : "warn", has(env, "SENTRY_DSN") ? "errors are sent to Sentry" : "SENTRY_DSN not set: errors only appear in the host's logs");
  if (env.DESK_DEMO === "1") add("Demo mode", has(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") ? "warn" : "fail", "DESK_DEMO=1 is set: remove it for production");
  return out;
}

const ICON: Record<Level, string> = { ok: "PASS", warn: "WARN", fail: "FAIL", off: " -- " };

export function formatReport(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.area.length));
  const lines = checks.map((c) => `${ICON[c.level]}  ${c.area.padEnd(width)}  ${c.detail}`);
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  lines.push("", fails ? `${fails} blocking, ${warns} to review. Not ready to launch.` : warns ? `Nothing blocking, ${warns} to review.` : "Ready to launch.");
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  const file = values.env ?? (existsSync("apps/web/.env.local") ? "apps/web/.env.local" : existsSync("../apps/web/.env.local") ? "../apps/web/.env.local" : null);
  const env: Env = { ...(file && existsSync(file) ? parseEnvFile(readFileSync(file, "utf8")) : {}), ...process.env };
  console.log(file ? `Reading ${file} and the process environment\n` : "Reading the process environment (no apps/web/.env.local found)\n");
  const { readdirSync } = await import("node:fs");
  const { MIGRATIONS_FOLDER } = await import("@desk/db");
  const expectedMigrations = readdirSync(MIGRATIONS_FOLDER).filter((n) => n.endsWith(".sql")).length;
  const checkDatabase = async (url: string) => {
    const pg = (await import("pg")).default;
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
    await client.connect();
    try {
      const m = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations").catch(() => ({ rows: [{ n: 0 }] }));
      const r = await client.query("select 1 from pg_roles where rolname = 'app_user'");
      const t = await client.query("select 1 from pg_extension where extname = 'pg_trgm'");
      return { migrations: m.rows[0].n as number, appRole: r.rows.length > 0, trgm: t.rows.length > 0 };
    } finally {
      await client.end();
    }
  };
  const checks = await runDoctor(env, { checkDatabase, expectedMigrations });
  console.log(formatReport(checks));
  process.exit(checks.some((c) => c.level === "fail") ? 1 : 0);
}
