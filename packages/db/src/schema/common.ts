/**
 * Shared column helpers for the DESK schema.
 *
 * Conventions (plan §6.7 / §7.1):
 *  - uuid primary keys with gen_random_uuid()
 *  - created_at / updated_at are timestamptz
 *  - every tenant-scoped table has `tenant_id` (see tenants.ts for the helper)
 */
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/**
 * pgvector `vector(N)` column. pgvector is optional at the database level:
 * migration 0001 creates the extension inside a DO block that ignores failure,
 * and the test harness installs a text-backed shim type so the schema still
 * migrates where pgvector is unavailable (PGlite 0.5.x). See test/pglite.ts.
 */
export const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
    dataType(config) {
      return `vector(${config?.dimensions ?? dimensions})`;
    },
    toDriver(value) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value) {
      if (Array.isArray(value)) return value as unknown as number[];
      const s = String(value).trim();
      if (!s.startsWith("[")) return [];
      return s
        .slice(1, -1)
        .split(",")
        .filter((x) => x.length > 0)
        .map(Number);
    },
  })(name, { dimensions });
