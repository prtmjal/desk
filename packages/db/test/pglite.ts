/** Test harness: see src/pglite.ts. Kept as a thin alias so existing tests keep their imports. */
import { createPgliteDb, type PgliteContext, type PgliteDb } from "../src/pglite";

export type TestDb = PgliteDb;
export type TestContext = PgliteContext;

export async function createTestDb(): Promise<TestContext> {
  return createPgliteDb();
}
