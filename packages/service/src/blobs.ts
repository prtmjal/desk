/**
 * Object storage for raw emails and documents (plan §7.1). Keys are tenant-prefixed
 * (`t/<tenantId>/...`) and derived from content hashes, so writes are idempotent.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { AwsClient } from "aws4fetch";

export type Blob = { bytes: Uint8Array; contentType: string | null };

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType?: string | null): Promise<void>;
  get(key: string): Promise<Blob | null>;
}

export class MemoryBlobStore implements BlobStore {
  private data = new Map<string, Blob>();
  async put(key: string, bytes: Uint8Array, contentType: string | null = null) {
    this.data.set(key, { bytes, contentType });
  }
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  size() {
    return this.data.size;
  }
}

/** Local-disk store for development and demo mode. */
export class FsBlobStore implements BlobStore {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    const p = resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error("FsBlobStore: key escapes the root");
    return p;
  }
  async put(key: string, bytes: Uint8Array, contentType: string | null = null) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    await writeFile(`${p}.meta`, JSON.stringify({ contentType }));
  }
  async get(key: string) {
    const p = this.path(key);
    try {
      const bytes = new Uint8Array(await readFile(p));
      let contentType: string | null = null;
      try {
        contentType = (JSON.parse(await readFile(`${p}.meta`, "utf8")) as { contentType: string | null }).contentType;
      } catch {
        /* no metadata */
      }
      return { bytes, contentType };
    } catch {
      return null;
    }
  }
}

/** S3-compatible store (Cloudflare R2, AWS S3, MinIO) using SigV4-signed fetch. */
export class S3BlobStore implements BlobStore {
  private client: AwsClient;
  private base: string;
  constructor(opts: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string }) {
    this.client = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, service: "s3", region: opts.region ?? "auto" });
    this.base = `${opts.endpoint.replace(/\/$/, "")}/${opts.bucket}`;
  }
  private url(key: string) {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, bytes: Uint8Array, contentType: string | null = null) {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: bytes as unknown as BodyInit,
      headers: contentType ? { "content-type": contentType } : {},
    });
    if (!res.ok) throw new Error(`S3 put ${key} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 get ${key} failed: ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  }
}

export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^\w.\-() ]+/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}

export const joinKey = (...parts: string[]) => join(...parts).split(sep).join("/");
