import { describe, expect, it } from "vitest";
import { identifyCustomer, domainOf, type ExtractedOrder } from "../src/index.js";
import { CUSTOMERS, str } from "./fixtures.js";

function order(partial: { name?: string | null; account?: string | null; email?: string | null; billToName?: string | null }): Pick<ExtractedOrder, "customer" | "billTo" | "shipTo"> {
  const addr = (name: string | null) => ({
    name: str(name, name ? 0.9 : 0),
    attention: str(null, 0), line1: str(null, 0), line2: str(null, 0), city: str(null, 0), region: str(null, 0), postalCode: str(null, 0), country: str(null, 0),
  });
  return {
    customer: { name: str(partial.name ?? null), accountNumber: str(partial.account ?? null), contactName: str(null, 0), email: str(partial.email ?? null), phone: str(null, 0) },
    billTo: addr(partial.billToName ?? null),
    shipTo: addr(null),
  };
}

describe("identifyCustomer", () => {
  it("extracts domains", () => {
    expect(domainOf("Buyer <joe@AcmeElectric.com>")).toBe("acmeelectric.com");
    expect(domainOf(null)).toBeNull();
  });

  it("matches by unique sender domain", () => {
    const m = identifyCustomer({ senderEmail: "po@acmeelectric.com", order: order({}) }, CUSTOMERS);
    expect(m.customerId).toBe("c1");
    expect(m.method).toBe("domain");
    expect(m.confidence).toBeGreaterThan(0.9);
  });

  it("disambiguates shared domains by name, otherwise returns candidates", () => {
    const dallas = identifyCustomer({ senderEmail: "po@brightlights.com", order: order({ billToName: "Bright Lights Dallas Branch" }) }, CUSTOMERS);
    expect(dallas.customerId).toBe("c3");
    const unknown = identifyCustomer({ senderEmail: "po@brightlights.com", order: order({}) }, CUSTOMERS);
    expect(unknown.customerId).toBeNull();
    expect(unknown.candidates.map((c) => c.customerId).sort()).toEqual(["c2", "c3"]);
  });

  it("ignores free-mail domains and falls back to account number", () => {
    const m = identifyCustomer({ senderEmail: "someone@gmail.com", order: order({ account: "ac 1001" }) }, CUSTOMERS);
    expect(m.customerId).toBe("c1");
    expect(m.method).toBe("account_number");
  });

  it("falls back to name similarity and never matches inactive customers", () => {
    const m = identifyCustomer({ senderEmail: null, order: order({ name: "ACME Electric Contractors Inc" }) }, CUSTOMERS);
    expect(m.customerId).toBe("c1");
    expect(m.method).toBe("name_trigram");
    const closed = identifyCustomer({ senderEmail: "x@closed.com", order: order({ name: "Closed Co" }) }, CUSTOMERS);
    expect(closed.customerId).toBeNull();
  });
});
