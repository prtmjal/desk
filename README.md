# DESK

An AI order desk for small and mid-size wholesale distributors: it reads customer purchase orders
(email, PDF, spreadsheet, photo), matches them to your items and customers, validates price, stock and
units against your ERP, and posts a sales order. People only touch the exceptions, and every
correction is remembered for that customer.

- Plan: [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md)
- Where the build stands: [docs/STATUS.md](docs/STATUS.md)
- Setup, service by service: [docs/runbooks/SETUP.md](docs/runbooks/SETUP.md)
- Decisions: [docs/DECISIONS.md](docs/DECISIONS.md) · Eval results: [docs/EVALS.md](docs/EVALS.md)

## Try it in two commands

```sh
pnpm install
pnpm demo        # http://localhost:3000/app — no accounts, sample distributor, offline parser
```

Upload a text file like this and walk it through review:

```
PO# HP-4471
20 EA EMT-075-10 3/4 EMT conduit @ 9.80
3 EA HP-BRK30 30 amp 2 pole breaker @ 26.00
10 BDL EMT-050-10 1/2 emt @ 61.50
```

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js app: marketing site, the application, webhooks |
| `packages/core` | Order schema (zod), matching engine, rules engine. Pure, no I/O |
| `packages/extract` | Document normalization, versioned prompts, model client, pipeline |
| `packages/erp` | Connector interface; QuickBooks Online, CSV, mock |
| `packages/db` | Drizzle schema, migrations, row-level security |
| `packages/service` | Application layer: intake, review, posting, learning, metrics |
| `packages/evals` | Golden sets, scorer, release gate |
| `scripts` | CLIs: replay POs for a prospect, import an item master |

## Commands

`pnpm dev` · `pnpm demo` · `pnpm test` · `pnpm evals` · `pnpm typecheck` · `pnpm lint` · `pnpm db:migrate` · `pnpm replay`

Requires Node 22 and pnpm 10.
