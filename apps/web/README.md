# @desk/web

Next.js 16 (App Router) app for DESK: the marketing site, the authenticated application shell, and
the API routes that do not belong in the pipeline. Everything in this package builds and runs with
**no environment variables at all**; integrations switch on when their keys are present.

## Run

From the repo root (pnpm 10, Node 22):

```sh
pnpm install
pnpm --filter @desk/web dev        # http://localhost:3000
pnpm --filter @desk/web typecheck  # next typegen + tsc --noEmit
pnpm --filter @desk/web test       # vitest (lib/**/*.test.ts)
pnpm --filter @desk/web build      # next build (Turbopack)
pnpm --filter @desk/web start
```

## Routes

| Route | What |
|---|---|
| `/` | Landing: promise, "Run 50 of your POs free" CTA, how it works, pain, ERP list, audit form |
| `/pricing` | §8.2 price card with FTE-equivalent anchors, modules, onboarding, FAQ (+ `FAQPage` JSON-LD) |
| `/security` | §6.4 commitments and compliance roadmap (commitments, not certifications held) |
| `/llms.txt` | Plain-text product facts for AI assistants (`app/llms.txt/route.ts`) |
| `/robots.txt`, `/sitemap.xml` | Generated from `app/robots.ts` / `app/sitemap.ts` |
| `/sign-in`, `/sign-up` | Clerk components (catch-all routes) |
| `/app` | Authenticated shell: left nav, `OrganizationSwitcher`, empty-state dashboard |
| `/app/*` | Placeholder pages for Needs review / Posted / Rejected / Customers / Items / Settings |
| `POST /api/waitlist` | Audit/waitlist form handler |
| `POST /api/webhooks/clerk` | Clerk webhook receiver (`organization.created` -> Stripe customer) |

## Environment variables

Names match `.env.example` at the repo root. Copy it to `apps/web/.env.local` for local work.

| Variable | Effect when set |
|---|---|
| `APP_URL` | Absolute URL used for metadata, sitemap and `llms.txt` links. Defaults to `http://localhost:3000`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | **The Clerk switch.** Wraps the root layout in `<ClerkProvider>`, turns `proxy.ts` into `clerkMiddleware` protecting `/app(.*)`, and renders the real sign-in/sign-up and `/app` shell. Unset: the marketing site runs, and `/sign-in`, `/sign-up`, `/app` show a notice listing the variables to set. |
| `CLERK_SECRET_KEY` | Required by Clerk server-side once the publishable key is set. |
| `CLERK_WEBHOOK_SECRET` | Signing secret for `/api/webhooks/clerk`. Unset: the route returns 503. (Clerk's default name `CLERK_WEBHOOK_SIGNING_SECRET` is also accepted.) |
| `STRIPE_SECRET_KEY` | On `organization.created`, creates a Stripe customer with `metadata.clerkOrgId` (idempotent per org). Unset: the event is logged and acknowledged. |
| `WAITLIST_WEBHOOK_URL` | If set, `/api/waitlist` POSTs each submission as JSON to this URL (Slack, Zapier, Make, a CRM). Unset: appends a JSON line to `apps/web/.data/waitlist.jsonl` (git-ignored). |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Reserved for product analytics; not yet wired. |

## How gating works

- `lib/env.ts` has the predicates (`isClerkConfigured`, `isStripeConfigured`). Nothing else reads
  `process.env` for these.
- `app/layout.tsx` returns the tree with or without `<ClerkProvider>`.
- `proxy.ts` (Next 16's replacement for `middleware.ts`) exports `clerkMiddleware(...)` or a
  pass-through `NextResponse.next()` depending on the same predicate.
- Pages that render Clerk components check the predicate first and fall back to
  `components/clerk-not-configured.tsx`.

## Waitlist route

`POST /api/waitlist` with JSON `{ email, company?, erp, ordersPerDay, website? }`.
Validation is `lib/waitlist-schema.ts` (zod 4), shared with the form so the `<select>` options and
the enums cannot drift. Guards: JSON content type, 4 KB body cap, in-memory per-IP limit
(5 per 10 minutes, single-instance only), honeypot field (`website` must be empty; filled honeypots
get a 200 and are dropped). The response is always `{ ok: true }` on success and never echoes
stored data.

## What is stubbed in Phase 0

- `/app` dashboard tiles show "—" and the onboarding checklist is static.
- `/app/<section>` pages are placeholders; the review queue, ERP connection and settings arrive
  with the MVP (plan §7.5 Phase 2).
- Waitlist storage is a webhook or a local JSONL file, not the database. `@desk/db` is not imported
  from this package yet.
- The rate limit is per process. Replace with a shared store before running more than one instance.
- `lint` is an alias for `tsc --noEmit`: Next 16 removed `next lint`, and ESLint is not yet a
  dependency of the workspace. Add `eslint` + `eslint-config-next` and switch the script when ready.
- PostHog and Sentry are not wired.
