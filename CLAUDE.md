# DESK — AI order desk for distributors

## What this is
Read docs/MASTER_PLAN.md §1, §4, §6 before any product work. We are in **Phase 2** (see §7.5).
Current phase goal: design partners process live orders daily.
The Phase 2 code is built; what is left needs real accounts and real customers. See docs/STATUS.md.

## Non-negotiables
- Tenant isolation: every query is scoped by tenant_id; RLS policies in packages/db must not be bypassed.
  All tenant data access goes through `withTenant` (packages/db) — in practice through `@desk/service`.
- Pipeline steps are pure, persisted, replayable (docs/MASTER_PLAN.md §7.3).
- Prompts live in packages/extract/src/prompts; bump version + changelog on any change.
- Run `pnpm evals` before proposing a merge that touches extract/, core/matching, or prompts. Report accuracy delta and cost per order.
- Never post to a real ERP from tests; use the mock connector and recorded fixtures.
- No secrets in code; use env + the secrets table (`@desk/service` secrets.ts) for tenant credentials.
- A model's guess never auto-posts: only exact and learned-alias matches are eligible (core/rules/autopost.ts).
- Units of measure are never guessed. An unknown unit is an error on the line, not a silent "each".

## Commands
pnpm dev · pnpm demo · pnpm test · pnpm evals · pnpm db:migrate · pnpm lint · pnpm typecheck

`pnpm demo` runs the app with no accounts at all (sample tenant, in-process Postgres, offline parser).

## Conventions
TypeScript strict; zod schemas in packages/core are the source of truth; server actions for mutations;
Inngest functions for anything >2s or external I/O; conventional commits.
Relative imports have no file extension (the web bundler resolves workspace TypeScript sources directly).
Application logic lives in packages/service and takes explicit deps; apps/web only wires env, auth and UI.
Every integration is gated on its env var in apps/web/lib/env.ts; the app must build and run with none set.

## Where things are
See docs/MASTER_PLAN.md §7.2, plus packages/service (application layer, added in Phase 2).
Decisions: docs/DECISIONS.md. Eval results: docs/EVALS.md. Setup: docs/runbooks/SETUP.md. Status: docs/STATUS.md.

## Working style
Plan first for any multi-file change; list files you will touch; write tests alongside; ask before adding dependencies.
