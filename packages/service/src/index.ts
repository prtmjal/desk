/**
 * @desk/service — the application layer between the web app / job runner and the
 * domain packages. Every function takes explicit deps (db, blobs, llm, mailer,
 * connectors) and a tenant id, runs its queries through `withTenant`, and writes
 * the audit log. Nothing here reads process.env or imports Next.js.
 */
export * from "./audit";
export * from "./blobs";
export * from "./catalog-sync";
export * from "./connectors";
export * from "./context";
export * from "./intake";
export * from "./integrations";
export * from "./learn";
export * from "./mailer";
export * from "./metrics";
export * from "./notify";
export * from "./orders";
export * from "./scope";
export * from "./secrets";
export * from "./tenants";
export * from "./validation";
export * from "./queries";
export * from "./entitlements";
