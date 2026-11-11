import { events, type Tx } from "@desk/db";

export type Actor = { kind: "user"; id: string; label?: string } | { kind: "system" } | { kind: "integration"; id: string };

export function actorString(a: Actor): string {
  return a.kind === "system" ? "system" : `${a.kind}:${a.id}`;
}

export const SYSTEM: Actor = { kind: "system" };

/** Append one row to the immutable audit log (plan §6.2: every field change, who/what made it). */
export async function logEvent(
  tx: Tx,
  e: { tenantId: string; actor: Actor; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; at?: Date },
): Promise<void> {
  await tx.insert(events).values({
    tenantId: e.tenantId,
    actor: actorString(e.actor),
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    ...(e.at ? { at: e.at } : {}),
  });
}
