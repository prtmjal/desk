/**
 * DESK Drizzle schema (plan §6.7). One file per aggregate; this barrel is what
 * drizzle-kit and `createDb` consume.
 *
 * Tenant isolation is enforced by Postgres RLS (migration 0001), not by these
 * definitions: every tenant-scoped table carries `tenant_id` and must be
 * queried through `withTenant` (src/client.ts).
 */
export * from "./common";
export * from "./tenants";
export * from "./users";
export * from "./integrations";
export * from "./items";
export * from "./pricing";
export * from "./customers";
export * from "./inbound";
export * from "./orders";
export * from "./aliases";
export * from "./rules";
export * from "./events";
export * from "./billing";
export * from "./waitlist";
