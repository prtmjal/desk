# Eval results

Appended by `pnpm --filter @desk/evals exec tsx src/cli.ts --write` (offline) or with `--live --record`.

**Read this first:** the `demo` set is four synthetic cases with recorded model outputs. It proves the
harness, the scorer and the deterministic layers work and guards against regressions in CI. It is
**not** a measurement of extraction accuracy. The Phase 1 bar (plan §7.5: ≥95% field accuracy and
≥90% line-match accuracy on a 100-document mixed golden set, cost under $0.15 per document) has not
been measured yet: it needs real purchase orders from prospects and an `ANTHROPIC_API_KEY`.

## 2026-11-10 — set `demo` (cached)

- Prompts: extract-order.v1, classify.v1, rerank.v1 · Model: cached · Ref: 90f1f99
- Gate: **PASS**

| Metric | Value |
|---|---|
| Cases | 4 |
| Document type accuracy | 100.0% |
| Header field accuracy | 100.0% |
| Line recall | 100.0% |
| Line field accuracy | 100.0% |
| Match accuracy | 100.0% |
| Wrong-item rate | 0.0% |
| Customer identification | 100.0% |
| False auto-posts | 0 |
| Mean cost / document | $0.0000 |
| P95 latency | 0.0s |

| Kind | Cases | Header acc | Line acc | Match acc |
|---|---|---|---|---|
| excel | 2 | 100.0% | 100.0% | 100.0% |
| email_body | 1 | 100.0% | 100.0% | 100.0% |
| adversarial | 1 | 100.0% | 100.0% | 100.0% |
