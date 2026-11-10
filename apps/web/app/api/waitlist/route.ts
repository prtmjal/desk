import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isWorkEmail, waitlistSchema } from "@/lib/waitlist-schema";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1024;

/**
 * Light rate limit: a per-IP sliding window held in process memory.
 * Good enough for a pre-launch form on a single instance; replace with a
 * shared store (Upstash/Redis) when there is more than one server.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10_000) {
    // Crude memory guard: drop the oldest entries.
    for (const key of Array.from(hits.keys()).slice(0, 5_000)) hits.delete(key);
  }
  return recent.length > MAX_PER_WINDOW;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request): Promise<Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json({ ok: false, error: "Expected application/json" }, 415);
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Payload too large" }, 413);
  }

  if (rateLimited(clientIp(req))) {
    return json({ ok: false, error: "Too many requests. Try again in a few minutes." }, 429);
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "Payload too large" }, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Body must be valid JSON" }, 400);
  }

  const result = waitlistSchema.safeParse(parsedBody);
  if (!result.success) {
    // Honeypot hits get a 200 so bots do not learn anything; nothing is stored.
    const honeypot = result.error.issues.some((i) => i.path[0] === "website");
    if (honeypot) return json({ ok: true });

    const first = result.error.issues[0];
    return json({ ok: false, error: first?.message ?? "Invalid submission" }, 400);
  }

  const { website: _honeypot, ...entry } = result.data;
  const record = {
    ...entry,
    workEmail: isWorkEmail(entry.email),
    source: "web",
    receivedAt: new Date().toISOString(),
    userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  };

  try {
    await store(record);
  } catch (err) {
    console.error("[waitlist] store failed", err instanceof Error ? err.message : err);
    return json({ ok: false, error: "Could not save your request. Please try again." }, 500);
  }

  return json({ ok: true });
}

async function store(record: Record<string, unknown>): Promise<void> {
  const webhook = process.env.WAITLIST_WEBHOOK_URL;
  if (webhook) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
    return;
  }

  // Local fallback: one JSON object per line. Directory is git-ignored.
  const dir = path.join(process.cwd(), ".data");
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "waitlist.jsonl"), JSON.stringify(record) + "\n", "utf8");
}
