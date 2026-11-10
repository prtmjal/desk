import { z } from "zod";

/**
 * Shared vocabulary for the audit/waitlist form (marketing site) and the
 * `/api/waitlist` route. The option lists live here so the <select> elements
 * and the validator can never drift apart.
 */

export const ERP_OPTIONS = [
  { value: "quickbooks-online", label: "QuickBooks Online" },
  { value: "quickbooks-desktop", label: "QuickBooks Desktop / Enterprise" },
  { value: "netsuite", label: "NetSuite" },
  { value: "acumatica", label: "Acumatica" },
  { value: "odoo", label: "Odoo" },
  { value: "fishbowl", label: "Fishbowl" },
  { value: "katana", label: "Katana" },
  { value: "cin7", label: "Cin7" },
  { value: "sap-business-one", label: "SAP Business One" },
  { value: "sage", label: "Sage 100 / Intacct" },
  { value: "other", label: "Something else" },
] as const;

export const ORDERS_PER_DAY_OPTIONS = [
  { value: "under-15", label: "Fewer than 15" },
  { value: "15-30", label: "15 to 30" },
  { value: "30-100", label: "30 to 100" },
  { value: "100-300", label: "100 to 300" },
  { value: "300-plus", label: "More than 300" },
] as const;

type ErpValue = (typeof ERP_OPTIONS)[number]["value"];
type OrdersValue = (typeof ORDERS_PER_DAY_OPTIONS)[number]["value"];

const erpValues = ERP_OPTIONS.map((o) => o.value) as [ErpValue, ...ErpValue[]];
const ordersValues = ORDERS_PER_DAY_OPTIONS.map((o) => o.value) as [OrdersValue, ...OrdersValue[]];

export const erpSchema = z.enum(erpValues);
export const ordersPerDaySchema = z.enum(ordersValues);

export const waitlistSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, "Email is too long")
    .pipe(z.email("Enter a valid work email"))
    .transform((v) => v.toLowerCase()),
  company: z.string().trim().max(120, "Company name is too long").default(""),
  erp: erpSchema,
  ordersPerDay: ordersPerDaySchema,
  /** Honeypot. Real users never fill it; bots usually do. */
  website: z.string().max(0).optional(),
});

export type WaitlistInput = z.input<typeof waitlistSchema>;
export type WaitlistEntry = z.output<typeof waitlistSchema>;

/** Free-mail domains are accepted but flagged so sales can prioritise. */
const FREE_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
]);

export function isWorkEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain !== undefined && domain.length > 0 && !FREE_MAIL.has(domain);
}
