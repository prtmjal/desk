/**
 * pnpm stripe:setup            (reads STRIPE_SECRET_KEY)
 *
 * Creates the price card from docs/MASTER_PLAN.md §8.2 in your Stripe account and prints the
 * env lines to paste. Safe to run again: everything is found by lookup key or event name first.
 *
 *   1 billing meter      desk_order_posted (sum of `value` per customer)
 *   3 products           Starter / Growth / Scale
 *   6 prices             per plan: flat monthly platform fee + metered per-order price whose
 *                        first tier (the included orders) is free
 *
 * Uses Stripe's REST API directly so this package needs no Stripe dependency.
 */
export type PlanSpec = { id: "starter" | "growth" | "scale"; name: string; monthlyUsd: number; includedOrders: number; overageUsd: number };

export const PLAN_SPECS: PlanSpec[] = [
  { id: "starter", name: "Starter", monthlyUsd: 299, includedOrders: 150, overageUsd: 1.5 },
  { id: "growth", name: "Growth", monthlyUsd: 799, includedOrders: 600, overageUsd: 1.0 },
  { id: "scale", name: "Scale", monthlyUsd: 1999, includedOrders: 2500, overageUsd: 0.6 },
];

type Json = Record<string, unknown>;
type Fetch = typeof fetch;

/** Stripe wants form encoding with bracketed keys: a[b][0][c]=1 */
export function formEncode(obj: Json, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" && item !== null ? out.push(...formEncode(item as Json, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") out.push(...formEncode(v as Json, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export function stripeClient(secretKey: string, f: Fetch = fetch) {
  return async function call<T = Json>(method: "GET" | "POST", path: string, params: Json = {}): Promise<T> {
    const qs = formEncode(params).join("&");
    const res = await f(`https://api.stripe.com/v1/${path}${method === "GET" && qs ? `?${qs}` : ""}`, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: method === "POST" ? qs : undefined,
    });
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe ${method} /v1/${path} failed: ${json.error?.message ?? res.status}`);
    return json;
  };
}

type List<T> = { data: T[] };
type Meter = { id: string; event_name: string; status: string };
type Product = { id: string; metadata?: Record<string, string> };
type Price = { id: string; lookup_key: string | null };

export async function setupStripe(call: ReturnType<typeof stripeClient>, eventName = "desk_order_posted", log: (s: string) => void = console.log): Promise<Record<string, string>> {
  const meters = await call<List<Meter>>("GET", "billing/meters", { limit: 100 });
  let meter = meters.data.find((m) => m.event_name === eventName && m.status === "active");
  if (meter) log(`meter    exists   ${meter.id}`);
  else {
    meter = await call<Meter>("POST", "billing/meters", {
      display_name: "DESK orders posted",
      event_name: eventName,
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    });
    log(`meter    created  ${meter.id}`);
  }

  const env: Record<string, string> = { STRIPE_METER_EVENT: eventName };
  for (const plan of PLAN_SPECS) {
    const keys = { platform: `desk_${plan.id}_platform`, overage: `desk_${plan.id}_overage` };
    const existing = await call<List<Price>>("GET", "prices", { lookup_keys: [keys.platform, keys.overage], active: true, limit: 10 });
    let platform = existing.data.find((p) => p.lookup_key === keys.platform);
    let overage = existing.data.find((p) => p.lookup_key === keys.overage);

    if (!platform || !overage) {
      const found = await call<List<Product>>("GET", "products/search", { query: `metadata['desk_plan']:'${plan.id}' AND active:'true'` }).catch(() => ({ data: [] as Product[] }));
      const product = found.data[0] ?? (await call<Product>("POST", "products", { name: `DESK ${plan.name}`, metadata: { desk_plan: plan.id } }));
      platform ??= await call<Price>("POST", "prices", {
        product: product.id,
        currency: "usd",
        unit_amount: Math.round(plan.monthlyUsd * 100),
        recurring: { interval: "month" },
        lookup_key: keys.platform,
        nickname: `${plan.name} platform fee`,
      });
      overage ??= await call<Price>("POST", "prices", {
        product: product.id,
        currency: "usd",
        recurring: { interval: "month", usage_type: "metered", meter: meter.id },
        billing_scheme: "tiered",
        tiers_mode: "graduated",
        // Included orders are free; each order after that is billed at the overage rate.
        tiers: [
          { up_to: plan.includedOrders, unit_amount: 0 },
          { up_to: "inf", unit_amount_decimal: String(Math.round(plan.overageUsd * 100)) },
        ],
        lookup_key: keys.overage,
        nickname: `${plan.name} orders (first ${plan.includedOrders} included)`,
      });
      log(`${plan.id.padEnd(8)} created  ${platform.id}  ${overage.id}`);
    } else log(`${plan.id.padEnd(8)} exists   ${platform.id}  ${overage.id}`);

    env[`STRIPE_PRICE_${plan.id.toUpperCase()}`] = platform.id;
    env[`STRIPE_PRICE_${plan.id.toUpperCase()}_OVERAGE`] = overage.id;
  }
  return env;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Set STRIPE_SECRET_KEY (use a test-mode key first: sk_test_...).");
    process.exit(1);
  }
  console.log(`Stripe ${key.startsWith("sk_live") ? "LIVE" : "test"} mode\n`);
  setupStripe(stripeClient(key), process.env.STRIPE_METER_EVENT || "desk_order_posted")
    .then((env) => {
      console.log("\nAdd these to your environment:\n");
      for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
      console.log("\nThen add a webhook endpoint in Stripe to <APP_URL>/api/webhooks/stripe (see docs/runbooks/LAUNCH.md).");
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
