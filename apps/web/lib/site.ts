/**
 * Product facts shared by the marketing pages, llms.txt and metadata.
 * Keep in sync with docs/MASTER_PLAN.md §6.4, §8.2 and §9.1.
 */

export const SITE = {
  name: "DESK",
  category: "AI order desk",
  tagline: "Every customer order into your ERP in a minute, touched only when it should be.",
  description:
    "DESK is an AI order desk for small and mid-size wholesale distributors. It reads emailed and PDF customer purchase orders, matches them to your items and customers, validates them against your ERP and posts a sales order. Your team only touches the exceptions.",
  auditCta: "Run 50 of your POs free",
} as const;

/**
 * Who the customer contracts with. Set these before launch: the legal pages, Stripe and
 * Intuit's app review all show them. Unset values render as a visible "[set …]" marker.
 */
export function legal() {
  return {
    entity: process.env.LEGAL_ENTITY_NAME || "[set LEGAL_ENTITY_NAME]",
    address: process.env.LEGAL_ENTITY_ADDRESS || "[set LEGAL_ENTITY_ADDRESS]",
    email: process.env.LEGAL_CONTACT_EMAIL || "[set LEGAL_CONTACT_EMAIL]",
    jurisdiction: process.env.LEGAL_JURISDICTION || "[set LEGAL_JURISDICTION]",
    effective: process.env.LEGAL_EFFECTIVE_DATE || "[set LEGAL_EFFECTIVE_DATE]",
  };
}

export const ERPS = [
  "QuickBooks Online",
  "QuickBooks Desktop / Enterprise",
  "NetSuite",
  "Acumatica",
  "Odoo",
  "Fishbowl",
  "Katana",
  "Cin7",
  "SAP Business One",
  "Sage 100 / Intacct",
] as const;

export type Plan = {
  id: "starter" | "growth" | "scale";
  name: string;
  monthly: number;
  includedOrders: number;
  overage: number;
  fteLine: string;
  fits: string;
  features: string[];
  highlight?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: 299,
    includedOrders: 150,
    overage: 1.5,
    fteLine: "About one eighth of a part-time order-entry clerk ($2,000 to $3,000/mo).",
    fits: "One ERP connection, up to 3 users. For a desk that keys 5 to 10 emailed orders a day.",
    features: [
      "1 ERP connection",
      "3 users",
      "Email intake (orders@ address) and manual upload",
      "Review queue with the source document side by side",
      "CSV / Excel export fallback",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    monthly: 799,
    includedOrders: 600,
    overage: 1.0,
    fteLine: "Roughly a third of one part-time clerk. Most desks at 20 to 40 orders a day land here.",
    fits: "Everything in Starter, plus the automation that gets you to touchless.",
    highlight: true,
    features: [
      "Everything in Starter",
      "Auto-post rules per customer (confidence and price tolerance)",
      "Customer acknowledgment emails",
      "Alias learning insights (how each customer writes your part numbers)",
      "10 users",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    monthly: 1999,
    includedOrders: 2500,
    overage: 0.6,
    fteLine: "Less than one part-time clerk, for volume that usually takes two or three full-time.",
    fits: "Multiple entities or branches, your own automations, and someone on call.",
    features: [
      "Everything in Growth",
      "Multi-entity",
      "API access",
      "SSO (later)",
      "Priority support and dedicated onboarding",
    ],
  },
];

export const MODULES = [
  { name: "Order-status replies", price: "from $199/mo, or $0.75 per inquiry resolved" },
  { name: "Quotes", price: "from $299/mo, or $2 per quote sent" },
  { name: "AR (collections)", price: "$199 to $499/mo" },
  { name: "AP capture", price: "$199 to $499/mo" },
] as const;

export const ONBOARDING = {
  selfServe: "$0 self-serve: connect your ERP and forward orders to your DESK address.",
  guided:
    "$1,500 to $5,000 guided onboarding for Scale or complex ERP setups (QuickBooks Desktop bridge, multi-entity NetSuite, custom item masters).",
} as const;

export const SECURITY_COMMITMENTS = [
  {
    title: "Tenant isolation",
    body: "Every row in our Postgres database carries a tenant id and is protected by row-level security policies. Isolation is covered by automated tests that run in CI, not just by convention.",
  },
  {
    title: "Encryption in transit and at rest",
    body: "TLS for every connection, including to your ERP. Documents, raw emails and database storage are encrypted at rest by our hosting providers. Secrets live in a vault, not in code or config files.",
  },
  {
    title: "Least-privilege ERP scopes",
    body: "We ask only for the scopes needed to read items, customers and price lists and to create sales orders. Where the ERP supports it, orders are posted as drafts or unapproved so your approval flow stays in control.",
  },
  {
    title: "No training on your data",
    body: "Your purchase orders, item master and customer records are used to process your orders. They are not used to train models, ours or anyone else's. Per-customer alias memory stays inside your tenant.",
  },
  {
    title: "Immutable audit log",
    body: "Every field change on every order, whether made by the model or a person, is recorded with who, what and when. Audit entries are append-only.",
  },
  {
    title: "Data retention controls",
    body: "You decide how long source documents and extracted data are kept. Deletion requests are honoured across primary storage and backups on a published schedule.",
  },
] as const;

export const SECURITY_ROADMAP = [
  "SOC 2 Type I: targeted within the first 12 months of operation, using a compliance automation platform. We will share the report under NDA when it is issued.",
  "Data processing agreement (DPA) template available on request before SOC 2 is complete.",
  "Third-party penetration test before general availability of auto-posting.",
] as const;

export const FAQ: { q: string; a: string }[] = [
  {
    q: "What counts as an order?",
    a: "Only orders that reach your ERP as a sales order count toward your plan. Documents that are rejected, duplicated or fail validation are never billed. Multi-order emails are split and counted per resulting sales order.",
  },
  {
    q: "What happens if I go over my included orders?",
    a: "You pay the per-order overage for your plan: $1.50 on Starter, $1.00 on Growth, $0.60 on Scale. There is no hard cap and we do not stop processing. We will tell you when the next plan up would be cheaper.",
  },
  {
    q: "Is there a setup fee?",
    a: "Self-serve onboarding is free: connect your ERP, forward your orders address, review the first drafts. Guided onboarding is $1,500 to $5,000 for Scale customers or complex ERP setups such as QuickBooks Desktop bridges or multi-entity NetSuite.",
  },
  {
    q: "Which ERPs do you support?",
    a: "QuickBooks Online, QuickBooks Desktop / Enterprise, NetSuite, Acumatica, Odoo, Fishbowl, Katana, Cin7, SAP Business One and Sage 100 / Intacct are on the roadmap. The first connectors ship for QuickBooks Online and NetSuite. Every plan includes a CSV / Excel export so you can pilot before your connector is live.",
  },
  {
    q: "Do you offer an annual discount?",
    a: "Yes. Annual prepay is discounted 15 to 20 percent depending on plan. Design partners who join before general availability lock their price for 24 months.",
  },
  {
    q: "How does the free PO audit work?",
    a: "You send us 50 of your recent customer purchase orders (emails, PDFs, spreadsheets, photos). We run them through DESK against your exported item and customer lists and send back a report: field-level accuracy, how many would have posted without a human touch, and the exceptions we would have raised. No ERP connection is needed for the audit.",
  },
  {
    q: "What is the FTE-equivalent line on each plan?",
    a: "A comparison anchor. Manual order entry takes 5 to 15 minutes per order, and a part-time order-entry clerk costs roughly $2,000 to $3,000 a month fully loaded. The line shows how each plan's platform fee compares to that labor cost.",
  },
  {
    q: "Can I turn off auto-posting?",
    a: "Yes, and it is off by default. Every order goes to your review queue until you set per-customer thresholds, for example: auto-post when every line is at or above 0.98 confidence and price is within 2 percent of list.",
  },
];
