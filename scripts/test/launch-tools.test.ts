import { describe, expect, it } from "vitest";
import { formatReport, parseEnvFile, runDoctor } from "../src/doctor";
import { formEncode, PLAN_SPECS, setupStripe, stripeClient } from "../src/stripe-setup";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("doctor", () => {
  it("parses env files with quotes and trailing comments", () => {
    expect(parseEnvFile('A=1\nB="two words"\nC=x   # note\n# D=4\nexport E=5')).toEqual({ A: "1", B: "two words", C: "x", E: "5" });
  });

  it("fails an empty environment on the required services and never claims readiness", async () => {
    const checks = await runDoctor({}, { fetch: (async () => json({}, 500)) as typeof fetch });
    const failed = checks.filter((c) => c.level === "fail").map((c) => c.area);
    expect(failed).toEqual(expect.arrayContaining(["App URL", "Database", "Sign-in (Clerk)", "Secrets key", "Extraction (Anthropic)", "Legal pages"]));
    expect(formatReport(checks)).toMatch(/Not ready to launch/);
  });

  it("passes a complete environment and prints no secret", async () => {
    const env = {
      APP_URL: "https://app.desk.example", DATABASE_URL: "postgres://u:hunter2@h/db", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_x", CLERK_SECRET_KEY: "sk_live_clerksecret",
      DESK_SECRETS_KEY: "k".repeat(48), ANTHROPIC_API_KEY: "sk-ant-secret", POSTMARK_SERVER_TOKEN: "pm-secret", POSTMARK_INBOUND_SECRET: "s", POSTMARK_FROM: "orders@desk.example", INBOUND_DOMAIN: "orders.desk.example",
      INNGEST_EVENT_KEY: "e", INNGEST_SIGNING_KEY: "s", S3_ENDPOINT: "https://r2", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b", QBO_CLIENT_ID: "q", QBO_CLIENT_SECRET: "q", QBO_ENVIRONMENT: "production",
      STRIPE_SECRET_KEY: "sk_live_stripesecret", STRIPE_WEBHOOK_SECRET: "whsec", STRIPE_PRICE_STARTER: "p1", STRIPE_PRICE_STARTER_OVERAGE: "p2", STRIPE_PRICE_GROWTH: "p3", STRIPE_PRICE_GROWTH_OVERAGE: "p4", STRIPE_PRICE_SCALE: "p5", STRIPE_PRICE_SCALE_OVERAGE: "p6",
      LEGAL_ENTITY_NAME: "Desk Inc", LEGAL_ENTITY_ADDRESS: "1 St", LEGAL_CONTACT_EMAIL: "legal@desk.example", LEGAL_JURISDICTION: "Delaware", LEGAL_EFFECTIVE_DATE: "2026-12-01", SENTRY_DSN: "https://k@o1.ingest.sentry.io/2",
    };
    const fetchFake = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("anthropic")) return json({ data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }] });
      if (u.includes("postmark")) return json({ InboundHookUrl: "https://postmark:s@app.desk.example/api/webhooks/postmark", InboundDomain: "orders.desk.example" });
      if (u.includes("stripe")) return json({ data: ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ id })) });
      return json({ data: [] });
    }) as typeof fetch;
    const checks = await runDoctor(env, { fetch: fetchFake, checkDatabase: async () => ({ migrations: 3, appRole: true, trgm: true }), expectedMigrations: 3 });
    expect(checks.filter((c) => c.level !== "ok")).toEqual([]);
    const report = formatReport(checks);
    expect(report).toMatch(/Ready to launch\.$/);
    expect(report).not.toMatch(/hunter2|clerksecret|sk-ant-secret|stripesecret|pm-secret/);
  });

  it("catches unapplied migrations, an unknown model id and missing Stripe prices", async () => {
    const fetchFake = (async (url: RequestInfo | URL) => (String(url).includes("anthropic") ? json({ data: [{ id: "claude-sonnet-5-5" }] }) : json({ data: [] }))) as typeof fetch;
    const checks = await runDoctor({ DATABASE_URL: "x", ANTHROPIC_API_KEY: "k", STRIPE_SECRET_KEY: "sk_test_1" }, { fetch: fetchFake, checkDatabase: async () => ({ migrations: 2, appRole: true, trgm: true }), expectedMigrations: 3 });
    const by = Object.fromEntries(checks.map((c) => [c.area, c]));
    expect(by.Database!.detail).toMatch(/2 of 3 migrations/);
    expect(by["Extraction (Anthropic)"]!.detail).toMatch(/model id not available/);
    expect(by["Billing (Stripe)"]!).toMatchObject({ level: "fail" });
  });
});

describe("stripe setup", () => {
  it("encodes nested params the way Stripe expects", () => {
    expect(formEncode({ recurring: { interval: "month" }, tiers: [{ up_to: 150, unit_amount: 0 }, { up_to: "inf" }], lookup_keys: ["a", "b"] }).map(decodeURIComponent)).toEqual([
      "recurring[interval]=month", "tiers[0][up_to]=150", "tiers[0][unit_amount]=0", "tiers[1][up_to]=inf", "lookup_keys[0]=a", "lookup_keys[1]=b",
    ]);
  });

  it("creates the meter and six prices once, and creates nothing on a second run", async () => {
    const store = { meters: [] as Array<{ id: string; event_name: string; status: string }>, prices: [] as Array<{ id: string; lookup_key: string; body: string }>, products: 0, posts: 0 };
    const f = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const body = decodeURIComponent(String(init.body ?? ""));
      if (init.method === "POST") store.posts++;
      if (u.pathname === "/v1/billing/meters") {
        if (init.method === "POST") { const m = { id: "mtr_1", event_name: "desk_order_posted", status: "active" }; store.meters.push(m); return json(m); }
        return json({ data: store.meters });
      }
      if (u.pathname === "/v1/products/search") return json({ data: [] });
      if (u.pathname === "/v1/products") return json({ id: `prod_${++store.products}` });
      if (u.pathname === "/v1/prices") {
        if (init.method === "POST") { const p = { id: `price_${store.prices.length + 1}`, lookup_key: body.match(/lookup_key=([^&]+)/)![1]!, body }; store.prices.push(p); return json(p); }
        const keys = [...u.searchParams.entries()].filter(([k]) => k.startsWith("lookup_keys")).map(([, v]) => v);
        return json({ data: store.prices.filter((p) => keys.includes(p.lookup_key)) });
      }
      return json({ error: { message: "unrouted" } }, 404);
    }) as typeof fetch;
    const call = stripeClient("sk_test_x", f);
    const env = await setupStripe(call, "desk_order_posted", () => undefined);
    expect(Object.keys(env)).toHaveLength(7);
    expect(store.prices).toHaveLength(6);
    const starterOverage = store.prices.find((p) => p.lookup_key === "desk_starter_overage")!.body;
    expect(starterOverage).toContain("recurring[usage_type]=metered");
    expect(starterOverage).toContain("recurring[meter]=mtr_1");
    expect(starterOverage).toContain("tiers[0][up_to]=150&tiers[0][unit_amount]=0");
    expect(starterOverage).toContain("tiers[1][up_to]=inf&tiers[1][unit_amount_decimal]=150");
    expect(store.prices.find((p) => p.lookup_key === "desk_scale_platform")!.body).toContain("unit_amount=199900");
    expect(PLAN_SPECS.map((p) => p.includedOrders)).toEqual([150, 600, 2500]);

    const postsAfterFirst = store.posts;
    const again = await setupStripe(call, "desk_order_posted", () => undefined);
    expect(store.posts).toBe(postsAfterFirst);
    expect(again).toEqual(env);
  });
});
