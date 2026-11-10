import { appUrl } from "@/lib/env";
import { ERPS, FAQ, MODULES, ONBOARDING, PLANS, SECURITY_COMMITMENTS, SITE } from "@/lib/site";

export const dynamic = "force-static";

/**
 * Machine-readable product facts for AI assistants and crawlers (plan §9.2 #7).
 * Plain text, llms.txt style: a title, a summary, then sections of facts and links.
 */
export function GET() {
  const base = appUrl();
  const lines: string[] = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    `Category: ${SITE.category}`,
    `Promise: ${SITE.tagline}`,
    "Customers: wholesale distributors and light manufacturers, 10 to 200 employees, receiving 15+ customer purchase orders a day by email, PDF, spreadsheet, image or fax.",
    "Status: pre-launch. Free audit available: send 50 recent purchase orders, receive an accuracy report.",
    "",
    "## What it does",
    "- Intake: tenant-specific orders@ email address and manual upload; PDF, images, XLSX/CSV, DOCX; multi-order emails are split.",
    "- Extraction to a strict order schema with per-field confidence.",
    "- Customer identification from sender domain, bill-to/ship-to and PO header, with learning.",
    "- Line matching to the item master with per-customer alias memory, UoM and pack-size handling.",
    "- Validation against the ERP: item active, price vs list/contract, stock, UoM rounding, minimum order, credit hold, duplicate PO number.",
    "- Review queue: source document and draft order side by side, keyboard-first, one-click confirm.",
    "- Posting to the ERP as a sales order (draft/unapproved where supported) with the document attached.",
    "- Per-customer auto-post rules (off by default). Customer acknowledgment emails. Audit log of every change.",
    "",
    "## ERP systems (roadmap order; QuickBooks Online and NetSuite first)",
    ...ERPS.map((e) => `- ${e}`),
    "- Universal CSV / Excel export on every plan",
    "",
    "## Pricing (USD, published)",
    ...PLANS.map(
      (p) =>
        `- ${p.name}: $${p.monthly}/month, ${p.includedOrders} posted orders included, $${p.overage.toFixed(2)} per additional order. ${p.fits}`,
    ),
    `- Modules: ${MODULES.map((m) => `${m.name} (${m.price})`).join("; ")}`,
    `- Onboarding: ${ONBOARDING.selfServe} ${ONBOARDING.guided}`,
    "- Only orders that reach the ERP are billed. Annual prepay discounted 15 to 20%.",
    "",
    "## Security commitments",
    ...SECURITY_COMMITMENTS.map((c) => `- ${c.title}: ${c.body}`),
    "- SOC 2 Type I is targeted within the first 12 months of operation (not yet held).",
    "",
    "## FAQ",
    ...FAQ.flatMap((f) => [`Q: ${f.q}`, `A: ${f.a}`, ""]),
    "## Links",
    `- Home: ${base}/`,
    `- Pricing: ${base}/pricing`,
    `- Security: ${base}/security`,
    `- Free PO audit: ${base}/#audit`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
