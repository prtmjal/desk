import { domainOf, isFreeMailDomain, normalizeDescription, normalizePartNumber, type OrderDraft } from "@desk/core";
import { customers, inboundMessages, PgCatalogIndex, type Tx } from "@desk/db";
import { and, eq, sql } from "drizzle-orm";
import { logEvent, type Actor } from "./audit";

/**
 * The moat (plan §4.5 #1): every confirmed order teaches the desk.
 *  - customer part number / description → item alias (with the UoM factor that was used)
 *  - sender email domain → customer, when a person identified the customer by hand
 * Returns the number of aliases written or reinforced.
 */
export async function learnFromOrder(tx: Tx, tenantId: string, draft: OrderDraft, messageRowId: string | null, actor: Actor): Promise<number> {
  const customerId = draft.customer.customerId;
  if (!customerId) return 0;
  const catalog = new PgCatalogIndex(tx, tenantId);
  let learned = 0;
  for (const l of draft.lines) {
    const best = l.match.best;
    if (l.match.status !== "matched" || !best) continue;
    // An exact hit on our own SKU/UPC/MPN needs no alias.
    if (best.method === "L0_exact") continue;
    const partKey = normalizePartNumber(l.rawPartNumber.value);
    const descKey = partKey ? null : normalizeDescription(l.rawDescription.value) || null;
    if (!partKey && !descKey) continue;
    // A line added by hand carries our SKU as its "raw" part number: nothing to learn.
    if (partKey && partKey === normalizePartNumber(best.sku)) continue;
    await catalog.learnAlias({ customerId, rawPartKey: partKey, rawDescriptionKey: descKey, itemId: best.itemId, uomFactor: l.match.uomFactor, hits: 1 });
    learned++;
    if (best.method !== "L1_alias") {
      await logEvent(tx, { tenantId, actor, action: "alias_learned", entity: "alias", entityId: best.itemId, after: { customerId, rawPart: l.rawPartNumber.value, rawDescription: partKey ? null : l.rawDescription.value, sku: best.sku, via: best.method } });
    }
  }

  if (draft.customer.method === "manual" && messageRowId) {
    const [m] = await tx.select({ from: inboundMessages.fromAddress }).from(inboundMessages).where(and(eq(inboundMessages.tenantId, tenantId), eq(inboundMessages.id, messageRowId)));
    const dom = domainOf(m?.from);
    if (dom && !isFreeMailDomain(dom)) {
      const updated = await tx
        .update(customers)
        .set({ domains: sql`array_append(${customers.domains}, ${dom})` })
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId), sql`NOT (${dom} = ANY(${customers.domains}))`))
        .returning({ id: customers.id });
      if (updated.length) await logEvent(tx, { tenantId, actor, action: "domain_learned", entity: "customer", entityId: customerId, after: { domain: dom } });
    }
  }
  return learned;
}
