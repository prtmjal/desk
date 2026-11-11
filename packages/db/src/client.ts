/**
 * Database client and the tenant-scoping rule.
 *
 * Every query against a tenant-scoped table goes through `withTenant`. It opens
 * a transaction, drops privileges to the `app_user` role (NOBYPASSRLS) and sets
 * `app.tenant_id` for the transaction; the RLS policies installed by migration
 * 0001 then filter every read and reject every write for another tenant.
 */
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema/index";

export type Schema = typeof schema;

/** Any Drizzle Postgres database over our schema (node-postgres in prod, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

/** A tenant-scoped transaction handle, as passed to the `withTenant` callback. */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/** Either works for read/write code: a tenant tx, or (in tests/seeds) the raw db. */
export type DbOrTx = Db | Tx;

export type DeskDb = NodePgDatabase<Schema> & { $client: pg.Pool };

export type CreateDbOptions = {
  /** Pool size; serverless hosts (Neon) want this small. Default 10. */
  max?: number;
  /** Log SQL statements. */
  logger?: boolean;
};

/** Create a pooled node-postgres Drizzle client. Close it with `db.$client.end()`. */
export function createDb(connectionString: string, options: CreateDbOptions = {}): DeskDb {
  if (!connectionString) throw new Error("createDb: connectionString is required (DATABASE_URL)");
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return drizzle({ client: pool, schema, logger: options.logger ?? false });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertTenantId(tenantId: string): void {
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    throw new Error("withTenant: tenantId must be a UUID");
  }
}

/**
 * Run `fn` inside a transaction scoped to one tenant.
 *
 *   SET LOCAL ROLE app_user;                       -- drop to the RLS-bound role
 *   SELECT set_config('app.tenant_id', $1, true);  -- parameterized, transaction-local
 *
 * Both settings end with the transaction, so a pooled connection never leaks a
 * tenant context. The role switch requires the login role to be a member of
 * app_user, which migration 0001 grants to the role that runs it.
 */
export async function withTenant<R>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
  assertTenantId(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_user`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export { schema };
