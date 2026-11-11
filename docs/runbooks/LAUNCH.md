# Launch checklist

The code is ready. What stands between it and a paying customer is a set of accounts only you can
open, three approvals that take calendar time, and one decision about legal text. Work top to bottom.
`pnpm preflight` tells you at any point what is still missing; launch when it prints "Ready to launch."

Detail for each service is in [SETUP.md](SETUP.md). Rough effort: one focused day of setup, then
waiting on approvals.

## Start these first: they take days, not minutes
| What | Why it takes time | Start by |
|---|---|---|
| **Intuit production keys** | Intuit reviews the app before real QuickBooks companies can connect. The review asks for your Terms and Privacy URLs, so deploy first, then submit. | Creating the app at developer.intuit.com and testing with a sandbox company |
| **Sending domain reputation** | Postmark approves new accounts manually and DNS (SPF, DKIM, DMARC, MX) takes time to propagate. | Adding the DNS records the day you sign up |
| **Stripe account activation** | Live payments need your business and bank details verified. | Completing Stripe onboarding; use test mode until then |

## 1. Decide and write down
- [ ] Company legal name, address, contact email, governing law. Set `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ADDRESS`, `LEGAL_CONTACT_EMAIL`, `LEGAL_JURISDICTION`, `LEGAL_EFFECTIVE_DATE`.
- [ ] Have a lawyer read `/terms` and `/privacy`. They are a sound starting draft, not legal advice. The privacy page lists sub-processors: make it match the providers you actually pick, and accept each provider's data processing agreement.
- [ ] The trial: 25 posted orders by default (`TRIAL_POSTED_ORDER_LIMIT`). Reading and review are never limited. See docs/DECISIONS.md D-014.
- [ ] Domain: the app (`app.yourdomain.com`), and the inbound mail subdomain (`orders.yourdomain.com`).

## 2. Accounts and keys (SETUP.md has the clicks)
- [ ] Postgres (Neon or Supabase) → `DATABASE_URL`; add it as the GitHub secret `DATABASE_URL`; run **Actions → Migrate database**.
- [ ] Clerk **production** instance with Organizations on → publishable key, secret key, webhook secret.
- [ ] `DESK_SECRETS_KEY` (`openssl rand -base64 48`). Store a copy in your password manager: losing it disconnects every customer's ERP.
- [ ] Anthropic API key, with a monthly spend limit set in the Anthropic console.
- [ ] Cloudflare R2 (or S3) bucket → `S3_*`. Required on serverless hosts.
- [ ] Postmark server → token, sender signature, inbound domain and webhook.
- [ ] Inngest app → event key, signing key; sync `/api/inngest` after the first deploy.
- [ ] Stripe → `STRIPE_SECRET_KEY`, then `pnpm stripe:setup` creates the meter, three products and six prices and prints the env lines. Add the webhook and `STRIPE_WEBHOOK_SECRET`. Do it in test mode first, then repeat with the live key.
- [ ] Intuit app → `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT=sandbox` to begin.
- [ ] Sentry project → `SENTRY_DSN` (optional but you want it on day one).

## 3. Deploy
- [ ] Vercel project: root directory `apps/web`, Node 22, all variables from step 2, `APP_URL` set to the public address. Do **not** set `DESK_DEMO`.
- [ ] `pnpm preflight --env <your env file>` prints no FAIL lines.
- [ ] `https://<app>/api/health` returns `"ok": true`.
- [ ] Point an uptime monitor at `/api/health`.

## 4. Prove it with your own workspace (about an hour)
- [ ] Sign up, create an organization, land on the inbox.
- [ ] Connect a QuickBooks **sandbox** company; items and customers appear.
- [ ] Email a real PDF purchase order to your workspace address; a draft appears in review within three minutes.
- [ ] Fix a line, confirm in shadow mode, check the customer's "learned" table.
- [ ] Turn shadow mode off; confirm an order; find the Estimate in QuickBooks with the PDF attached.
- [ ] Send the acknowledgment; read it in your own inbox.
- [ ] Stripe test mode: choose a plan with card 4242 4242 4242 4242; the plan shows in Settings; post an order; a meter event appears in Stripe.
- [ ] Cancel the test subscription; posting pauses with a clear message and incoming orders are still received.
- [ ] Before offering "Post as Sales Orders" to anyone, verify that mode against the sandbox (docs/DECISIONS.md D-006).

## 5. Measure accuracy before you promise it
- [ ] Run 50 to 100 real purchase orders through `pnpm replay`, correct them into a golden set, and record the result in docs/EVALS.md. The plan's bar is 95% field accuracy and 90% line-match accuracy at under $0.15 a document. The numbers on the marketing site should be ones you have measured.

## 6. Go live
- [ ] Intuit approves the app → swap in production keys, `QBO_ENVIRONMENT=production`.
- [ ] Stripe live keys → run `pnpm stripe:setup` again with the live key, update the six price ids and the webhook secret.
- [ ] Clerk production keys in place (preflight warns on `sk_test`).
- [ ] First design partner: shadow mode for two weeks, then auto-post for their cleanest customers.

## Running it
- Errors: Sentry, or the host's logs (one JSON line per failed request, with a `digest` that matches what the user sees).
- A customer says an email never arrived: Postmark → Inbound activity; then the inbox section "Messages that did not become orders".
- An order will not post: the order page shows the ERP's own error; "Post now" retries safely (posting is idempotent).
- A customer asks for deletion: there is no self-serve delete yet. Delete the tenant row (it cascades) and their document prefix `t/<tenantId>/` in the bucket within the 30 days the terms promise.
- New migration in a release: run **Migrate database** before the deploy finishes.
