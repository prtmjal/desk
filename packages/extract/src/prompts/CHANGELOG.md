# Prompt changelog

Every change to a prompt file bumps its version suffix, gets an entry here, and a `pnpm evals` run recorded in `docs/EVALS.md` (plan §7.3 #4–5).

## 2026-11-07

- `extract-order.v1` — initial extraction prompt: document typing, multi-order splitting, verbatim transcription, calibrated confidence, provenance quotes, warnings list.
- `classify.v1` — initial cheap routing prompt (Haiku) for inbound messages.
- `rerank.v1` — initial L4 re-ranker prompt with explicit abstention rules.
