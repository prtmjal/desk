import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `generate` only reads the schema, so the DATABASE_URL
 * fallback lets it run offline; `migrate`/`studio` need a real URL.
 *
 * Never use `drizzle-kit push` against a DESK database: migration 0001 holds
 * hand-written objects (extensions, trigram indexes, role, RLS policies) that
 * push would try to drop. Use `pnpm --filter @desk/db run migrate`.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/desk",
  },
  strict: true,
  verbose: true,
});
