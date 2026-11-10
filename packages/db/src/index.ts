/**
 * @desk/db — Drizzle schema, migrations, RLS policies, seed.
 *
 * Rule: every query against a tenant-scoped table runs inside `withTenant`.
 * See README.md for the RLS model.
 */
export * from "./schema/index";
export { createDb, withTenant, assertTenantId, schema } from "./client";
export type { Db, Tx, DbOrTx, DeskDb, Schema, CreateDbOptions } from "./client";
export { PgCatalogIndex, withItemKeys, toCatalogItem, toAlias } from "./catalog";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate";
export { seedDemo, DEMO_TENANT_ID, DEMO_ITEMS, DEMO_CUSTOMERS } from "./seed";
export type { SeedResult } from "./seed";
export { createPgliteDb } from "./pglite";
export type { PgliteDb, PgliteContext } from "./pglite";
