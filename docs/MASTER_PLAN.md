# SaaS Master Plan: From Research to Top-1% Trajectory
**Prepared:** 7 November 2026 · **Format:** Claude Code-ready operating document
**Working codename:** DESK (rename after a trademark/domain check; see §9.1)

---

## 0. How to use this document with Claude Code

1. Create your repo and copy this file to `docs/MASTER_PLAN.md`.
2. Create `CLAUDE.md` at the repo root using the template in §7.4. It points Claude Code at this plan and at the phase you are in.
3. Work phase by phase (§7.5). Each phase has a goal, a task list, and a "definition of done." Paste a phase's task block into Claude Code and let it plan; do not hand it the whole document at once.
4. Keep `docs/DECISIONS.md` (architecture decisions) and `docs/EVALS.md` (accuracy results) up to date; Claude Code should read both before touching the extraction pipeline.
5. Re-read §4.6 (kill criteria) at the end of every month. This plan is only right if the market confirms it in the first 6 weeks.

---

## 1. Executive summary (the decision)

**Build an AI "order desk" for small and mid-size wholesale distributors and light manufacturers**: software that reads every inbound customer order (email, PDF, spreadsheet, photo, fax, later phone), matches it to the company's item master and customer records, validates price/stock/terms against their ERP, and posts a sales order to QuickBooks / NetSuite / Acumatica / Odoo / Fishbowl with a human confirming only exceptions. Then expand along the same desk: quotes, order-status replies, supplier PO acknowledgments, collections, AP.

Why this, after questioning every alternative:

- **It sells against a labor budget, not an IT budget.** Order entry at a distributor is 1 to 3 full-time staff rekeying POs. A tool that removes most of that work is a $500 to $3,000/month decision made by an owner or ops manager in one meeting, with ROI obvious in week one. Vertical AI that replaces labor is the fastest-growing SaaS cohort in 2026 (AI-native median growth ~55% vs ~14% for legacy SaaS), and vertical SaaS retains better (median GRR ~92%, NRR ~112%) and commands a ~46% valuation premium over horizontal peers.
- **The market is large enough for a top-1% outcome.** Roughly 250,000 to 300,000 wholesale distribution companies operate in North America (an ~$8 trillion industry with 6M+ employees), plus a similar count of small manufacturers who receive document orders. Tens of thousands fit the ICP; at $15k to $25k ACV, that is a $1B+ serviceable market in English-speaking countries alone. Reaching $25M ARR, which is roughly where the top 1 to 2% of SaaS companies land within a decade, does not require winning the whole market.
- **The pain is proven and the pricing model is favorable.** Independent complaint-mining data ranks "B2B commerce / catalog matching and quote generation across messy part numbers" among the two widest competitive gaps in all of vertical software (7.9/10 vs a 5.7 average). The category already has a bootstrapped-to-Series-A proof point (Canals: order entry wedge, 100+ distributors, $35M raised in May 2026). Per-order outcome pricing fits naturally, and outcome/usage pricing is where the industry is moving (per-seat vendor share fell from 21% to 15% in a year; Gartner expects 40%+ of enterprise SaaS spend to shift to usage/agent/outcome pricing by 2030).
- **The whitespace is specific.** The leaders (Conexiom, Esker, Canals, Workist) sell upmarket to mid-size and enterprise distributors on Epicor/Infor/SAP with quote-based pricing and implementation projects. The 10 to 200 employee company on QuickBooks Enterprise/Online, NetSuite, Acumatica, Odoo, Fishbowl or Katana is served only by three-person startups with single-ERP coverage, generic PDF parsers, or nothing. Nobody has built the **self-serve, multi-ERP, one-week-to-live, per-order-priced** product for that tier. Intuit shipping a Sales Order API (October 2026) removes the biggest historical blocker for the QuickBooks Online segment.

**What "top 1%" requires and what this plan targets:** the top decile of SaaS companies reach $1M ARR within ~9 months of first revenue and $10M within ~3 years; only ~1 in 10 SaaS companies ever reaches $10M and ~1 in 50 reaches $25M. The plan below is built to give you a credible shot at the $10M-in-3-years path: 5 design partners by month 3, $40k to $60k MRR by month 12, $250k+ MRR by month 24 through module expansion and channel partners, and the operating metrics (NRR >115%, GRR >92%, CAC payback <12 months) that make the rest a capital and execution question.

**Two alternates survived scoring and are documented in §11** in case validation fails: (B) an AI billing-and-compliance agent for construction subcontractors, and (C) SMB AI-governance/compliance for EU companies. Everything else was eliminated for reasons given in §3.

---

## 2. What the 2026 research says (the facts that shaped the decision)

### 2.1 The SaaS baseline has reset lower and more fragile
- Median private B2B SaaS growth is ~20 to 26% depending on the dataset (down from ~30% in 2022); top quartile is ~42 to 50%. Growth under $1M ARR medians ~75%, $1 to 5M ~40%, $5 to 20M ~30%.
- Gross revenue retention fell from 88% to 84% in Benchmarkit's 2026 data; median NRR is ~101 to 102%. Product-led companies retain worse (GRR ~79%) than sales-led (~89%).
- Rule of 40 median rose to 25% (top quartile 43%); ARR per employee jumped to ~$175 to 193k as teams used AI to do more with fewer people.
- Companies with NRR >106% and CAC payback <10 months grew a median 71%; those with NRR <98% and payback >15 months grew ~10%. Retention and efficiency, not top-of-funnel, separate the top decile.

### 2.2 Where growth is concentrated
- AI-native companies: ~55% median growth and ~95% top quartile; AI-embedded ~28%; legacy non-AI ~14%.
- Vertical SaaS & AI: ~24% median growth vs 17 to 19% for horizontal B2B. Vertical SaaS: ~92% GRR, ~112% NRR, 46% valuation premium, often with embedded fintech revenue.
- AI agents market ~$10.9B in 2026 growing ~46%/yr; vertical, industry-specific agents ~63%/yr. Gartner: 40% of enterprise applications will embed task-specific agents by end-2026 (from <5% in 2025).
- YC's 2026 batches were ~60% AI companies, with vertical agents replacing SaaS categories as the dominant theme. Examples cited in 2026 coverage: Legora (legal) $0 to $100M ARR in 18 months; Corvera $0 to $33k MRR in four weeks.
- Bootstrapped infrastructure makers riding agent demand (e.g., DataForSEO, +350% brand search) show the "picks and shovels for agents" lane is real but developer-crowded.

### 2.3 Pricing is moving from seats to usage and outcomes
- Per-seat pricing share of SaaS vendors fell from 21% to 15% in twelve months (Deloitte TMT 2026). A Cruxy survey of 300 SaaS CEOs (April 2026): 97% plan to retire seat-based pricing within two years.
- Gartner: at least 40% of enterprise SaaS spend shifts to usage-, agent-, or outcome-based pricing by 2030. ~83% of AI-native SaaS already uses some usage-based billing. Hybrid (platform fee + usage/outcome) is where pricing is actually landing.
- Proof points: Intercom Fin ($0.99 per resolved conversation), Zendesk Automated Resolutions, Sierra's outcome contracts. Companies relying on outcome-based pricing planned 50% growth for 2026 (vs 26% median).
- Margin caution: AI-native products run 50 to 60% gross margin unless per-unit model cost is engineered down; traditional SaaS runs 80 to 90%. This plan budgets <$0.10 of model cost per order.

### 2.4 Distribution has changed under everyone's feet
- AI Overviews appear on ~82% of B2B tech searches and cut organic CTR ~61% when present; zero-click searches are ~60% overall (77% on mobile). Informational "how-to" content is the most cannibalized (~74% zero-click); commercial-investigation and transactional queries much less (~51% and ~39%).
- ~84% of CMOs now use AI assistants for vendor discovery (Wynter 2026); ~90% of B2B deals go to a vendor on the buyer's initial shortlist, built in communities, peer Slack groups, Reddit and AI answers.
- LinkedIn is the dominant B2B distribution channel; founder-led content, integration ecosystems, communities, and AI-citable content are gaining share; pure SEO/paid arbitrage is shrinking. PLG dominates under ~$5k ACV; above that, founder-led sales plus partners.
- Implication for this plan: distribution = ERP marketplaces + channel partners + trade associations + bottom-of-funnel comparison content + founder-led LinkedIn, not an informational blog.

### 2.5 The odds (so the target is honest)
- ~50% of monetizing SaaS startups reach $1M ARR within 10 years; ~1 in 10 reach $10M; ~1 in 50 reach $25M; ~3% reach $100M.
- Top 10% reach $1M ARR in ~9 months and $10M in ~2 years 9 months; median takes ~2y9m and ~5 years. Top-decile growth: ~192% at $1 to 3M ARR, ~121% at $3 to 8M.
- Most companies get from $1M to $10M by adding logos, not raising ARPA, but the fastest ones do both. This plan does both (new logos + module expansion).

### 2.6 Regulatory tailwinds examined (and why they are not the primary bet)
- **EU AI Act:** Article 50 transparency duties applied 2 August 2026; the Digital Omnibus (Reg. 2026/1744) deferred high-risk obligations to 2 December 2027 (Annex III) and 2 August 2028 (Annex I). Enterprise compliance tools are quote-priced; an SME entrant (SetAIComply, from €39/month) already exists; Vanta/Drata can add frameworks quickly. Real but deferred and contestable. Kept as Alternate C.
- **E-invoicing mandates:** Belgium (Jan 2026), Poland KSeF (Feb/Apr 2026; all by Jan 2027), France (receive for all + issue for large/mid Sept 2026; SMEs Sept 2027), Germany (issue 2027/2028), Spain Verifactu (2027). Huge forced adoption, but accounting-software incumbents and certified platforms own it; certification and tax-authority integration is infrastructure work, not a wedge for a small team. Eliminated as a primary bet; noted as a feature opportunity for EU expansion later.

---

## 3. Idea scoring: 14 candidates, one survivor

Scoring 1 to 5 on eight criteria (40 max). Criteria: **Pain** (severity, not just presence), **WTP** (ACV a small team can command), **TAM** (can support $25M+ ARR), **Incumbent weakness**, **Whitespace** (how contested the specific segment is), **Buildability** (small team + Claude Code, 90 days to a sellable MVP), **Access** (can you reach buyers without insider status), **Outcome-pricing fit**.

| # | Candidate | Pain | WTP | TAM | Incumb. weak | White-space | Build | Access | Outcome fit | Total | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **AI order desk for SMB distributors/manufacturers** | 5 | 4 | 5 | 4 | 3 | 4 | 4 | 5 | **34** | **Build** |
| 2 | Subcontractor billing/lien-waiver/compliance agent | 5 | 4 | 4 | 3 | 4 | 3 | 3 | 4 | 30 | Alternate B |
| 3 | SMB AI-governance / EU AI Act compliance | 3 | 3 | 4 | 3 | 3 | 4 | 4 | 2 | 26 | Alternate C |
| 4 | AI AR collections agent for SMB B2B | 4 | 3 | 4 | 3 | 2 | 4 | 4 | 5 | 29 | Fold into #1 as a module |
| 5 | E-invoicing compliance micro-SaaS (EU) | 4 | 2 | 4 | 2 | 2 | 2 | 3 | 2 | 21 | Eliminated (infra/certification, incumbents) |
| 6 | Agent infra (evals, observability, durable runs) | 4 | 3 | 4 | 2 | 1 | 4 | 4 | 2 | 24 | Eliminated (heavily funded, dev-crowded) |
| 7 | AI customer-support agent for SMB | 4 | 3 | 5 | 2 | 1 | 4 | 4 | 5 | 28 | Eliminated (Fin/Decagon/Sierra + hundreds of clones) |
| 8 | AI voice receptionist for trades/clinics | 4 | 3 | 5 | 3 | 1 | 3 | 3 | 4 | 26 | Eliminated (funded gold rush; platforms bundling) |
| 9 | Insurance-agency back-office AI | 4 | 4 | 4 | 3 | 1 | 3 | 2 | 4 | 25 | Eliminated (2024-25 funding wave) |
| 10 | Freight-broker ops AI | 4 | 4 | 4 | 3 | 1 | 3 | 2 | 4 | 25 | Eliminated (HappyRobot/Vooma et al.) |
| 11 | Accounting-firm AI agents | 4 | 4 | 4 | 3 | 1 | 3 | 3 | 3 | 25 | Eliminated (most-funded SMB vertical of 2025) |
| 12 | Appointment-reminder AI (reads replies, reschedules) | 2 | 2 | 4 | 3 | 3 | 5 | 4 | 3 | 26 | Eliminated (gap high, pain low; incumbents add it) |
| 13 | GEO / AI-search visibility tooling | 3 | 3 | 4 | 3 | 1 | 4 | 5 | 2 | 25 | Eliminated (Profound/Peec/Athena funded 2025) |
| 14 | Property-management leasing AI | 3 | 3 | 4 | 2 | 1 | 3 | 3 | 4 | 23 | Eliminated (EliseAI, Entrata) |

**Self-challenge on the winner.** The honest objection to #1 is "Whitespace = 3": there are now ten-plus entrants (Conexiom, Esker, Canals, Workist, Morsa, Proton.ai, Ordermatic, OrderDrafter, Logistify, Y Meadows, Fluent, Endeavor, WizCommerce, ParserBee). I weighed abandoning it for a quieter niche. Reasons it still wins:

1. Contestedness is evidence of money. Canals grew from a bootstrapped order-entry tool to 100+ distributors and a $35M round; Conexiom raised $130M earlier and partners with Epicor. Quiet niches (dental-lab comms, coaching tools) are quiet because the dollars are small.
2. The crowd is upmarket or single-ERP. Canals/Conexiom/Esker/Workist run implementation-led sales to mid-market and enterprise on Epicor/Infor/SAP. The SMB entrants are each tied to one ERP (OrderDrafter → Prophet 21 only; Logistify → QuickBooks Desktop) or are generic parsers (ParserBee at $29/month) that stop at extraction. The **multi-ERP, self-serve, per-order, learns-per-customer** product for 10 to 200 employee companies does not exist yet.
3. The expansion path is proven by the leader. Canals' own trajectory (order entry → quotes → AP → PO tracking → AR cash application → voice) is the roadmap; you execute it for the segment they skipped.
4. ERP-vendor risk is real but bounded. Intuit's agents focus on accounting/tax; Business Central has a Copilot sales-order agent; NetSuite relies on partner apps. Vendors build "good enough" for their own system; they will not build customer-specific alias learning, multi-channel intake, exception workflows, or cross-ERP coverage. Mitigation is in §4.5.

If the first six weeks of validation (§5) do not produce the signals in §4.6, move to Alternate B without sentiment.

---
## 4. The pick in depth

### 4.1 One-line thesis
"Every order your customers send you, in whatever messy format, becomes a correct sales order in your ERP within a minute, and your team only touches the exceptions."

### 4.2 Ideal customer profile (ICP)
- **Company:** wholesale distributor or light manufacturer, 10 to 200 employees, $5M to $150M revenue, receiving **30+ customer orders per day** by email/PDF/spreadsheet/fax/phone (i.e., not already 90% EDI or portal).
- **Systems:** QuickBooks Online (with the new Sales Order API) or QuickBooks Desktop/Enterprise, NetSuite, Acumatica, Odoo, Fishbowl, Katana, Cin7, Zoho Inventory, SAP Business One, Sage 100/Intacct. Launch order in §6.5.
- **Verticals (beachheads):** electrical supply, plumbing/HVAC/PVF supply, industrial MRO and fasteners, packaging and jan-san supplies, building materials, food and beverage distribution, auto and truck parts, medical and dental supply, specialty chemicals and lubricants, promo products, apparel/footwear wholesale, and contract/job-shop manufacturers who receive customer POs.
- **Buyer and champion:** owner/GM or VP Operations buys; customer-service/inside-sales lead champions; controller cares about accuracy and ERP integrity.
- **Geography:** US and Canada first (largest WTP, English documents), then UK/Ireland, Australia/New Zealand; EU (multilingual) in year 2 with e-invoicing hooks.
- **Disqualifiers:** <15 document orders/day; orders that are mostly custom-engineered with no item master; ERP with no API and no file import path; companies mid-migration of ERP.

### 4.3 The pain, quantified
- Manual order entry costs 5 to 15 minutes per order; a CSR handles ~40 to 80 orders/day. At 100 orders/day a company runs 1.5 to 3 FTEs ($45k to $65k each fully loaded) on rekeying.
- Manual entry error rates in supply-chain operations reach ~4%; each error produces returns, credits, re-ships and angry customers. Distributors on manual processes frequently run DSO above 55 days.
- Industry benchmarking cites $75k to $180k/year of labor-efficiency gains for a $50M distributor from automating order processing and data entry.
- Customers complain about it in public: "Catalog matching and quote generation across messy part numbers" is one of the two widest measured gaps in vertical software.

### 4.4 Competitive map (November 2026)

| Tier | Players | Who they serve | Pricing | Weakness you exploit |
|---|---|---|---|---|
| Enterprise order automation | Conexiom (Epicor partnership, $130M raised), Esker, Go Autonomous, OroCommerce SmartOrder | Large distributors/manufacturers on Epicor, Infor, SAP, Oracle | Quote-based; per-trading-partner or per-document; months to implement | Too heavy and expensive below ~$100M revenue; template/mapping maintenance |
| Venture-backed mid-market suites | Canals (100+ distributors, $35M Series A May 2026), Morsa, Proton.ai (CRM-led), Workist (DACH/EU), Endeavor (voice-to-order), Fluent (Epicor agents) | Mid-size distributors; sales-led | Quote-based; annual contracts | Sales-assisted onboarding; mid-market focus; limited SMB ERP coverage |
| SMB point tools | OrderDrafter ($399 to $799/mo flat, Prophet 21 only), Ordermatic (3 people), Logistify (QuickBooks Desktop), Y Meadows (free to 50 orders/mo), WizCommerce (B2B commerce + order AI), Anchor Group SO Automation (NetSuite partner app) | 5 to 50 employee shops on one ERP | $300 to $800/mo or bundled | Single-ERP; thin product; no customer-alias learning; no expansion modules; limited distribution |
| Generic document AI | ParserBee ($29/mo), Nanonets, Rossum, Docsumo, Klippa | Anyone with PDFs | Per page | Stop at extraction; no item matching, pricing, stock, ERP posting, or exception workflow |
| ERP-native features | Intuit AI agents + Sales Order API (Oct 2026), Microsoft Business Central Copilot sales-order agent, NetSuite partner apps | Their own installed base | Bundled | Single-system, generic matching, no multi-channel intake, slow roadmap for SMB edge cases |

### 4.5 Moat plan (what compounds and what does not)
Model access is not a moat; everyone calls the same APIs. The defensible assets are:
1. **Per-customer memory.** Every correction a CSR makes becomes a durable alias (customer part number → SKU, UoM conversions, ship-to nicknames, pack rounding rules). After 60 days a customer's touchless rate is high *because of data only you hold*. Switching means retraining the robot.
2. **Integration depth across the long tail of SMB ERPs.** Each connector is tedious and each one widens the market (and the partner channel) while narrowing the field of competitors who can serve the account.
3. **Exception workflow and audit trail.** Controllers buy the audit log and the approval rules as much as the AI.
4. **Distribution relationships.** Marketplace listings, VAR referral agreements and trade-association presence are slow to build and slow to displace.
5. **Data network effects later:** anonymized part-number normalization across manufacturers' catalogs (an MPN graph) improves matching for every new customer and is the foundation for the quoting module.

### 4.6 Validation kill criteria (decide by end of week 6)
Proceed only if all three hold:
- **20 qualified conversations** completed with ops/CS leaders at ICP companies (not friends).
- **At least 8 of 20** confirm ≥1 FTE on manual order entry **and** state a price they would pay ≥$500/month unprompted or when anchored against a hire.
- **3 paid pilots or signed LOIs** (minimum $300/month or $1,500 one-off pilot) with access to 100+ historical POs each.
If two of three fail, switch to Alternate B (§11.1) and rerun this gate.

---

## 5. Validation sprint (weeks 0 to 6)

**Goal:** prove pain + price + access before writing production code. Run the prototype pipeline in parallel so you can show real results from their own documents by week 3.

### 5.1 Build the prospect list (week 0 to 1)
- Sources: LinkedIn Sales Navigator (titles: Customer Service Manager, Inside Sales Manager, Operations Manager, Controller; industry: Wholesale; 11 to 200 employees), distributor association member directories (NAW affiliates: NAED, ASA, PTDA, ISA, STAFDA, NAFCD, IDEA), MDM and Distribution Strategy Group lists, Epicor/Acumatica/NetSuite/QuickBooks Enterprise partner customer logos, Google Maps queries ("electrical supply" + metro) for owner-operated firms.
- Target 400 accounts, 800 contacts. Track in a simple CRM (Attio, folk, HubSpot free, or a Postgres table you query with Claude Code).

### 5.2 Outreach (weeks 1 to 4)
Email + LinkedIn, 3-step sequence, founder voice, no automation tools that look automated.

Step 1 (plain text):
> Subject: how many POs does your team rekey a day?
> Hi {first}, I'm building a tool that turns emailed/PDF customer POs into {ERP} sales orders automatically, with your team only checking exceptions. Before I build more I'm talking to 20 ops leaders at {vertical} distributors. Could I get 20 minutes to learn how orders come in at {company}? Happy to run 50 of your real POs through it afterward and show you the accuracy, no charge.

Step 2 (3 days later): one-line follow-up with a 60-second screen recording of a messy PO becoming a draft order.
Step 3 (5 days later): "closing the loop" + offer of a one-page ROI calc for their volume.

Targets: 20 to 25% reply, 20 completed calls from ~120 contacted.

### 5.3 Discovery call script (20 minutes)
1. Walk me through the last order that came in by email. Who touched it, where did it go, how long did it take?
2. What percentage of orders arrive by EDI / portal / email+PDF / phone / fax?
3. How many people spend most of their day on order entry? What happens when one is sick?
4. What breaks: wrong part, wrong UoM, pricing mismatch, duplicate POs, ship-to confusion?
5. What does an entry error cost you (re-ship, credit, lost customer)?
6. Which ERP, which version, who administers it, has anyone tried automation before (and why did it stall)?
7. If this worked for 80% of orders untouched, what would you do with the time? What would you pay a month? (Anchor: "a part-time clerk is roughly $2,500/month.")
8. Would you send me 100 recent POs (anonymized if needed) so I can show you results next week?

Log every call in `docs/research/calls/YYYY-MM-DD-company.md` with verbatim quotes. Claude Code can synthesize themes weekly.

### 5.4 Prototype proof (weeks 2 to 5)
Build the extraction + matching core from §6.6 as a CLI/notebook, run each prospect's 50 to 100 POs against an exported item/customer list, and send them a one-page accuracy report (fields right, lines matched, exceptions flagged, estimated minutes saved). This is your demo and your sales asset.

### 5.5 Convert (weeks 4 to 6)
Offer a 60-day paid pilot: $300 to $500/month (or $1,500 one-off), shadow mode for 2 weeks, then live posting with CSR confirmation, success criteria agreed in writing (touchless rate, accuracy, minutes saved). Design-partner terms: pricing locked for 24 months, logo and case-study rights, weekly 30-minute feedback call.

---

## 6. Product specification

### 6.1 Jobs to be done
1. "Get this order into the ERP correctly without me retyping it."
2. "Tell me only about the orders that need a human."
3. "Prove to my controller that nothing was posted wrong."
4. "Confirm the order back to the customer fast so they stop calling."
5. (Expansion) "Quote this RFQ at the right price in minutes." / "Answer 'where's my order' without a human." / "Chase late payments politely and relentlessly." / "Capture supplier invoices and three-way match."

### 6.2 MVP scope (what ships in Phase 2, §7.5)
**In:**
- Tenant-specific intake address (orders@{tenant}.yourdomain) and manual upload; email body + attachments (PDF, images, XLSX/CSV, DOCX); multi-order emails split into separate orders.
- Extraction to a strict order schema with per-field confidence.
- Customer identification (sender domain, bill-to/ship-to text, PO header) with manual override and learning.
- Line matching with layered strategy (§6.6) and per-customer alias memory.
- Validation against ERP: item exists/active, price vs price list/contract (tolerance configurable), stock availability, UoM/pack rounding, min order, credit hold, duplicate PO number.
- Review queue UI: split screen (source document left, draft order right), inline edit, one-click confirm, reject with reason; keyboard-first.
- Posting to ERP as sales order (draft/unapproved status if ERP supports it) with document attached and a link back.
- Customer acknowledgment email (templated, editable, optional auto-send when fully touchless).
- Rules engine: per-customer auto-post thresholds (e.g., auto-post when all lines ≥0.98 confidence and price within 2%).
- Audit log of every field change and who/what made it.
- Dashboard: orders processed, touchless %, line accuracy, time saved, exceptions by type, by customer.
- Integrations at MVP: **one ERP end-to-end** (choose by design-partner mix; QuickBooks Online with Sales Order API or NetSuite are the best first choices), plus a universal CSV/IIF/Excel export fallback so any prospect can pilot.

**Out (MVP):** voice intake, customer portal, quoting, AP, EDI replacement, mobile app, multi-language documents, SSO (offer in Growth tier later).

### 6.3 Core user flows
1. **Onboarding (target <60 minutes to first draft order):** connect ERP (OAuth or credentials) → sync items, customers, price lists, ship-tos → forward orders@ address or upload 20 historical POs → review first drafts → set auto-post thresholds (default: off).
2. **Daily loop:** inbox → "Needs review" (exceptions) / "Posted" / "Rejected" → confirm or fix → posted → acknowledgment sent → customer alias learned.
3. **Exception handling:** unknown item → suggest top 3 matches with evidence → user picks or creates → stored as alias; price mismatch → show list vs PO price, policy choice (honor PO / use list / hold); stock short → backorder/partial per tenant policy; duplicate → link to original.
4. **Admin:** users and roles, rules, templates, integration health, usage and billing.

### 6.4 Non-functional requirements
- Accuracy target after 30 days per customer: ≥99% line-level accuracy on confirmed orders; ≥70% touchless rate at 60 days for email/PDF orders.
- Latency: draft order within 60 seconds of receipt (P95 < 3 minutes).
- Reliability: at-least-once processing with idempotency keys (message-id + attachment hash); no duplicate posts.
- Security: tenant isolation (Postgres row-level security), encryption at rest and in transit, least-privilege ERP scopes, secrets in a vault, audit log immutability, no training on customer data, data-retention controls, DPA template, SOC 2 Type I by month 12 (Vanta/Drata/Sprinto when revenue justifies).
- Cost: model + OCR cost per order < $0.10 at MVP, < $0.05 at scale (prompt caching, smaller models for classification, batch for backfills).

### 6.5 Integration roadmap
1. **Phase 2 (MVP):** QuickBooks Online (OAuth2; Sales Order API announced Oct 2026, verify GA status and scopes) **or** NetSuite (SuiteTalk REST + RESTlet for custom logic, token-based auth). Pick the one your first 3 design partners run. Universal CSV/Excel export always on.
2. **Phase 3:** the other of the two; QuickBooks Desktop/Enterprise via a bridge (Web Connector or a third-party QBD API such as Conductor); Acumatica (contract-based REST API).
3. **Phase 4:** Odoo (JSON-RPC), Fishbowl, Katana, Cin7, Zoho Inventory.
4. **Phase 5:** SAP Business One (Service Layer), Sage 100/Intacct, Epicor Prophet 21 / Eclipse (partner program), Infor CSD.
5. Consider unified APIs (Merge, Apideck, Codat) for read-side accounting objects to accelerate coverage; sales-order writes usually need direct connectors.

### 6.6 AI pipeline design (the heart of the product)
```
Inbound (email/upload) → Normalize (split orders, dedupe, extract attachments, render PDF pages to images, OCR fallback for scans)
→ Classify (order / quote request / status inquiry / remittance / spam) 
→ Extract (LLM with tool-use/JSON schema: header, parties, dates, terms, lines[]; per-field confidence; page/line provenance)
→ Identify customer (deterministic: sender domain, customer PO patterns → candidates; LLM disambiguation only if needed)
→ Match lines (layered):
    L0 exact SKU / UPC / MPN in item master
    L1 per-customer alias table (learned)
    L2 trigram similarity (pg_trgm) + token rules (strip dashes, packs, UoM)
    L3 vector similarity (pgvector) over item descriptions
    L4 LLM re-rank of top-k with document context; abstain below threshold
→ Validate against ERP (price, stock, UoM, min qty, credit, duplicates) → Rules → Draft
→ Human review (exceptions only) → Post to ERP → Acknowledge → Learn (write aliases, update thresholds)
```
Design rules:
- Deterministic before probabilistic; the LLM is the last resort for each decision, which keeps cost and variance low.
- Every extracted value carries confidence + provenance (page, bounding box or line text) so the UI can highlight it.
- Abstention is a feature: flagging beats guessing. Touchless rate rises through learning, not through lower thresholds.
- Golden datasets per tenant: the first 50 confirmed orders become the regression set; every prompt or model change must not regress field-level accuracy (`docs/EVALS.md`).
- Shadow mode: new tenants run 2 weeks with posting disabled; results reported as a before/after.
- Use the Anthropic API via the official SDK. Use a stronger model for extraction/re-ranking and a smaller, cheaper model for classification and routing; use tool use for schema-constrained JSON, native PDF/image input for documents, prompt caching for the item-master context, and the Batch API for backfills. Model IDs, limits and pricing change; take them from https://docs.claude.com rather than from this document.

### 6.7 Data model (core tables)
`tenants, users, memberships(role), integrations(type, credentials_ref, status), sync_runs,
items(tenant_id, erp_id, sku, upc, mpn, description, uom, pack, active, embedding), customers(erp_id, name, domains[], terms, price_list_id), ship_tos, price_lists, price_list_items,
inbound_messages(message_id, from, subject, received_at, raw_ref), documents(message_id, filename, hash, pages, ocr_ref),
orders(tenant_id, document_id, customer_id, status[new|needs_review|confirmed|posted|rejected], po_number, dates, totals, confidence, erp_order_id, posted_at),
order_lines(order_id, raw_text, qty, raw_uom, raw_price, matched_item_id, match_method, confidence, resolved_by),
aliases(tenant_id, customer_id, raw_part, raw_desc_pattern, item_id, uom_factor, created_from_order_line_id),
rules(tenant_id, customer_id?, type, params_json), events(audit: actor, entity, before, after, at),
usage_meters(tenant_id, period, orders_posted, orders_touchless), subscriptions, invoices.`

### 6.8 Expansion modules (post-MVP, in order)
1. **Order-status agent:** reads "where is my order" emails, answers from ERP shipment data, escalates when unsure. Charges per resolved inquiry.
2. **Quote agent:** RFQ → priced quote using price lists, contract pricing, margin floors, substitutions; sends PDF; converts to order on acceptance. Priced per quote.
3. **Supplier PO acknowledgment tracking:** reads vendor confirmations, flags date/price changes.
4. **AR follow-up agent:** statement reconciliation and polite dunning sequences; per invoice collected or flat.
5. **AP capture and 3-way match:** vendor invoices into the ERP.
6. **Customer portal + payments:** self-serve reorders with contract pricing; embedded payments and net-terms financing partnerships (fintech revenue; this is how vertical SaaS reaches 112% NRR).
7. **Voice:** call transcription → order draft (partner with a voice platform rather than build telephony).

---
## 7. Technical architecture and Claude Code build plan

### 7.1 Stack (opinionated, boring where it should be)
| Layer | Choice | Why |
|---|---|---|
| Web app | Next.js (App Router) + TypeScript + Tailwind + shadcn/ui | One codebase for marketing site, app and API routes; Claude Code is strong here |
| Database | Postgres (Neon or Supabase) + Drizzle ORM; extensions `pg_trgm`, `pgvector` | Matching layers L2/L3 live in the DB; RLS for tenant isolation |
| Auth | Clerk (orgs/roles) or Auth.js | Multi-tenant orgs, invitations, roles without building it |
| Background jobs | Inngest or Trigger.dev | Durable, retryable, step-based pipeline; idempotency; scheduled syncs |
| Inbound email | Postmark Inbound (or Mailgun Routes / Resend Inbound) | Reliable parsing of attachments, webhooks, per-tenant addresses |
| Outbound email | Resend or Postmark | Acknowledgments, digests; configure SPF/DKIM/DMARC on a sending subdomain |
| Object storage | Cloudflare R2 or S3 | Raw emails, documents, rendered pages |
| Document processing | `pdf-to-image` rendering (pdfium/poppler), OCR fallback (AWS Textract or Google Document AI) | Native PDF to the model when text-based; OCR when scanned |
| LLM | Anthropic API (official SDK) | Tool-use JSON, document/vision input, prompt caching, batch; see docs for current models |
| Evals/observability | Langfuse or Braintrust (traces + datasets), Sentry (errors), PostHog (product analytics) | Field-level accuracy regression is a release gate |
| Billing | Stripe Billing: subscription + usage meters (orders posted) | Hybrid pricing in §8 maps directly |
| Hosting | Vercel (app) + Neon (DB) + Inngest cloud; or Railway/Fly if you prefer one bill | Zero-ops at the start |
| Infra as code | Later (Terraform/Pulumi) when SOC 2 starts | Not needed pre-revenue |

### 7.2 Repository layout
```
/apps/web            Next.js app (marketing, app, API routes, webhooks)
/packages/core       domain types, order schema (zod), matching engine, rules engine
/packages/extract    document normalization, prompts, model clients, confidence scoring
/packages/erp        connector interface + implementations (quickbooks, netsuite, acumatica, odoo, csv)
/packages/db         drizzle schema, migrations, RLS policies, seed
/packages/evals      golden datasets, scorer, regression runner (CI gate)
/docs                MASTER_PLAN.md (this), DECISIONS.md, EVALS.md, research/, runbooks/
/scripts             one-off CLIs (import item master, replay a PO, backfill)
```

### 7.3 Engineering principles for an AI pipeline product
1. Schema first: `OrderDraft` zod schema is the contract between extraction, matching, UI and connectors.
2. Every pipeline step is a pure function with a persisted input/output; replayable from stored artifacts.
3. Connectors implement one interface (`syncItems`, `syncCustomers`, `syncPrices`, `checkStock`, `createSalesOrder`, `attachDocument`); CSV export is a connector too.
4. Prompts are versioned files in `/packages/extract/prompts/*.md` with changelogs; no inline prompt strings.
5. No release without the eval gate: field accuracy ≥ previous release on the golden set; cost per order ≤ budget.
6. Feature flags per tenant (auto-post, modules) via a simple `tenant_settings` JSON until you need a flag service.

### 7.4 `CLAUDE.md` template (place at repo root)
```markdown
# DESK — AI order desk for distributors

## What this is
Read docs/MASTER_PLAN.md §1, §4, §6 before any product work. We are in **Phase {N}** (see §7.5).
Current phase goal: {paste phase goal}.

## Non-negotiables
- Tenant isolation: every query is scoped by tenant_id; RLS policies in packages/db must not be bypassed.
- Pipeline steps are pure, persisted, replayable (docs/MASTER_PLAN.md §7.3).
- Prompts live in packages/extract/prompts; bump version + changelog on any change.
- Run `pnpm evals` before proposing a merge that touches extract/, core/matching, or prompts. Report accuracy delta and cost per order.
- Never post to a real ERP from tests; use the mock connector and recorded fixtures.
- No secrets in code; use env + vault references.

## Commands
pnpm dev · pnpm test · pnpm evals · pnpm db:migrate · pnpm lint · pnpm typecheck

## Conventions
TypeScript strict; zod schemas in packages/core are the source of truth; server actions for mutations; Inngest functions for anything >2s or external I/O; conventional commits.

## Where things are
See docs/MASTER_PLAN.md §7.2. Decisions: docs/DECISIONS.md. Eval results: docs/EVALS.md.

## Working style
Plan first for any multi-file change; list files you will touch; write tests alongside; ask before adding dependencies.
```

### 7.5 Build phases (each is a Claude Code work packet)

**Phase 0 — Foundations (week 1 to 2)**
Goal: monorepo, auth, tenant model, DB with RLS, CI, deploy pipeline, marketing placeholder with waitlist.
Tasks: scaffold Turborepo + Next.js; Drizzle schema for tenants/users/memberships; RLS policies and tests proving isolation; Clerk orgs; Stripe customer creation on org create; Vercel preview deploys; GitHub Actions (lint, typecheck, test, evals stub); Sentry + PostHog; landing page with problem statement and "run 50 of your POs free" CTA.
Done when: new org can sign up, invite a user, and nothing leaks across orgs in tests; CI green; deployed.

**Phase 1 — Extraction and matching core as CLI (weeks 2 to 5, parallel with validation)**
Goal: `pnpm replay --tenant X --file po.pdf` produces an `OrderDraft` with confidences, matched against an imported item/customer CSV, and an accuracy report against a labeled set.
Tasks: `OrderDraft` zod schema; document normalizer (PDF → text/images, XLSX/CSV, images, multi-order splitting); extraction prompt v1 with tool-use JSON; confidence scoring; item importer; matching layers L0 to L4 with explainable match evidence; per-customer alias table; golden-set format and scorer; cost tracker per document; report generator (markdown/PDF for prospects).
Done when: ≥95% field accuracy and ≥90% line-match accuracy on a 100-document mixed golden set; cost per document < $0.15; reports sent to 5 prospects.

**Phase 2 — MVP app + first ERP (weeks 5 to 12)**
Goal: design partners process live orders daily.
Tasks: inbound email webhooks → durable pipeline (Inngest); review queue UI (split-screen, keyboard shortcuts, inline edits, confirm/reject); ERP connector #1 (sync items/customers/prices, stock check, create sales order, attach doc); CSV export connector; rules engine (auto-post thresholds, price tolerance, duplicate detection); acknowledgment emails; audit log; dashboard; onboarding wizard; usage metering → Stripe; shadow-mode toggle; weekly tenant digest email.
Done when: 3+ tenants live, touchless ≥50% by week 4 of use, zero duplicate posts, P95 latency < 3 min, NPS collected.

**Phase 3 — Learnability, reliability, second ERP (months 4 to 6)**
Goal: raise touchless rate to 70%+ and widen the funnel.
Tasks: alias learning from every correction; UoM/pack intelligence; customer-specific templates detection; ERP connector #2 (+ QuickBooks Desktop bridge if partners need it); SOC 2 prep (policies, logging, access reviews); role-based permissions; API tokens for customers' own automations; public pricing page + self-serve checkout; in-app ROI report for champions to forward to owners.
Done when: 15 to 25 paying tenants; GRR 100% in the cohort; self-serve signup → first draft order < 60 minutes without founder help in 50% of cases.

**Phase 4 — Expansion modules and channels (months 6 to 12)**
Goal: ARPA up, CAC down.
Tasks: order-status agent; quote agent v1; connectors #3 and #4; marketplace listings (QuickBooks App Store, NetSuite SuiteApp, Acumatica Marketplace); partner portal for VARs (referral tracking, co-branded onboarding); customer-facing shareable accuracy reports; data-export and retention controls; SOC 2 Type I audit.
Done when: $40k to $60k MRR, ≥2 modules attached to ≥30% of tenants, ≥20% of new logos from partners.

**Phase 5 — Scale (months 12 to 24)**
Goal: $250k+ MRR trajectory.
Tasks: AR agent, AP capture, portal + payments (fintech partner), voice intake partner, EU languages + e-invoicing output formats (Factur-X/XRechnung/Peppol via a certified provider), enterprise features (SSO, SLAs), Epicor/Infor connectors via partner programs; data platform for MPN normalization graph.
Done when: NRR ≥115%, GRR ≥92%, CAC payback <12 months, gross margin ≥75%.

### 7.6 Testing and evals
- Unit tests for normalizers, matchers, rules; property tests for idempotency.
- Connector contract tests against recorded fixtures; a sandbox account per ERP.
- Eval harness: datasets by tenant and by document type (clean PDF, scanned, Excel, email body, handwritten photo); metrics: header field accuracy, line recall/precision, match accuracy, false-auto-post rate (must be ~0), cost, latency. Results appended to `docs/EVALS.md` by CI.
- Red-team set: adversarial POs (merged cells, multi-page totals, substitutions, "same as last time" orders, cancellations disguised as orders).

---

## 8. Pricing and packaging

### 8.1 Principles
- Price against the labor line (a part-time clerk ≈ $2,000 to $3,000/month), not against software budgets.
- Hybrid: platform fee (predictability for you) + per-posted-order usage (alignment for them). Count only orders that reach the ERP; never charge for failed or rejected documents.
- Publish prices. SMB buyers self-qualify; the upmarket players cannot copy transparency without breaking their sales motion.
- Annual prepay discount 15 to 20%; design partners locked 24 months.

### 8.2 Launch price card (US; adjust for other markets)
| Plan | Platform fee | Included orders/mo | Overage | Fits |
|---|---|---|---|---|
| Starter | $299/mo | 150 | $1.50/order | 1 ERP connection, 3 users, email intake, review queue |
| Growth | $799/mo | 600 | $1.00/order | + auto-post rules, acknowledgments, alias learning insights, 10 users |
| Scale | $1,999/mo | 2,500 | $0.60/order | + multi-entity, API, SSO (later), priority support, dedicated onboarding |
| Modules | +$199 to $499/mo each or per-outcome (e.g., $0.75/status inquiry resolved, $2/quote sent) | | | Order-status, Quote, AR, AP |
| Onboarding | $0 self-serve; $1,500 to $5,000 guided for Scale/complex ERPs | | | |

Target blended ARPA: ~$900 at month 12, ~$1,500 at month 24 (modules + volume growth). Unit economics: model + OCR < $0.10/order; infra per tenant < $15/month; gross margin ≥ 80% at Growth tier.

### 8.3 Pricing experiments to run early
- Per-order-only vs hybrid acceptance (expect hybrid wins on predictability for both sides).
- "Touchless-only" counting: tell prospects you charge less for orders a human had to fix; watch whether it changes trust and willingness to turn on auto-post.
- Anchor test on the pricing page: show the FTE-equivalent cost next to each plan.

---

## 9. Go-to-market and marketing (2026 rules)

### 9.1 Positioning and naming
- Category: "AI order desk" (own the phrase; it is concrete and not yet claimed by the enterprise players who say "sales order automation" or "intelligent document processing").
- Promise: "Every customer order into your ERP in a minute, touched only when it should be."
- Proof: live accuracy counter, public case studies with touchless % and hours saved, a free "run 50 of your POs" audit.
- Naming: short, pronounceable, .com or .ai available, no conflict in USPTO/EUIPO databases, not generic ("OrderDesk" variants are likely taken; generate 50 options, shortlist 5, check trademark classes 9 and 42).

### 9.2 Channel plan by stage
**Stage 1 (0 to 25 customers): founder-led sales**
1. Outbound from §5 continues at 40 new contacts/day; the free PO audit is the offer.
2. Founder LinkedIn: 3 posts/week showing ugly real-world POs (anonymized) becoming orders; weekly "order desk teardown"; comment daily in distributor and ERP-consultant conversations. LinkedIn is the dominant B2B channel in 2026; informational blog traffic is not.
3. Two or three regional trade events (NAW affiliate chapters, ERP user groups) with a laptop demo on their documents.

**Stage 2 (25 to 150 customers): partners + bottom-of-funnel search**
4. ERP ecosystems: QuickBooks App Store, NetSuite SuiteApp, Acumatica Marketplace, Odoo apps; integration-page SEO ("AI order entry for Acumatica"); co-marketing webinars with VARs; 15 to 20% referral fee for 12 months to consultants who bring accounts.
5. Comparison and alternative pages (commercial intent survives AI Overviews): "Conexiom alternative for small distributors", "Canals vs {you}", "AI order entry for QuickBooks Enterprise", one page per vertical ("for electrical distributors").
6. Review sites: G2, Capterra, GetApp listings with a review-collection cadence after each successful onboarding; these feed AI assistants' vendor answers.
7. AI-search optimization: FAQ-structured pages, a public pricing page, machine-readable product facts (schema.org, an `llms.txt`), third-party mentions in industry publications; measure citations in ChatGPT/Claude/Perplexity/Gemini monthly.
8. Industry media: MDM, Distribution Strategy Group, Industrial Distribution, Modern Distribution Management webinars; contribute data ("we processed 1M lines: the 12 ways customers write part numbers").

**Stage 3 (150+ customers): sales team + programs**
9. Hire 2 AEs with distribution or ERP-channel backgrounds and 1 partner manager; outbound SDR motion with AI-assisted research; account-based campaigns to distributor groups (AD, IMARK, Affiliated Distributors members) and buying groups.
10. Customer referral program (one month free per referral), regional user meetups, annual benchmark report ("State of the Order Desk").
11. Paid: Google Search on bottom-of-funnel terms only (brand, competitor, "{ERP} order automation"); LinkedIn lead-gen with a real asset (ROI calculator, benchmark report), tight ICP targeting.

### 9.3 Sales process and assets
- Demo → free audit on their documents (the conversion lever) → paid pilot (shadow then live) → annual.
- Assets: one-page ROI calculator (orders/day × minutes × loaded wage), security one-pager, integration one-pagers per ERP, case studies with numbers, a 7-minute recorded demo, mutual action plan for pilots.
- Metrics to track from day one: reply rate, calls booked, audit sent, pilot started, pilot → paid (target >50%), sales cycle (target <30 days), CAC by channel, payback.

### 9.4 Launch sequence (first 12 months)
- Month 1: website + waitlist + outbound; 20 discovery calls; 5 audits.
- Month 2 to 3: 3 to 5 design partners live; first LinkedIn teardown series; first ERP marketplace application.
- Month 4: public launch (Product Hunt is secondary for this ICP; LinkedIn, industry newsletters and the marketplace listing matter more); public pricing; G2/Capterra live; 2 case studies.
- Month 5 to 8: second ERP; partner program; comparison pages; first webinar with a VAR; 20+ customers.
- Month 9 to 12: modules; SOC 2 Type I; first paid search; 40 to 70 customers; $40k to $60k MRR.

### 9.5 Retention and expansion motion
- Weekly digest to champions ("you saved 31 hours; touchless 74%"); quarterly ROI letter to the owner.
- Health score: touchless trend, review-queue latency, login frequency of champion, ERP sync errors; CS outreach when any degrades.
- Expansion triggers: ≥500 orders/mo → Scale; many "where is my order" emails detected → order-status module; RFQ emails detected → quote module. Let the product surface the upsell with evidence.

---

## 10. Operating plan, metrics and milestones

### 10.1 Targets (plan vs top-decile reference)
| Milestone | Plan | Top-decile reference |
|---|---|---|
| First paying customer | Month 2 | — |
| $10k MRR | Month 6 | — |
| $1M ARR (~$83k MRR) | Month 14 to 18 | 9 months from first revenue |
| $3M ARR | Month 24 to 30 | — |
| $10M ARR | Year 4 | ~2y9m from first revenue |
| $25M ARR (top ~1 to 2%) | Year 5 to 6 | — |

Operating benchmarks to hold: logo churn <1%/month, GRR ≥92%, NRR ≥115% by month 18, CAC payback <12 months, gross margin ≥75%, touchless ≥70% at 60 days, pilot→paid ≥50%, Rule of 40 ≥40 once past $3M ARR.

### 10.2 Team and capital
- Months 0 to 6: founder(s) + Claude Code; optional part-time designer; outsourced SOC 2 tooling later.
- Months 6 to 12: 1 full-stack engineer (connectors), 1 customer success/onboarding lead, 1 partner/sales hire if MRR >$30k.
- Capital: bootstrappable to ~$50k MRR (Canals did this). Raise only to accelerate connectors and sales after pilot→paid and NRR are proven; AI-native vertical SaaS commands 10 to 15x revenue multiples in 2026 when metrics are strong, so raising later is cheaper. Revenue-based financing is an option at $50k+ MRR.

### 10.3 Monthly review checklist
1. Kill-criteria/health: §4.6 early, then the §10.1 benchmarks.
2. Eval report: accuracy and cost trend; any regression → fix before features.
3. Pipeline: calls, audits, pilots, conversion, cycle length.
4. Churn interviews: every lost or at-risk tenant gets a call and a written cause.
5. Roadmap: one capability that raises touchless rate, one that raises ARPA, one that widens the funnel (ERP).

### 10.4 Risks and mitigations
| Risk | Mitigation |
|---|---|
| ERP vendors ship native order capture | Multi-ERP coverage, per-customer learning, exception workflow, modules; position as the desk across systems, not a feature of one |
| Well-funded competitors move down-market | Speed, self-serve, transparent pricing, partner channel loyalty; they cannot drop implementation-led sales without breaking their model |
| LLM cost or latency spikes | Deterministic-first pipeline, caching, smaller models for routing, batch backfills, per-tenant budgets |
| Accuracy incidents damage trust | Shadow mode, abstention thresholds, never auto-post below confidence, audit log, fast rollback, incident comms template |
| Long sales cycles with owners | Free audit on real documents compresses cycles to weeks; pilots are paid to filter tire-kickers |
| Data security objections | SOC 2 roadmap, DPA, no-training clause, regional hosting on request |
| Founder bandwidth | Phase gating; one ERP at a time; say no to custom work unless it generalizes |

---

## 11. Alternates (only if §4.6 fails)

### 11.1 Alternate B — "Get paid" agent for construction subcontractors
Pay applications (AIA G702/G703 and GC-specific formats), lien waivers, compliance documents (COIs, W-9s, certified payroll), change-order tracking, collections. Leader Siteline (~$18M raised, no round since 2022, 23k+ form templates from 17k GCs, ~$180M annualized billing) is proof of value and of a moat you would need to rebuild; Knowify/Flashtract/Billd/TrustLayer are adjacent. Whitespace: small trade subs on QuickBooks/Excel, state-law-aware waiver automation, AI reading GC contracts for billing rules. Risks: Procore Pay bundling, 50-state legal nuance, liability. Would score higher for a founder with construction access.

### 11.2 Alternate C — AI governance and compliance for 10 to 250 employee EU companies
AI inventory (shadow AI discovery), Article 4 literacy training and tracking, Article 50 transparency checks, ISO 42001-lite controls, Annex IV documentation for the few high-risk cases, vendor AI risk questionnaires. Tailwind: Article 50 live since August 2026; high-risk deferred to Dec 2027/Aug 2028. Risks: deferred deadlines dull urgency; Vanta/Drata add frameworks; SME entrants (SetAIComply €39/mo) exist. Works best bundled with GDPR/ISO 27001 for SMBs and sold through accountants/IT MSPs.

### 11.3 Ideas explicitly rejected (do not revisit without new evidence)
Agent infra, SMB support bots, AI receptionists, insurance/freight/accounting-firm agents, appointment-reminder AI, GEO tooling, property-management AI, e-invoicing micro-SaaS. See §3 for the reasons.

---

## 12. Sources consulted (November 2026)
Benchmarks: Benchmarkit 2026 (via Aleph, Digital Applied), SaaS Capital 2026 (via Array Capital, Acquire.com), The SaaS CFO 2026 Benchmarks Report, SaaSRise 2026 report, G-Squared CFO, High Alpha 2025, ChartMogul SaaS Growth Report and "The Odds of Making It" (Kyle Poyar), BetterCloud 2026 State of SaaS.
Pricing shift: Deloitte TMT Predictions 2026 (via Userpilot, SoftwareSeni), Cruxy CEO survey (via Userpilot), Gartner (via CRN, Entagl), Intercom/Zendesk/Sierra pricing coverage (Built In, MPT), Gupta Deepak on AI-native pricing.
Vertical AI: Bessemer "Building Vertical AI" (Jan 2026), SaaS Mag (vertical agents, vertical vs horizontal), Index Ventures/TechCrunch, BigIdeasDB vertical gap scoring (Aug 2026), Superframeworks, Preuve, Blanche Agency, Nurture Technologies, HyScaler.
Distribution/marketing: Unil.ink SaaS channels 2026, GrackerAI, TripleDart, Whitehat SEO (SparkToro/Similarweb/Pew data), Fast Company/Wynter survey, 5WPR content research, Frostbite Marketing.
Category: Canals Series A coverage (MDM, Distribution Strategy, Unite.AI, Dealroom), Conexiom (Epicor partnership, Warburg Pincus), Morsa/Workist/Ordermatic/OrderDrafter/Logistify/ParserBee/Fluent/Oro comparison pages, Anchor Group NetSuite SO Automation, Apideck on Intuit Connect 2026 (Sales Order API), Microsoft Business Central Copilot release plan, NAW industry facts, Workd/Anchor Group distributor statistics.
Alternates: Siteline (Capterra, Menlo, DataDrivenAEC), Kosmoy EU AI Act tools comparison, Cloud Captains EU AI Act guide, Kubera Automation SMB AI Act plan, CSA readiness note, e-invoicing timelines (Tailride, Originstamp, SPS Commerce, Vorp Labs, e-invoice.app).
Verify any figure you quote externally against the original source; several are secondary summaries.
