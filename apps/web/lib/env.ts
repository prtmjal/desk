/**
 * Runtime feature gates. Everything in Phase 0 must build and run with no
 * secrets configured, so each integration is switched on only by the presence
 * of its environment variable. Keep this file free of imports so it can be used
 * from the proxy and from server components alike.
 */

/** Clerk is on when the publishable key is present (the secret key is also needed server-side). */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function appUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

/** Env vars the `/app` shell needs; shown in the "not configured" notice. */
export const CLERK_ENV_VARS = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
] as const;
