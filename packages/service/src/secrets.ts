/**
 * Credential vault (plan §6.4 "secrets in a vault"). OAuth tokens and API keys are
 * sealed with AES-256-GCM under DESK_SECRETS_KEY and stored in the tenant-scoped
 * `secrets` table; `integrations.credentials_ref` holds only the reference.
 * See docs/DECISIONS.md D-004 for why this is a table and not an external vault yet.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { secrets, type Tx } from "@desk/db";
import { and, eq } from "drizzle-orm";

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function open(sealed: string, secret: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("secrets: unrecognized ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function requireSecretsKey(key: string | null | undefined): string {
  if (!key || key.length < 16) throw new Error("DESK_SECRETS_KEY is not set (need at least 16 characters) — required to store ERP credentials");
  return key;
}

export async function putSecret(tx: Tx, tenantId: string, ref: string, value: unknown, key: string): Promise<void> {
  const ciphertext = seal(JSON.stringify(value), key);
  await tx
    .insert(secrets)
    .values({ tenantId, ref, ciphertext })
    .onConflictDoUpdate({ target: [secrets.tenantId, secrets.ref], set: { ciphertext, updatedAt: new Date() } });
}

export async function getSecret<T>(tx: Tx, tenantId: string, ref: string, key: string): Promise<T | null> {
  const [row] = await tx.select().from(secrets).where(and(eq(secrets.tenantId, tenantId), eq(secrets.ref, ref)));
  return row ? (JSON.parse(open(row.ciphertext, key)) as T) : null;
}

export async function deleteSecret(tx: Tx, tenantId: string, ref: string): Promise<void> {
  await tx.delete(secrets).where(and(eq(secrets.tenantId, tenantId), eq(secrets.ref, ref)));
}
