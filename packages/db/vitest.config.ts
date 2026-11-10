import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // PGlite boots a WASM Postgres per file (~2-3 s) and runs the migrations.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
