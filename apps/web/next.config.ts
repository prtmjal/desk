import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source; let Next compile them.
  transpilePackages: ["@desk/core", "@desk/db", "@desk/erp", "@desk/extract", "@desk/service"],
  // Native / WASM / fs-heavy packages stay as plain Node requires.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "mammoth", "unpdf", "@anthropic-ai/sdk"],
  // Files read at runtime by path (not imported): versioned prompts and SQL migrations.
  outputFileTracingIncludes: {
    "/**": ["../../packages/extract/src/prompts/*.md", "../../packages/db/drizzle/**/*"],
  },
  typedRoutes: false,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
