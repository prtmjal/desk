/**
 * In-process Postgres (PGlite) with the real migrations applied. Used by the test
 * harness and by the web app's demo mode (no DATABASE_URL), never in production.
 *
 * PGlite 0.5.x bundles pg_trgm but not pgvector, so a text-backed shim type named
 * `vector` is installed first; migration 0001 then skips the extension and HNSW index.
 * PGlite's only user is a superuser (bypasses RLS), but `withTenant` drops to
 * app_user, so everything that goes through it exercises the real policies.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "./migrate.js";
import * as schema from "./schema/index.js";

export type PgliteDb = PgliteDatabase<typeof schema>;

async function installVectorShim(client: PGlite): Promise<boolean> {
  try {
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector");
    return true;
  } catch {
    const exists = await client.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
    if (exists.rows.length > 0) return false;
    await client.exec(`
      CREATE TYPE vector;
      CREATE FUNCTION vector_in(cstring) RETURNS vector LANGUAGE internal IMMUTABLE STRICT AS 'textin';
      CREATE FUNCTION vector_out(vector) RETURNS cstring LANGUAGE internal IMMUTABLE STRICT AS 'textout';
      CREATE TYPE vector (
        INPUT = vector_in, OUTPUT = vector_out,
        TYPMOD_IN = varchartypmodin, TYPMOD_OUT = varchartypmodout,
        INTERNALLENGTH = VARIABLE, STORAGE = extended, CATEGORY = 'U'
      );
    `);
    return false;
  }
}

export type PgliteContext = { db: PgliteDb; client: PGlite; hasPgvector: boolean; close(): Promise<void> };

/** `dataDir` undefined = in-memory; a path persists across restarts (demo mode). */
export async function createPgliteDb(dataDir?: string): Promise<PgliteContext> {
  const client = new PGlite({ dataDir, extensions: { pg_trgm } });
  await client.waitReady;
  const hasPgvector = await installVectorShim(client);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, hasPgvector, close: () => client.close() };
}
