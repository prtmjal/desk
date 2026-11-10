import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createDb, createPgliteDb, DEMO_CUSTOMERS, DEMO_ITEMS, type Db } from "@desk/db";
import { AnthropicLlm, HeuristicLlm, type LlmClient } from "@desk/extract";
import {
  ConsoleMailer,
  FsBlobStore,
  makeConnectorFactory,
  MemoryMailer,
  PostmarkMailer,
  S3BlobStore,
  type BlobStore,
  type Mailer,
  type ServiceDeps,
} from "@desk/service";
import { appUrl, inboundDomain, isAnthropicConfigured, isDatabaseConfigured, isDemoMode, isPostmarkConfigured, isQuickBooksConfigured } from "@/lib/env";
import { stripeUsageReporter } from "./billing";

/**
 * Builds the ServiceDeps for this process from the environment, once.
 * Held on globalThis so Next's dev-mode module reloads reuse the same pool / PGlite.
 */
type Held = { deps: Promise<ServiceDeps> };
const g = globalThis as unknown as { __deskDeps?: Held };

// Repo root relative to the app's working directory (apps/web) in dev, start and on Vercel.
const repoPath = (...p: string[]) => path.join(/* turbopackIgnore: true */ process.cwd(), "..", "..", ...p);

export class NotConfiguredError extends Error {}

async function build(): Promise<ServiceDeps> {
  process.env.DESK_PROMPTS_DIR ||= repoPath("packages", "extract", "src", "prompts");

  let db: Db;
  if (isDatabaseConfigured()) {
    db = createDb(process.env.DATABASE_URL as string, { max: Number(process.env.DATABASE_POOL_MAX ?? 5) }) as unknown as Db;
  } else if (isDemoMode()) {
    const dataDir = process.env.DESK_DEMO_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".pglite", "desk");
    if (dataDir !== ":memory:") mkdirSync(path.dirname(dataDir), { recursive: true });
    const pg = await createPgliteDb(dataDir === ":memory:" ? undefined : dataDir, repoPath("packages", "db", "drizzle"));
    db = pg.db as unknown as Db;
  } else {
    throw new NotConfiguredError("DATABASE_URL is not set");
  }

  const blobs: BlobStore =
    process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? new S3BlobStore({ endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET || "desk-documents", accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, region: process.env.S3_REGION })
      : new FsBlobStore(process.env.BLOB_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "blobs"));

  const llm: LlmClient | null = isAnthropicConfigured() ? new AnthropicLlm() : isDemoMode() ? new HeuristicLlm() : null;

  const mailer: Mailer = isPostmarkConfigured()
    ? new PostmarkMailer({ serverToken: process.env.POSTMARK_SERVER_TOKEN as string, from: process.env.POSTMARK_FROM || `orders@${inboundDomain()}`, messageStream: process.env.POSTMARK_STREAM })
    : isDemoMode()
      ? demoMailer()
      : new ConsoleMailer();

  const secretsKey = process.env.DESK_SECRETS_KEY || (isDemoMode() ? "demo-mode-secrets-key-not-for-production" : null);

  return {
    db,
    blobs,
    llm,
    mailer,
    connectorFor: makeConnectorFactory({
      db,
      secretsKey,
      quickbooks: isQuickBooksConfigured()
        ? { clientId: process.env.QBO_CLIENT_ID as string, clientSecret: process.env.QBO_CLIENT_SECRET as string, environment: process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox" }
        : null,
      demo: {
        items: DEMO_ITEMS.map((it) => ({
          id: `ERP-${it.sku}`,
          sku: it.sku,
          upc: it.upc ?? null,
          mpn: it.mpn ?? null,
          description: it.description,
          extra: it.extra ?? null,
          active: true,
          pack: { baseUom: it.uom ?? "EA", ...(it.factors ? { factors: it.factors } : {}), ...(it.multipleOf ? { multipleOf: it.multipleOf } : {}) },
          listPrice: Number(it.listPrice),
        })),
        customers: DEMO_CUSTOMERS.map((c) => ({ id: c.erpId, name: c.name, domains: [...c.domains], accountNumber: c.accountNumber, aka: [...c.aka], active: true })),
        stock: { "ERP-BRK-2P-30-QO": 4 },
      },
    }),
    usage: stripeUsageReporter(db),
    appUrl: appUrl(),
    inboundDomain: inboundDomain(),
    secretsKey,
  };
}

/** Demo mode keeps sent mail in memory so the UI can say "sent" without a provider. */
function demoMailer(): MemoryMailer {
  return new MemoryMailer();
}

export function getDeps(): Promise<ServiceDeps> {
  if (!g.__deskDeps) {
    const held: Held = { deps: build() };
    // A failed build (bad DATABASE_URL) must not be cached forever.
    held.deps.catch(() => {
      if (g.__deskDeps === held) g.__deskDeps = undefined;
    });
    g.__deskDeps = held;
  }
  return g.__deskDeps.deps;
}
