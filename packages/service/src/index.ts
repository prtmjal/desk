/**
 * @desk/service — the application layer between the web app / job runner and the
 * domain packages. Every function takes explicit deps (db, blobs, llm, mailer,
 * connectors) and a tenant id, runs its queries through `withTenant`, and writes
 * the audit log. Nothing here reads process.env or imports Next.js.
 */
export * from "./audit.js";
export * from "./blobs.js";
export * from "./catalog-sync.js";
export * from "./connectors.js";
export * from "./context.js";
export * from "./intake.js";
export * from "./integrations.js";
export * from "./learn.js";
export * from "./mailer.js";
export * from "./metrics.js";
export * from "./notify.js";
export * from "./orders.js";
export * from "./scope.js";
export * from "./secrets.js";
export * from "./tenants.js";
export * from "./validation.js";
