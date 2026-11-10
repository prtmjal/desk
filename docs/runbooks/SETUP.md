# Setup: from clone to a working deployment

Everything is optional except the database and sign-in. Each service switches on when its variables
are set (apps/web/lib/env.ts); the Settings page shows what is on. Variable names are in `.env.example`.
Put them in `apps/web/.env.local` for local work and in your host's environment for production.

## 0. Try it with nothing
```sh
pnpm install
pnpm demo            # http://localhost:3000/app
```
Sample distributor, in-process database (`apps/web/.pglite`), mock ERP, offline text/CSV parser.
Add `ANTHROPIC_API_KEY` to the same command to read real PDFs and images in demo mode.

## 1. Database (required)
1. Create a Postgres database (Neon or Supabase). Enable `pg_trgm`; `vector` is optional.
2. `DATABASE_URL=... pnpm db:migrate`
   The role that runs migrations owns the tables and is granted `app_user`, the role every tenant
   query runs as. Never use `drizzle-kit push` (see packages/db/drizzle.config.ts).
3. Set `DATABASE_URL` for the app.

## 2. Sign-in (required): Clerk
1. Create a Clerk application and **enable Organizations**. Each organization is one tenant.
2. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
3. Add a webhook to `https://<app>/api/webhooks/clerk` for `organization.created`; set `CLERK_WEBHOOK_SECRET`.
   (The tenant is also created on first visit, so the webhook is a convenience, not a dependency.)

## 3. Secrets key (required before connecting an ERP)
`DESK_SECRETS_KEY`: a long random string (`openssl rand -base64 48`). It encrypts ERP tokens.
Losing it means every tenant reconnects their ERP. Changing it requires re-encrypting the `secrets` table.

## 4. Extraction model: Anthropic
Set `ANTHROPIC_API_KEY`. Model ids are in `DESK_EXTRACT_MODEL` / `DESK_CLASSIFY_MODEL`; take current
ids and prices from https://docs.claude.com and update `PRICE_TABLE` in packages/extract/src/client.ts
if they changed, since cost tracking depends on it.

## 5. Email: Postmark
1. Outbound: create a server, verify a sending domain (SPF, DKIM, DMARC), set `POSTMARK_SERVER_TOKEN`
   and `POSTMARK_FROM`.
2. Inbound: point an MX record for `INBOUND_DOMAIN` (for example `orders.yourdomain.com`) at Postmark's
   inbound host, and set the inbound webhook to
   `https://postmark:<POSTMARK_INBOUND_SECRET>@<app>/api/webhooks/postmark`.
   Each tenant's address is `<tenant-slug>@<INBOUND_DOMAIN>`, shown on their inbox and Settings pages.

## 6. Job runner: Inngest
Create an app, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, and sync `https://<app>/api/inngest`.
Locally: `npx inngest-cli@latest dev` and `INNGEST_DEV=1`. Without Inngest the pipeline runs in the web
process (docs/DECISIONS.md D-009); hourly ERP sync and the weekly digest only run with Inngest.

## 7. Document storage: S3 or Cloudflare R2
Set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_REGION` for AWS).
Without them documents are written to local disk (`BLOB_DIR`), which does not survive serverless hosts.

## 8. QuickBooks Online
1. Create an app at developer.intuit.com. Redirect URI: `https://<app>/api/integrations/quickbooks/callback`.
2. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT` (`sandbox` or `production`).
3. In the app: Settings → Connect QuickBooks Online. The first sync starts on return.
4. Orders post as Estimates by default. For Sales Orders, enable the restricted scopes
   `sales.sales-order.read` and `sales.sales-order.write` on the Intuit app, turn on Sales Orders in the
   QuickBooks company, choose "Post as Sales Orders" and reconnect. Read docs/DECISIONS.md D-006 first.

## 9. Billing: Stripe
1. Create three products (Starter, Growth, Scale), each with a monthly platform price and a metered
   overage price backed by one Billing Meter whose event name is `desk_order_posted`.
   Included orders per plan (150 / 600 / 2,500) are configured on the metered price as a free tier.
2. Set `STRIPE_SECRET_KEY`, the six `STRIPE_PRICE_*` ids, and `STRIPE_METER_EVENT` if you used another name.
3. Webhook to `https://<app>/api/webhooks/stripe` for `checkout.session.completed`,
   `customer.subscription.*`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`; set `STRIPE_WEBHOOK_SECRET`.

## 10. Deploy (Vercel)
Root directory `apps/web`, install command `pnpm install` at the repo root, Node 22.
Prompt files and migrations are traced into the build (apps/web/next.config.ts). Run migrations from
CI or your machine, not from the app.

## First tenant checklist
Sign up → create the organization → connect the ERP (or CSV export and import item/customer CSVs) →
upload 20 historical POs → review → leave shadow mode on for two weeks → turn it off → set auto-post.
