/**
 * Apply pending migrations from ./drizzle to DATABASE_URL.
 *
 *   DATABASE_URL=postgres://... pnpm --filter @desk/db run migrate
 *
 * Runs as the connection's login role, which becomes the owner of every table
 * and (via migration 0001) a member of app_user. Not a tenant-scoped operation.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Absolute path of the SQL migrations folder shipped with this package. */
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log(`migrations applied from ${MIGRATIONS_FOLDER}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
