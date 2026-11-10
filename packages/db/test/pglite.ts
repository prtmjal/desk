/**
 * Test harness: an in-process Postgres (PGlite) with the real migrations applied.
 *
 * PGlite 0.5.15 bundles pg_trgm (contrib) but not pgvector, so before migrating
 * we install a text-backed shim type named `vector` that accepts a typmod. This
 * lets `items.embedding vector(1024)` migrate; migration 0001 then skips the
 * extension and the HNSW index (its DO blocks tolerate a missing pgvector).
 *
 * PGlite's only user is a superuser, which BYPASSES RLS. `withTenant` does
 * SET LOCAL ROLE app_user, so tests that go through it exercise the real policies.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { MIGRATIONS_FOLDER } from "../src/migrate.js";
import * as schema from "../src/schema/index.js";

export type TestDb = PgliteDatabase<typeof schema>;

export type TestContext = {
  db: TestDb;
  client: PGlite;
  /** Whether a real pgvector extension was available (false under PGlite 0.5.x). */
  hasPgvector: boolean;
  close(): Promise<void>;
};

async function installVectorShim(client: PGlite): Promise<boolean> {
  try {
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector");
    return true;
  } catch {
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

export async function createTestDb(): Promise<TestContext> {
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.waitReady;
  const hasPgvector = await installVectorShim(client);
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    client,
    hasPgvector,
    close: () => client.close(),
  };
}
