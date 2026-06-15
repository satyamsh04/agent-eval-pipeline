Production-grade pipeline that measures, gates, and improves LLM agent reliability — RAGAS-style metrics, hallucination detection, and a CI quality gate.

# Agent Reliability & Evaluation Pipeline

> **Most projects build LLM agents. This one proves they're reliable before they ship.**
> A production-grade pipeline that **measures, gates, and improves** agent outputs — with
> RAGAS-style metrics, hallucination detection, cost/latency observability, and a CI gate
> that physically blocks any pull request that makes the agent worse.

[![CI](https://github.com/satyamsh04/agent-eval-pipeline/actions/workflows/eval-ci.yml/badge.svg)](https://github.com/satyamsh04/agent-eval-pipeline/actions/workflows/eval-ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Jest](https://img.shields.io/badge/tested%20with-Jest-C21325?logo=jest&logoColor=white)
![Express](https://img.shields.io/badge/API-Express-000000?logo=express&logoColor=white)
![Prometheus](https://img.shields.io/badge/metrics-Prometheus-E6522C?logo=prometheus&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

---

## The problem this solves

Shipping an LLM agent is easy. Knowing whether a change made it **better or worse** is the hard
part — and it's exactly what breaks AI systems in production. This project treats agent quality
the way mature teams treat code quality: as a **measurable, gated, observable** property.

- **Measure** — RAGAS-style faithfulness, context precision, and answer relevance.
- **Gate** — a regression gate blocks any PR where a metric drops > 5% below the accepted baseline.
- **Observe** — p50/p95 latency and per-model token cost, exported to Prometheus + Grafana.

All core evaluation runs **offline** (term-frequency cosine similarity), so tests and CI never
need an API key or a billed token. The interfaces are built so a real embedding/LLM backend can
be dropped in for Phase 2.

---

## Architecture

```
 Client/Agent ──▶ Express API ──▶ Evaluation Engine ──▶ Monitoring ──▶ Output
                  /evaluate        • RAGAS metrics        • latency p50/95
                  /metrics         • hallucination det.   • token cost
                  /health          • regression gate ──▶ eval-results/baseline.json
                                                          │
                                            GitHub Actions CI gate (eval-ci.yml)
                                       install → test → eval → block if regression
```

Full diagram, component breakdown, data flow, and edge-case handling: see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Quick start

```bash
# 1. Install
npm install

# 2. Run the test suite (unit + integration)
npm test

# 3. Run the evaluation + regression gate locally
npm run eval

# 4. Start the API
npm run dev          # ts-node, http://localhost:3000

# 5. (Optional) Full observability stack
docker compose up    # app + Prometheus (:9090) + Grafana (:3001)
```

Copy `.env.example` to `.env` for configuration. No secrets are required for the core pipeline.

### API

| Method | Route | Description |
| --- | --- | --- |
| `POST` | `/evaluate` | `{ agentOutput, context[], query, model }` → metrics + hallucination + cost + latency |
| `GET` | `/metrics` | Aggregated summary: p50/p95 latency, total cost, avg faithfulness |
| `GET` | `/health` | `{ status: "ok", timestamp }` |
| `GET` | `/prometheus` | Prometheus text-format metrics (scraped by the Compose stack) |

```bash
curl -s localhost:3000/evaluate -H 'content-type: application/json' -d '{
  "agentOutput": "The capital of France is Paris.",
  "context": ["Paris is the capital and most populous city of France."],
  "query": "What is the capital of France?",
  "model": "gpt-4o"
}'
```

---

## Metrics: current vs baseline

The baseline ([`eval-results/baseline.json`](./eval-results/baseline.json)) is the accepted quality
bar enforced by CI. "Current" is the aggregate over the non-hallucinated fixtures.

| Metric | Baseline | Current | Gate floor (−5%) | Status |
| --- | --- | --- | --- | --- |
| Faithfulness | 0.75 | ~0.86 | 0.713 | ✅ |
| Context precision | 0.72 | ~1.00 | 0.684 | ✅ |
| Answer relevance | 0.78 | ~0.81 | 0.741 | ✅ |
| Hallucination detection accuracy | — | 100% (10 fixtures) | — | ✅ |

> Run `npm run eval` to regenerate these numbers; `npm run eval:baseline` promotes the current
> scores to the new baseline once they pass the gate. Scores improve as the project develops.

---

## What makes this production-ready

- **Quality is a hard CI gate, not a vibe.** A regressing PR is blocked by GitHub Actions and the
  eval report is posted as a PR comment — see [`.github/workflows/eval-ci.yml`](./.github/workflows/eval-ci.yml).
- **Strict TypeScript end-to-end.** `strict: true` plus `noUncheckedIndexedAccess`,
  `noImplicitReturns`, and friends. Type errors fail CI via `npm run typecheck`.
- **Deterministic, key-free core.** Offline cosine-similarity scoring means tests and gates are
  reproducible and free — no flaky external calls in the critical path.
- **Real observability.** p50/p95 latency and per-model token cost exported to Prometheus and
  visualized in Grafana via `docker compose up`.
- **Tested behavior, not implementation.** ≥ 5 property-based unit tests per module plus an
  end-to-end integration suite (`npm test`).
- **Clean architecture.** One class per file, typed contracts (`BaseAgent<TInput, TOutput>`),
  JSDoc on every public function, and explicit failure modes (unknown model, empty context, etc.).
- **Reproducible everywhere.** Multi-stage `Dockerfile` + `docker-compose.yml` stand the whole
  stack up with one command.

---

## Roadmap

| Phase | Focus | Highlights |
| --- | --- | --- |
| **1 — Core** ✅ | Measure / gate / observe | RAGAS metrics, hallucination detector, regression gate, CI, monitoring |
| **2 — Real signals** | Swap in real models | Pluggable embedding/LLM backend, DynamoDB eval history, LLM-as-judge |
| **3 — Scale & deploy** | Ship it | AWS Lambda + API Gateway, S3 golden datasets, nightly eval, Grafana → Slack alerts |

---

## Tech stack

TypeScript (strict) · Node.js 20 · Express · Jest + ts-jest · prom-client · Prometheus · Grafana ·
Docker · GitHub Actions. Designed to extend onto AWS (Lambda, DynamoDB, S3).

---

## Author

**Satyam** — final-year Computer Science (Data Science) student at Griffith University,
graduating November 2026. Built to demonstrate evaluation, observability, and CI/CD for AI systems.

_MIT licensed._
