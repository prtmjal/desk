import "server-only";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { DEMO_TENANT_ID, tenants, withTenant } from "@desk/db";
import { connectSimple, ensureTenant, ensureUser, resolveRoute, runSync, SYSTEM, updateSettings, type Actor, type Role, type ServiceDeps } from "@desk/service";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { isClerkConfigured, isDemoMode } from "@/lib/env";
import { getDeps } from "./deps";

export type Session = {
  deps: ServiceDeps;
  tenantId: string;
  actor: Actor;
  role: Role;
  userLabel: string;
  demo: boolean;
};

const DEMO_ORG_KEY = "demo";
const cache = new Map<string, { tenantId: string; userId: string; role: Role; label: string }>();
let demoReady: Promise<{ tenantId: string; userId: string }> | null = null;

/** First visit in demo mode: create the demo tenant, connect the demo ERP and sync its catalog. */
async function ensureDemo(deps: ServiceDeps): Promise<{ tenantId: string; userId: string }> {
  const { tenantId, created } = await ensureTenant(deps.db, { kind: "auth_org", key: DEMO_ORG_KEY, name: "Acme Electrical & Plumbing Supply (demo)", id: DEMO_TENANT_ID });
  const hasName = await withTenant(deps.db, tenantId, async (tx) => (await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId))).length > 0);
  if (created && hasName) {
    const integration = await connectSimple(deps, tenantId, "demo", SYSTEM);
    await runSync(deps, tenantId, integration.id, SYSTEM);
    await updateSettings(deps, tenantId, { digestRecipients: ["ops@example.com"] }, SYSTEM);
  }
  const { userId } = await ensureUser(deps.db, tenantId, { authSubject: "demo-user", email: "demo@example.com", name: "Demo user", role: "owner" });
  return { tenantId, userId };
}

/** Resolve the signed-in user's tenant, or null when they have no active organization yet. */
export async function getSession(): Promise<Session | null> {
  const deps = await getDeps();

  if (isDemoMode()) {
    demoReady ??= ensureDemo(deps).catch((err) => {
      demoReady = null;
      throw err;
    });
    const { tenantId, userId } = await demoReady;
    return { deps, tenantId, actor: { kind: "user", id: userId, label: "Demo user" }, role: "owner", userLabel: "Demo user", demo: true };
  }

  if (!isClerkConfigured()) return null;
  const { userId, orgId, orgRole } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) return null;

  const key = `${orgId}:${userId}:${orgRole ?? ""}`;
  let hit = cache.get(key);
  if (!hit) {
    const tenantId = await ensureTenantFor(deps, orgId);
    const user = await currentUser();
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? `${userId}@users.invalid`;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
    const mapped: Role | undefined = orgRole === "org:admin" ? "admin" : undefined;
    const u = await ensureUser(deps.db, tenantId, { authSubject: userId, email, name, role: mapped });
    hit = { tenantId, userId: u.userId, role: u.role, label: name ?? email };
    if (cache.size > 5000) cache.clear();
    cache.set(key, hit);
  }
  return { deps, tenantId: hit.tenantId, actor: { kind: "user", id: hit.userId, label: hit.label }, role: hit.role, userLabel: hit.label, demo: false };
}

async function ensureTenantFor(deps: ServiceDeps, orgId: string): Promise<string> {
  const found = await resolveRoute(deps.db, "auth_org", orgId);
  if (found) return found;
  const org = await (await clerkClient()).organizations.getOrganization({ organizationId: orgId });
  return (await ensureTenant(deps.db, { kind: "auth_org", key: orgId, name: org.name })).tenantId;
}

/** For pages and actions under /app: a session is required. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/app/setup");
  return s;
}

export function canAdmin(s: Pick<Session, "role">): boolean {
  return s.role === "owner" || s.role === "admin";
}

export function requireAdmin(s: Session): void {
  if (!canAdmin(s)) throw new Error("Only an owner or admin can change this.");
}
