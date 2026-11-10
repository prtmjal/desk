/**
 * @desk/db — Drizzle schema, migrations, RLS policies, seed.
 *
 * Rule: every query against a tenant-scoped table runs inside `withTenant`.
 * See README.md for the RLS model.
 */
export * from "./schema/index.js";
export { createDb, withTenant, assertTenantId, schema } from "./client.js";
export type { Db, Tx, DbOrTx, DeskDb, Schema, CreateDbOptions } from "./client.js";
export { PgCatalogIndex, withItemKeys, toCatalogItem, toAlias } from "./catalog.js";
export { MIGRATIONS_FOLDER, runMigrations } from "./migrate.js";
export { seedDemo, DEMO_TENANT_ID, DEMO_ITEMS, DEMO_CUSTOMERS } from "./seed.js";
export type { SeedResult } from "./seed.js";
