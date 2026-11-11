# Where the build stands

Last updated: 2026-11-12. Compare with the phases in docs/MASTER_PLAN.md §7.5.

## Phase 0 — Foundations: built
Monorepo, tenant model, Postgres with row-level security and isolation tests, Clerk organizations,
Stripe customer on organization create, CI, landing site with the audit/waitlist form.
Not done: PostHog product analytics is not wired (env names are reserved).

## Phase 1 — Extraction and matching core: built, not yet measured on real documents
`pnpm replay` produces drafts and a prospect report; matching layers L0, L1, L2 and L4 work
(L3 vector search is defined but not implemented: no embedding client yet); rules, pack/UoM logic,
golden-set format, scorer and release gate exist.
Open: the accuracy bar in the plan needs a 100-document golden set built from real prospect POs.
See the note at the top of docs/EVALS.md.

## Phase 2 — MVP app + first ERP: code complete, needs accounts and partners
| Plan task | State |
|---|---|
| Inbound email webhook → durable pipeline | Built. Postmark inbound webhook; Inngest functions, with an in-process fallback |
| Review queue UI (split screen, keyboard, inline edits, confirm/reject) | Built |
| ERP connector #1 | QuickBooks Online built against Intuit's published API; **not yet run against a sandbox company** (docs/DECISIONS.md D-006) |
| CSV export connector | Built (confirm, then download one CSV of sales orders) |
| Rules engine (auto-post thresholds, price tolerance, duplicate detection) | Built, tenant-wide and per customer |
| Acknowledgment emails | Built (template, manual or automatic send) |
| Audit log | Built (append-only table, page with before/after) |
| Dashboard | Built (processed, touchless, line accuracy, time saved, exceptions by type and customer) |
| Onboarding | Built as a live checklist on the inbox (connect, load, send, confirm, go live) rather than a separate wizard |
| Usage metering → Stripe | Built (meter event per posted order, checkout, portal, subscription and invoice sync) |
| Shadow-mode toggle | Built (on by default for new tenants) |
| Weekly tenant digest | Built (Inngest cron, plus "send now") |

Verified here: unit and integration tests for every package, and the full flow driven in a real
browser in demo mode (upload → review → fix → confirm → go live → learned alias resolves the next
order → post → acknowledge → CSV export), plus the inbound-email webhook.

Not verifiable without accounts, so untested against the real services: Clerk sign-in and
organizations, Anthropic extraction on real documents, Postmark delivery, QuickBooks OAuth and
posting, Stripe checkout and webhooks, Inngest cloud, S3/R2 storage.

Phase 2 "done when" (3+ tenants live, touchless ≥50% by week 4, zero duplicate posts, P95 < 3 min,
NPS collected) is an outcome with design partners, not code.

## Launch readiness (added 2026-11-12)
Built: plan enforcement (trial of 25 posted orders, posting held on a lapsed subscription),
Terms and Privacy pages, sign-up calls to action, `/api/health`, error reporting (logs, optional
Sentry), security headers, recovery of interrupted messages, error and loading states,
`pnpm preflight` (checks every service for real and says what blocks launch), `pnpm stripe:setup`
(creates the meter, products and prices), a manual "Migrate database" GitHub workflow.

## What to do next
Follow docs/runbooks/LAUNCH.md from the top. It is ordered, and the slow items (Intuit app review,
email domain, Stripe activation) are listed first.

## Known gaps inside Phase 2 scope
- Multi-order emails are split by the model into several drafts, but the review screen shows the whole
  source document for each (no per-order page highlighting yet).
- Scanned PDFs rely on the model's native PDF/image reading; there is no separate OCR fallback service.
- Field provenance (page and quote) is stored on every value but the document viewer does not highlight it yet.
- Ship-to matching against ERP ship-to records is not implemented; the ship-to on the PO is passed through as text.
- Roles: owner/admin can change settings and rules, everyone else can review. No per-user permissions beyond that (Phase 3).
- Per-plan user limits (3 / 10) from the price card are not enforced.
- No self-serve workspace deletion or data export beyond the orders CSV.
