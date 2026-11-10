import { describe, expect, it } from "vitest";
import {
  ERP_OPTIONS,
  ORDERS_PER_DAY_OPTIONS,
  isWorkEmail,
  waitlistSchema,
} from "./waitlist-schema";

const valid = {
  email: "ops@acme-electrical.com",
  company: "Acme Electrical Supply",
  erp: "quickbooks-online",
  ordersPerDay: "30-100",
};

describe("waitlistSchema", () => {
  it("accepts a well-formed submission and normalises email case", () => {
    const result = waitlistSchema.safeParse({ ...valid, email: "  Ops@Acme-Electrical.COM " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ops@acme-electrical.com");
      expect(result.data.company).toBe("Acme Electrical Supply");
    }
  });

  it("requires a valid email", () => {
    expect(waitlistSchema.safeParse({ ...valid, email: "" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ ...valid, email: "a@b" }).success).toBe(false);
    const { email: _omit, ...withoutEmail } = valid;
    expect(waitlistSchema.safeParse(withoutEmail).success).toBe(false);
  });

  it("caps company at 120 characters and defaults it to empty", () => {
    expect(waitlistSchema.safeParse({ ...valid, company: "x".repeat(120) }).success).toBe(true);
    expect(waitlistSchema.safeParse({ ...valid, company: "x".repeat(121) }).success).toBe(false);
    const { company: _omit, ...withoutCompany } = valid;
    const result = waitlistSchema.safeParse(withoutCompany);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.company).toBe("");
  });

  it("only accepts known ERP and volume options", () => {
    for (const erp of ERP_OPTIONS) {
      expect(waitlistSchema.safeParse({ ...valid, erp: erp.value }).success).toBe(true);
    }
    for (const volume of ORDERS_PER_DAY_OPTIONS) {
      expect(waitlistSchema.safeParse({ ...valid, ordersPerDay: volume.value }).success).toBe(true);
    }
    expect(waitlistSchema.safeParse({ ...valid, erp: "epicor" }).success).toBe(false);
    expect(waitlistSchema.safeParse({ ...valid, ordersPerDay: "lots" }).success).toBe(false);
  });

  it("rejects submissions where the honeypot is filled", () => {
    expect(waitlistSchema.safeParse({ ...valid, website: "" }).success).toBe(true);
    expect(waitlistSchema.safeParse({ ...valid, website: "http://spam.example" }).success).toBe(false);
  });

  it("rejects non-object payloads", () => {
    expect(waitlistSchema.safeParse(null).success).toBe(false);
    expect(waitlistSchema.safeParse("ops@acme.com").success).toBe(false);
    expect(waitlistSchema.safeParse([]).success).toBe(false);
  });
});

describe("isWorkEmail", () => {
  it("flags free-mail domains", () => {
    expect(isWorkEmail("someone@gmail.com")).toBe(false);
    expect(isWorkEmail("ops@acme-electrical.com")).toBe(true);
  });
});
