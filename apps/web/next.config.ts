import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source; let Next compile them.
  transpilePackages: ["@desk/core", "@desk/db"],
  typedRoutes: false,
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
