/**
 * Runtime feature gates. The app must build and run with no secrets configured,
 * so each integration is switched on only by the presence of its environment
 * variable. Keep this file free of imports so it can be used from the proxy and
 * from server components alike. Nothing else reads `process.env` for these.
 */

/** Clerk is on when the publishable key is present (the secret key is also needed server-side). */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * Demo mode: no sign-in, one demo tenant, in-process database, offline demo extractor.
 * Explicit opt-in (DESK_DEMO=1) and only when Clerk is not configured, so a real
 * deployment can never fall into an unauthenticated app by accident.
 */
export function isDemoMode(): boolean {
  return process.env.DESK_DEMO === "1" && !isClerkConfigured();
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function isPostmarkConfigured(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN);
}

export function isQuickBooksConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET);
}

/** Inngest runs the pipeline durably when its keys are set (or its dev server is running). */
export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV);
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export function inboundDomain(): string {
  return process.env.INBOUND_DOMAIN || "orders.example.com";
}

/** Env vars the `/app` shell needs; shown in the "not configured" notice. */
export const CLERK_ENV_VARS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
] as const;
