# Architecture — Agent Reliability & Evaluation Pipeline

> A production-grade system that **measures, gates, and improves** LLM agent outputs.
> It does not just *run* agents — it proves they are reliable before they ship.

---

## 1. System Overview

```
                                  ┌─────────────────────────────────────────────┐
                                  │          Agent Reliability Pipeline          │
                                  └─────────────────────────────────────────────┘

   ┌──────────┐     ┌──────────────┐     ┌───────────────────────┐     ┌──────────────────┐
   │  Client  │────▶│  Express API │────▶│   Evaluation Engine   │────▶│   Monitoring     │
   │ / Agent  │ in  │  POST /eval  │     │  • RAGAS metrics      │     │  • Latency p50/95│
   └──────────┘     │  GET /metrics│     │  • Hallucination det. │     │  • Cost tracker  │
                    │  GET /health │     │  • Regression gate    │     └────────┬─────────┘
                    └──────┬───────┘     └───────────┬───────────┘              │
                           │                         │                          │
                           ▼                         ▼                          ▼
                    ┌─────────────┐         ┌─────────────────┐        ┌──────────────────┐
                    │  Response   │         │ eval-results/   │        │  /prometheus     │
                    │ EvalMetrics │         │ baseline.json   │        │  scraped by      │
                    │ + cost+lat. │         │ (accepted bar)  │        │  Prometheus →    │
                    └─────────────┘         └────────┬────────┘        │  Grafana boards  │
                                                     │                 └──────────────────┘
                                                     ▼
                                  ┌──────────────────────────────────────┐
                                  │  GitHub Actions CI (eval-ci.yml)      │
                                  │  install → test → eval fixtures →     │
                                  │  compare to baseline → BLOCK if       │
                                  │  any metric regresses > 5%            │
                                  └──────────────────────────────────────┘
```

---

## 2. Component Breakdown

| Path | Responsibility |
|------|----------------|
| `src/utils/text.ts` | Offline NLP primitives: tokenize (+ stop-word removal), term-frequency vectors, cosine similarity, sentence splitting. No external API. |
| `src/agents/base-agent.ts` | Abstract, strongly-typed `BaseAgent<TInput, TOutput>` contract every concrete agent implements. |
| `src/eval/ragas-evaluator.ts` | `RagasEvaluator` — faithfulness, context precision, answer relevance using cosine similarity as an offline proxy. Exports `EvalMetrics`. |
| `src/eval/hallucination-detector.ts` | `HallucinationDetector` — flags outputs whose faithfulness < 0.70. |
| `src/eval/regression-gate.ts` | `RegressionGate` — fails the build if any metric drops > 5% below the accepted baseline; persists a new baseline when everything passes. |
| `src/eval/run-eval.ts` | Batch runner used by CI: evaluates the fixture set, aggregates metrics, runs the gate, writes `eval-results/latest.json`, sets exit code. |
| `src/monitoring/latency-tracker.ts` | `LatencyTracker` — in-memory ring buffer, p50/p95 percentiles. |
| `src/monitoring/cost-tracker.ts` | `CostTracker` — token → USD cost per model, running summary. |
| `src/api/server.ts` | Express app factory: `POST /evaluate`, `GET /metrics`, `GET /health`, `GET /prometheus`. |
| `src/index.ts` | Process entry point — boots the server on `PORT`. |
| `tests/` | Jest unit + integration suites and fixtures. |
| `eval-results/baseline.json` | The accepted quality bar. The single source of truth the CI gate enforces. |
| `.github/workflows/eval-ci.yml` | The reliability gate in CI. |
| `docker-compose.yml` | Local observability stack: app + Prometheus + Grafana. |

---

## 3. Data Flow: input → agent → evaluation → CI gate → output

```
1. INPUT      { agentOutput, context[], query, model, tokens }
                     │
2. EVALUATE   RagasEvaluator
                 ├─ faithfulness     = mean over output sentences of max cosine(sentence, context)
                 ├─ contextPrecision = RAGAS precision@k over context ranked by relevance to output
                 └─ relevance        = cosine(output, query)
                     │
3. RELIABILITY  HallucinationDetector  →  isHallucination = faithfulness < 0.70
                CostTracker            →  USD cost from token counts + model price table
                LatencyTracker         →  p50 / p95 request latency
                     │
4. GATE (CI)  RegressionGate.gate(newMetrics, baseline)
                 └─ blocked if  new < baseline * 0.95  for ANY metric
                     │
5. OUTPUT     ┌─ API: JSON { metrics, hallucination, cost, latency }
              └─ CI : pass → (optionally) update baseline ; fail → block PR + comment
```

---

## 4. Technology Choices & Justification

| Choice | Why |
|--------|-----|
| **TypeScript (strict)** | Type-safe contracts between agent → evaluator → gate catch shape errors at compile time, not in prod. Strict mode is the signal of production rigour. |
| **Cosine similarity (offline)** | RAGAS-style metrics normally call an embedding/LLM API. Using term-frequency cosine similarity makes the core deterministic, **key-free, and CI-friendly** — tests and gates never depend on a flaky external call or a billed token. The interface is built so a real embedding backend can be swapped in later. |
| **Express** | Smallest, most universally understood Node HTTP surface; trivial for a reviewer to read. |
| **Jest + ts-jest** | De-facto TS testing stack; property-based assertions keep tests stable across refactors. |
| **prom-client + Prometheus + Grafana** | Demonstrates *observability*, not just logging — real p50/p95 and cost dashboards. |
| **GitHub Actions** | Encodes the core thesis: **evaluation is a CI gate**, not a notebook. A regressing PR is physically blocked. |
| **Docker Compose** | One command (`docker compose up`) reproduces the whole observability stack locally. |

---

## 5. Edge Cases & Failure Modes

| Scenario | Handling |
|----------|----------|
| Empty `output` or empty `context[]` | Similarity functions return `0`; metrics clamp to `[0,1]`; no crash. |
| Output with zero overlapping tokens | Cosine → `0`, faithfulness low → flagged as hallucination. |
| Identical output and context | Cosine → `1`, faithfulness high → not flagged. |
| Unknown model in `CostTracker` | Throws an explicit error (fail fast — never silently mis-bill). |
| `getP50`/`getP95` with no samples | Returns `0` rather than `NaN`. |
| Ring buffer overflow | Oldest samples evicted; percentiles reflect the recent window. |
| Missing `baseline.json` | Gate treats a first run as a pass and seeds the baseline. |
| Division by zero in percentiles / cost averages | Guarded; returns `0`. |
| Malformed `POST /evaluate` body | API responds `400` with a descriptive message. |
| Secrets | Only read from `.env` via `dotenv`; `.env` is git-ignored; `.env.example` documents required keys. |

---

## 6. Definition of Done (per phase)

### Phase 1 — Core (this scaffold)
- [x] Strict TypeScript compiles with no errors.
- [x] All eval, monitoring, gate classes implemented (no stubs).
- [x] ≥ 5 unit tests per module + 1 integration test; `npm test` green.
- [x] `POST /evaluate`, `GET /metrics`, `GET /health` respond correctly.
- [x] CI workflow runs tests + fixture eval + regression gate on every PR.
- [x] `baseline.json` committed; gate blocks > 5% regressions.

### Phase 2 — Real signals
- [ ] Pluggable embedding backend (OpenAI / local model) behind the existing interface.
- [ ] Persist eval history to DynamoDB; trend charts in Grafana.
- [ ] LLM-as-judge faithfulness as an optional, key-gated scorer.

### Phase 3 — Scale & deploy
- [ ] Package API as a container; deploy to AWS Lambda + API Gateway.
- [ ] S3-backed fixture/golden-dataset store; nightly scheduled eval.
- [ ] Alerting (cost spike / latency p95 breach) wired to Grafana → Slack.
