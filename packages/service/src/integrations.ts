import { integrations, withTenant } from "@desk/db";
import type { QboTokens } from "@desk/erp";
import { and, desc, eq } from "drizzle-orm";
import { logEvent, type Actor } from "./audit";
import { ServiceError, type IntegrationRow, type ServiceDeps } from "./context";
import type { ConnectorKind } from "./connectors";
import { deleteSecret, putSecret, requireSecretsKey } from "./secrets";
import { setRoute } from "./tenants";

export async function listIntegrations(deps: Pick<ServiceDeps, "db">, tenantId: string): Promise<IntegrationRow[]> {
  return withTenant(deps.db, tenantId, (tx) => tx.select().from(integrations).where(eq(integrations.tenantId, tenantId)).orderBy(desc(integrations.updatedAt)));
}

/** Connect a credential-less integration (demo ERP, CSV export). One ERP connection per tenant at MVP. */
export async function connectSimple(deps: Pick<ServiceDeps, "db">, tenantId: string, kind: Extract<ConnectorKind, "demo" | "csv">, actor: Actor): Promise<IntegrationRow> {
  return withTenant(deps.db, tenantId, async (tx) => {
    await tx.update(integrations).set({ status: "disabled" }).where(and(eq(integrations.tenantId, tenantId), eq(integrations.status, "connected")));
    const [row] = await tx
      .insert(integrations)
      .values({ tenantId, type: kind, name: kind === "demo" ? "Demo ERP" : "CSV export", status: "connected", config: {} })
      .returning();
    await logEvent(tx, { tenantId, actor, action: "connected", entity: "integration", entityId: row!.id, after: { type: kind } });
    return row!;
  });
}

export async function connectQuickBooks(
  deps: Pick<ServiceDeps, "db" | "secretsKey">,
  tenantId: string,
  input: { realmId: string; tokens: QboTokens; orderEntity?: "estimate" | "sales_order" },
  actor: Actor,
): Promise<IntegrationRow> {
  const key = requireSecretsKey(deps.secretsKey);
  const row = await withTenant(deps.db, tenantId, async (tx) => {
    await tx.update(integrations).set({ status: "disabled" }).where(and(eq(integrations.tenantId, tenantId), eq(integrations.status, "connected")));
    const ref = `qbo:${input.realmId}`;
    await putSecret(tx, tenantId, ref, input.tokens, key);
    const [existing] = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.type, "quickbooks_online"), eq(integrations.credentialsRef, ref)));
    const config = { realmId: input.realmId, orderEntity: input.orderEntity ?? (existing?.config as { orderEntity?: string } | undefined)?.orderEntity ?? "estimate" };
    const [saved] = existing
      ? await tx.update(integrations).set({ status: "connected", lastError: null, config }).where(eq(integrations.id, existing.id)).returning()
      : await tx.insert(integrations).values({ tenantId, type: "quickbooks_online", name: "QuickBooks Online", credentialsRef: ref, status: "connected", config }).returning();
    await logEvent(tx, { tenantId, actor, action: "connected", entity: "integration", entityId: saved!.id, after: { type: "quickbooks_online", realmId: input.realmId } });
    return saved!;
  });
  await setRoute(deps.db, tenantId, "qbo_realm", input.realmId);
  return row;
}

export async function updateIntegrationConfig(deps: Pick<ServiceDeps, "db">, tenantId: string, integrationId: string, patch: Record<string, unknown>, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.id, integrationId)));
    if (!row) throw new ServiceError("not_found", "Integration not found");
    await tx.update(integrations).set({ config: { ...row.config, ...patch } }).where(eq(integrations.id, integrationId));
    await logEvent(tx, { tenantId, actor, action: "updated", entity: "integration", entityId: integrationId, before: row.config, after: patch });
  });
}

export async function disconnectIntegration(deps: Pick<ServiceDeps, "db">, tenantId: string, integrationId: string, actor: Actor): Promise<void> {
  await withTenant(deps.db, tenantId, async (tx) => {
    const [row] = await tx.select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.id, integrationId)));
    if (!row) return;
    if (row.credentialsRef) await deleteSecret(tx, tenantId, row.credentialsRef);
    await tx.update(integrations).set({ status: "disabled", credentialsRef: null }).where(eq(integrations.id, integrationId));
    await logEvent(tx, { tenantId, actor, action: "disconnected", entity: "integration", entityId: integrationId, after: { type: row.type } });
  });
}
