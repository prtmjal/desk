import { randomUUID } from "node:crypto";
import { memberships, tenantRoutes, tenantSettings, tenants, users, withTenant, type Db, type TenantSettings } from "@desk/db";
import { and, eq } from "drizzle-orm";
import { logEvent, SYSTEM, type Actor } from "./audit";
import { ServiceError, type ServiceDeps } from "./context";

export type RouteKind = "auth_org" | "inbound_slug" | "stripe_customer" | "qbo_realm";

/** Defaults for a new tenant: shadow mode on, auto-post off (plan §6.3, §6.6). */
export const DEFAULT_SETTINGS: Required<Pick<TenantSettings, "autoPost" | "shadowMode" | "autoPostThreshold" | "priceTolerancePct" | "holdOnStockShort" | "ackEnabled" | "ackAutoSend" | "ackSubject" | "ackBody" | "minutesPerOrder">> = {
  autoPost: false,
  shadowMode: true,
  autoPostThreshold: 0.98,
  priceTolerancePct: 2,
  holdOnStockShort: false,
  ackEnabled: true,
  ackAutoSend: false,
  ackSubject: "Order received: PO {{poNumber}}",
  ackBody:
    "Hi {{contactName}},\n\nThank you for your order. We have entered PO {{poNumber}} as our order {{orderNumber}}.\n\n{{lines}}\n\nRequested ship date: {{requestedShipDate}}\n\nIf anything above looks wrong, reply to this email and we will fix it.\n\n{{companyName}}",
  minutesPerOrder: 8,
};

export function effectiveSettings(s: TenantSettings | null | undefined): TenantSettings & typeof DEFAULT_SETTINGS {
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  return s || "tenant";
}

/** tenant_routes has no RLS: it is read before a tenant context exists. */
export async function resolveRoute(db: Db, kind: RouteKind, key: string): Promise<string | null> {
  const [row] = await db
    .select({ tenantId: tenantRoutes.tenantId })
    .from(tenantRoutes)
    .where(and(eq(tenantRoutes.kind, kind), eq(tenantRoutes.key, key)));
  return row?.tenantId ?? null;
}

export async function setRoute(db: Db, tenantId: string, kind: RouteKind, key: string): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await tx.delete(tenantRoutes).where(and(eq(tenantRoutes.kind, kind), eq(tenantRoutes.tenantId, tenantId)));
    await tx.insert(tenantRoutes).values({ kind, key, tenantId }).onConflictDoUpdate({ target: [tenantRoutes.kind, tenantRoutes.key], set: { tenantId } });
  });
}

/**
 * Find the tenant behind an external key, creating it on first sight (a new auth
 * organization). Safe to call on every request: the common path is one indexed read.
 */
export async function ensureTenant(
  db: Db,
  input: { kind: RouteKind; key: string; name: string; id?: string },
): Promise<{ tenantId: string; created: boolean }> {
  const existing = await resolveRoute(db, input.kind, input.key);
  if (existing) return { tenantId: existing, created: false };

  const tenantId = input.id ?? randomUUID();
  const slug = `${slugify(input.name)}-${tenantId.replace(/-/g, "").slice(-6)}`;
  try {
    await withTenant(db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: input.name, slug, plan: "trial" }).onConflictDoNothing();
      await tx.insert(tenantSettings).values({ tenantId, settings: { ...DEFAULT_SETTINGS } }).onConflictDoNothing();
      await tx.insert(tenantRoutes).values({ kind: input.kind, key: input.key, tenantId });
      const [t] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
      await tx.insert(tenantRoutes).values({ kind: "inbound_slug", key: t!.slug, tenantId }).onConflictDoNothing();
      await logEvent(tx, { tenantId, actor: SYSTEM, action: "created", entity: "tenant", entityId: tenantId, after: { name: input.name, slug: t!.slug } });
    });
  } catch (err) {
    // Two first requests raced: the other one won, use its tenant.
    const winner = await resolveRoute(db, input.kind, input.key);
    if (winner) return { tenantId: winner, created: false };
    throw err;
  }
  return { tenantId, created: true };
}

export type TenantInfo = { id: string; name: string; slug: string; plan: string; status: string; settings: ReturnType<typeof effectiveSettings>; inboundAddress: string };

export async function getTenant(deps: Pick<ServiceDeps, "db" | "inboundDomain">, tenantId: string): Promise<TenantInfo> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new ServiceError("not_found", "Tenant not found");
    const [s] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return { id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: t.status, settings: effectiveSettings(s?.settings), inboundAddress: inboundAddress(t.slug, deps.inboundDomain) };
  });
}

export async function updateSettings(deps: Pick<ServiceDeps, "db">, tenantId: string, patch: Partial<TenantSettings>, actor: Actor): Promise<TenantSettings> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    const before = row?.settings ?? {};
    const after: TenantSettings = { ...before, ...patch };
    await tx
      .insert(tenantSettings)
      .values({ tenantId, settings: after })
      .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { settings: after, updatedAt: new Date() } });
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changedBefore[k] = before[k] ?? null;
        changedAfter[k] = after[k];
      }
    }
    if (Object.keys(changedAfter).length) await logEvent(tx, { tenantId, actor, action: "updated", entity: "settings", entityId: tenantId, before: changedBefore, after: changedAfter });
    return after;
  });
}

export function inboundAddress(slug: string, domain: string): string {
  return `${slug}@${domain}`;
}

/** Accepts `<slug>@domain` and `orders+<slug>@domain`; returns the slug or null. */
export function slugFromRecipient(address: string, domain: string): string | null {
  const m = address.trim().toLowerCase().match(/<?([^<>\s@]+)@([^<>\s]+)>?$/);
  if (!m) return null;
  const [, local, host] = m;
  if (host !== domain.toLowerCase()) return null;
  const plus = local!.indexOf("+");
  return plus >= 0 ? local!.slice(plus + 1) : local!;
}

export type Role = "owner" | "admin" | "member" | "viewer";

/**
 * Mirror the signed-in person into `users` + `memberships` so audit rows and
 * `orders.reviewed_by` can reference a stable id. `users` is global (no RLS).
 */
export async function ensureUser(db: Db, tenantId: string, input: { authSubject: string; email: string; name?: string | null; role?: Role }): Promise<{ userId: string; role: Role }> {
  const [existing] = await db.select().from(users).where(eq(users.authSubject, input.authSubject));
  let userId = existing?.id;
  if (!userId) {
    const [row] = await db
      .insert(users)
      .values({ email: input.email.toLowerCase(), name: input.name ?? null, authSubject: input.authSubject })
      .onConflictDoUpdate({ target: users.email, set: { authSubject: input.authSubject, name: input.name ?? null, updatedAt: new Date() } })
      .returning({ id: users.id });
    userId = row!.id;
  }
  const role = await withTenant(db, tenantId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId!)));
    if (m) {
      if (input.role && input.role !== m.role) await tx.update(memberships).set({ role: input.role }).where(eq(memberships.id, m.id));
      return input.role ?? m.role;
    }
    const [any] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.tenantId, tenantId)).limit(1);
    const r: Role = input.role ?? (any ? "member" : "owner");
    await tx.insert(memberships).values({ tenantId, userId: userId!, role: r }).onConflictDoNothing();
    return r;
  });
  return { userId, role };
}
