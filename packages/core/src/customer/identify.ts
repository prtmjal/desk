import type { CustomerMatch, ExtractedOrder } from "../schema/index";
import { normalizePartNumber } from "../matching/normalize";
import { similarity } from "../matching/trigram";

export type CustomerRecord = {
  id: string;
  name: string;
  /** Email domains known to belong to this customer */
  domains: string[];
  /** Our account number for them, as it appears on their POs */
  accountNumber?: string | null;
  /** Any other names they trade under / appear as on documents */
  aka?: string[];
  active: boolean;
  creditHold?: boolean;
  priceListId?: string | null;
};

export type IdentifyInput = {
  senderEmail: string | null;
  order: Pick<ExtractedOrder, "customer" | "billTo" | "shipTo"> | null;
};

const FREE_MAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com",
  "comcast.net", "att.net", "proton.me", "protonmail.com",
]);

/** Free-mail providers never identify a company. */
export function isFreeMailDomain(domain: string | null | undefined): boolean {
  return !!domain && FREE_MAIL.has(domain.toLowerCase());
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  return m ? m[1]! : null;
}

/**
 * Deterministic customer identification (plan §6.6): sender domain → account number
 * → name similarity. The LLM is never consulted here; low confidence surfaces as a
 * review item with ranked candidates.
 */
export function identifyCustomer(input: IdentifyInput, customers: CustomerRecord[]): CustomerMatch {
  const active = customers.filter((c) => c.active);

  // 1. Sender domain (ignore free-mail providers).
  const dom = domainOf(input.senderEmail) ?? domainOf(input.order?.customer.email.value);
  if (dom && !FREE_MAIL.has(dom)) {
    const hits = active.filter((c) => c.domains.some((d) => d.toLowerCase() === dom));
    if (hits.length === 1) {
      const c = hits[0]!;
      return { customerId: c.id, name: c.name, method: "domain", confidence: 0.97, candidates: [{ customerId: c.id, name: c.name, score: 0.97 }] };
    }
    if (hits.length > 1) {
      // Same domain, several ERP accounts (branches). Fall through to name matching among these.
      const narrowed = rankByName(input, hits);
      if (narrowed[0] && narrowed[0].score >= 0.6) {
        return { customerId: narrowed[0].customerId, name: narrowed[0].name, method: "domain", confidence: 0.85, candidates: narrowed };
      }
      return { customerId: null, name: null, method: "domain", confidence: 0.5, candidates: narrowed.length ? narrowed : hits.map((c) => ({ customerId: c.id, name: c.name, score: 0.5 })) };
    }
  }

  // 2. Account number printed on the PO.
  const acct = normalizePartNumber(input.order?.customer.accountNumber.value);
  if (acct) {
    const hits = active.filter((c) => normalizePartNumber(c.accountNumber) === acct);
    if (hits.length === 1) {
      const c = hits[0]!;
      return { customerId: c.id, name: c.name, method: "account_number", confidence: 0.95, candidates: [{ customerId: c.id, name: c.name, score: 0.95 }] };
    }
  }

  // 3. Name similarity (bill-to name, customer name).
  const ranked = rankByName(input, active);
  if (ranked[0]) {
    const top = ranked[0];
    const second = ranked[1];
    const gap = second ? top.score - second.score : 1;
    if (top.score >= 0.8 && gap >= 0.15) {
      return { customerId: top.customerId, name: top.name, method: "name_trigram", confidence: Math.min(0.9, top.score), candidates: ranked };
    }
    return { customerId: null, name: null, method: "name_trigram", confidence: top.score * 0.5, candidates: ranked };
  }

  return { customerId: null, name: null, method: "none", confidence: 0, candidates: [] };
}

function rankByName(input: IdentifyInput, customers: CustomerRecord[]) {
  const names = [
    input.order?.customer.name.value,
    input.order?.billTo.name.value,
    input.order?.shipTo.name.value,
  ].filter((n): n is string => !!n && n.trim().length > 1);
  if (names.length === 0) return [];
  return customers
    .map((c) => {
      const variants = [c.name, ...(c.aka ?? [])];
      let best = 0;
      for (const n of names) for (const v of variants) best = Math.max(best, similarity(n, v));
      return { customerId: c.id, name: c.name, score: best };
    })
    .filter((r) => r.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
