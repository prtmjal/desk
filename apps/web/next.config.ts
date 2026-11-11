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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The review screen frames its own PDF route; nothing else may frame the app.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
  typedRoutes: false,
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
