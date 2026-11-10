import type { Db, integrations } from "@desk/db";
import type { ErpConnector } from "@desk/erp";
import type { LlmClient } from "@desk/extract";
import type { BlobStore } from "./blobs";
import type { Mailer } from "./mailer";

export type IntegrationRow = typeof integrations.$inferSelect;

/** Reports billable usage to the billing provider (Stripe meter). Optional. */
export interface UsageReporter {
  orderPosted(input: { tenantId: string; orderId: string; touchless: boolean; at: Date }): Promise<void>;
}

/**
 * Everything the application layer needs from the outside world. The web app builds
 * one of these from env; tests build one from PGlite + fakes. No function in this
 * package reads process.env.
 */
export type ServiceDeps = {
  db: Db;
  blobs: BlobStore;
  /** null = no model configured; inbound messages are stored and marked failed with a clear reason. */
  llm: LlmClient | null;
  mailer: Mailer;
  /** Build a live connector for a tenant's integration row, or null when it cannot post. */
  connectorFor(tenantId: string, integration: IntegrationRow): Promise<ErpConnector | null>;
  usage?: UsageReporter | null;
  now?: () => Date;
  appUrl: string;
  /** Domain of per-tenant intake addresses, e.g. orders.example.com */
  inboundDomain: string;
  secretsKey: string | null;
};

export const nowOf = (deps: Pick<ServiceDeps, "now">): Date => (deps.now ? deps.now() : new Date());

/** An error whose message is safe and useful to show to the user. */
export class ServiceError extends Error {
  constructor(
    public readonly code: "not_found" | "blocked" | "conflict" | "invalid" | "not_configured" | "erp",
    message: string,
    public readonly details: unknown = null,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

/** Walk an error's cause chain (Drizzle wraps the Postgres error). */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err; e instanceof Error; e = e.cause) parts.push(e.message);
  return parts.length ? parts.join(" | ") : String(err);
}
