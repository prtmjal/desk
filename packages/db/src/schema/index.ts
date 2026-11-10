/**
 * DESK Drizzle schema (plan §6.7). One file per aggregate; this barrel is what
 * drizzle-kit and `createDb` consume.
 *
 * Tenant isolation is enforced by Postgres RLS (migration 0001), not by these
 * definitions: every tenant-scoped table carries `tenant_id` and must be
 * queried through `withTenant` (src/client.ts).
 */
export * from "./common.js";
export * from "./tenants.js";
export * from "./users.js";
export * from "./integrations.js";
export * from "./items.js";
export * from "./pricing.js";
export * from "./customers.js";
export * from "./inbound.js";
export * from "./orders.js";
export * from "./aliases.js";
export * from "./rules.js";
export * from "./events.js";
export * from "./billing.js";
export * from "./waitlist.js";
