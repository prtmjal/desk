# @desk/web

Next.js 16 (App Router) app for DESK: the marketing site, the application (review queue, dashboard,
settings) and the webhooks. Everything in this package builds and runs with
**no environment variables at all**; integrations switch on when their keys are present.

## Routes

| Route | What |
|---|---|
| `/`, `/pricing`, `/security`, `/llms.txt`, `/robots.txt`, `/sitemap.xml` | Marketing site (static) |
| `/sign-in`, `/sign-up` | Clerk components |
| `/app` | Inbox: metrics, onboarding checklist, orders address, upload, recent orders, exceptions |
| `/app/review`, `/app/posted`, `/app/rejected` | Order lists by state |
| `/app/orders/[id]` | Split-screen review: source document left, draft right. `c` confirm, `x` reject, `j`/`k` next/previous, `u` queue, Ctrl/Cmd+Enter confirm from a field |
| `/app/customers`, `/app/customers/[id]` | Customers, learned aliases, per-customer auto-post, CSV import |
| `/app/items` | Item master mirror, search, CSV import |
| `/app/settings`, `/app/settings/audit` | ERP connection, intake address, rules, acknowledgment template, billing, deployment status; audit log |
| `/app/setup` | Shown when a signed-in user has no organization yet |
| `POST /api/webhooks/postmark` | Inbound email → stored message → pipeline |
| `POST /api/webhooks/stripe` | Subscription and invoice sync |
| `POST /api/webhooks/clerk` | `organization.created` → tenant (+ Stripe customer) |
| `/api/inngest` | Inngest function endpoint (503 when Inngest is not configured) |
| `/api/integrations/quickbooks/connect`, `/callback` | QuickBooks Online OAuth |
| `GET /api/documents/[id]` | Source document for the review screen (tenant-scoped) |
| `GET /api/export/orders` | Confirmed and posted orders as one CSV |
| `POST /api/waitlist` | Audit/waitlist form handler |

Mutations are server actions in `app/app/actions.ts`; each one resolves the session, calls
`@desk/service`, and returns `{ ok, message }` for the UI.

## Environment variables

The full list with comments is `.env.example` at the repo root; how to obtain each value is
`docs/runbooks/SETUP.md`. Copy the file to `apps/web/.env.local` for local work.

| Switch | Variables | When unset |
|---|---|---|
| Sign-in | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `/app` shows a notice (or demo mode with `DESK_DEMO=1`) |
| Database | `DATABASE_URL` | `/app` shows a notice (demo mode uses PGlite on disk) |
| Extraction | `ANTHROPIC_API_KEY` | Messages are stored and marked failed; demo mode uses the offline parser |
| Email | `POSTMARK_SERVER_TOKEN`, `POSTMARK_INBOUND_SECRET` | Upload only; acknowledgments are skipped and say why |
| Jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Pipeline runs in the web process after the response |
| ERP | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `DESK_SECRETS_KEY` | QuickBooks button disabled; CSV export still works |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` | Billing section says it is not configured |
| Storage | `S3_*` | Documents on local disk (`.data/blobs`) |

## How gating works

- `lib/env.ts` has the predicates (`isClerkConfigured`, `isDemoMode`, `isStripeConfigured`, ...). Nothing
  else reads `process.env` for these.
- `lib/server/deps.ts` builds one `ServiceDeps` per process from the environment (database, blob store,
  model client, mailer, connector factory, usage reporter).
- `lib/server/session.ts` maps the Clerk organization to a tenant (creating it on first visit) and the
  user to a `users` row; in demo mode it returns the sample tenant.
- `lib/server/dispatch.ts` sends work to Inngest when configured, otherwise runs it with `after()`.
- `proxy.ts` (Next 16's replacement for `middleware.ts`) is `clerkMiddleware` protecting `/app(.*)` when
  Clerk is configured, a pass-through otherwise.

## Run

```sh
pnpm install
pnpm demo                          # no accounts: http://localhost:3000/app
pnpm --filter @desk/web dev        # with apps/web/.env.local
pnpm --filter @desk/web typecheck  # next typegen + tsc --noEmit
pnpm --filter @desk/web test
pnpm --filter @desk/web build
```

## Not done yet

- PostHog and Sentry are not wired.
- The waitlist rate limit is per process; waitlist storage is a webhook or a local JSONL file.
- `lint` is an alias for `tsc --noEmit` (Next 16 removed `next lint`; ESLint is not a dependency yet).
