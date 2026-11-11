# Architecture decisions

Newest last. Each entry: what was decided, why, and what would make us revisit it.

## D-001 Application layer as its own package (`@desk/service`)
The plan's layout (§7.2) has no home for "receive a message, build drafts, confirm, post, learn".
That logic lives in `packages/service`, takes explicit dependencies (db, blob store, model client,
mailer, connector factory) and never reads `process.env` or imports Next.js.
Why: the whole order lifecycle is tested end to end against in-process Postgres with fakes, and the
web app and the job runner call the same functions.
Revisit: never, unless the package grows a second bounded context.

## D-002 No database transaction is held while waiting on the model
`processMessage` reads and writes in short tenant transactions; catalog and validation lookups made
during matching each open their own (`ScopedCatalog`, `PgValidationContext`).
Why: extraction can take a minute; a transaction held that long pins a pooled connection and blocks vacuum.
Cost: a few extra round trips per order.

## D-003 `tenant_routes` is a global table without RLS
Maps an external key (auth organization, inbound address slug, Stripe customer, QuickBooks realm) to a
tenant id. It must be readable before a tenant context exists, so it cannot be tenant-scoped.
It holds identifiers only. Everything else stays behind RLS, including `tenants` itself.
Revisit: if a route key ever becomes sensitive on its own.

## D-004 Credentials are sealed in a `secrets` table, not an external vault (yet)
ERP OAuth tokens are AES-256-GCM encrypted with `DESK_SECRETS_KEY` and stored in the tenant-scoped
`secrets` table; `integrations.credentials_ref` holds the reference, as the schema intended.
Why: no extra vendor before revenue; the database never sees plaintext; rotation is a re-encrypt.
Revisit: at SOC 2 prep (plan Phase 3), move the key to a KMS and consider envelope encryption per tenant.

## D-005 The duplicate-PO unique index covers only `confirmed` and `posted`
Originally the index covered every non-rejected order, which made a re-sent PO fail on insert.
Now a duplicate may sit in review flagged `DUPLICATE_PO`, and the index guarantees it cannot be
confirmed while the original is confirmed or posted. "Zero duplicate posts" is enforced by the database.

## D-006 QuickBooks Online: Estimates by default, Sales Orders opt-in
Intuit launched a Sales Order API in October 2026. It is GraphQL (`salesCreateSalesOrder` at
`qb.api.intuit.com/graphql`), needs the restricted scopes `sales.sales-order.read/write`, and the
Sales Orders feature must be on in the company (Plus, Advanced, Enterprise Suite).
The connector supports both: `orderEntity: "estimate"` (Accounting REST v3, idempotent via `requestid`)
and `orderEntity: "sales_order"`.
**Not yet verified against a sandbox:** the GraphQL input field names in `buildSalesOrderInput`
(packages/erp/src/quickbooks.ts) and the attachable entity type for sales orders. They follow the
launch announcement and Intuit's other GraphQL APIs. Check them in Intuit's GraphQL explorer with a
sandbox company before offering Sales Order mode to a customer. Estimate mode uses long-stable fields.
Also unverified: whether the GraphQL endpoint honors an idempotency header. Until it is, the guard
against a double post in Sales Order mode is our own state machine (an order posts once), not Intuit.
QuickBooks Online has no units of measure and exposes one price per item, so pack factors and
contract prices come from DESK (aliases carry the unit factor; price lists can be imported later).

## D-007 Shadow mode is enforced where posting happens
The rules engine records "would have posted" on the draft (`orders.shadow_eligible`); the posting
code refuses to call the ERP while shadow mode is on. A person can still confirm in shadow mode,
which trains aliases and gives the before/after report real numbers without touching the ERP.

## D-008 Touchless means no human action at all
`orders.touchless` is true only for orders the rules engine confirmed and that had zero edits.
A one-click human confirm is not touchless. Billing counts every posted order (plan §8.1).

## D-009 Job runner is optional
With Inngest keys, inbound messages are processed by durable, retried functions. Without them the
pipeline runs in the web process after the response (`after()`), which is fine for demo and a first
pilot but loses work if the process dies mid-run (the message stays `processing` and can be retried
from the inbox). Production should set the Inngest keys.

## D-010 Demo mode
`DESK_DEMO=1` with no Clerk keys gives a single sample tenant, PGlite on disk, a mock ERP and a
rule-based offline parser (`HeuristicLlm`, text and CSV only). It exists so the product can be shown
and tested with zero accounts. It cannot be enabled when Clerk is configured.

## D-011 Units of measure are never guessed
`resolveUom` used to read any unit it did not recognize as the base unit ("10 BDL" became 10 EA).
An unrecognized unit is now a blocking `UOM_UNKNOWN` error; only a missing unit defaults to base.
Bundles were added to the synonym table and pack factors match on canonical unit names.

## D-012 Offline evals replay recorded re-rank answers
The cached golden format gained `cached.rerank` (lineNo → recorded L4 answer) so the offline gate
exercises layer 4 deterministically instead of silently skipping it. `--live --record` stores them.

## D-013 Relative imports without `.js`
Workspace packages are consumed as TypeScript source by tsx, vitest and Next. Turbopack does not map
`./x.js` to `./x.ts`, so relative imports carry no extension (`moduleResolution: Bundler`).

## D-014 The paywall gates posting, nothing else
A workspace without a live subscription may post `TRIAL_POSTED_ORDER_LIMIT` orders (default 25) to
its ERP. After that, and whenever a subscription lapses (`past_due` is a grace period), confirmed
orders are held as `confirmed` with a clear reason and post with one click once billing is fixed.
Intake, reading, matching, review and shadow mode are never limited: a prospect sees the value
before paying and a lapsed customer never loses an inbound order. Nothing is gated when Stripe is
not configured. The plan (§8) does not define a trial; this is a default to tune, including the
per-plan user limits on the price card, which are not enforced yet.

## D-015 Error reporting without an SDK
`apps/web/instrumentation.ts` logs one JSON line per failed request and, when `SENTRY_DSN` is set,
posts the event to Sentry's envelope endpoint with fetch. No request bodies, headers or query
strings are sent. Revisit when we want traces or client-side errors: then add the Sentry SDK.

## D-016 Legal pages are drafts with company details from the environment
`/terms` and `/privacy` describe what the product actually does (posting-only billing, no model
training, encrypted ERP credentials, deletion within 30 days on request). Company name, address,
contact, governing law and effective date come from `LEGAL_*` variables and render as visible
placeholders until set; `pnpm preflight` fails without them. They need a lawyer's review.
The 30-day deletion promise is carried out by hand today (docs/runbooks/LAUNCH.md).
