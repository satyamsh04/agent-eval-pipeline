import express, { type Express, type Request, type Response } from 'express';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import { RagasEvaluator, type EvalMetrics } from '../eval/ragas-evaluator';
import {
  HallucinationDetector,
  type HallucinationResult,
} from '../eval/hallucination-detector';
import { LatencyTracker } from '../monitoring/latency-tracker';
import { CostTracker, type CostResult } from '../monitoring/cost-tracker';

/** Shape of a `POST /evaluate` request body. */
interface EvaluateBody {
  agentOutput?: unknown;
  context?: unknown;
  query?: unknown;
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
}

/** Shape of a `POST /evaluate` response. */
export interface EvaluateResponse {
  metrics: EvalMetrics;
  hallucination: HallucinationResult;
  cost: CostResult;
  latencyMs: number;
}

/**
 * Builds the Express application along with its shared monitoring state.
 *
 * Exposed as a factory (rather than a bound server) so tests can drive the app
 * with supertest without binding a port.
 *
 * @returns The configured Express app.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  const evaluator = new RagasEvaluator();
  const detector = new HallucinationDetector();
  const latency = new LatencyTracker();
  const cost = new CostTracker();
  const accuracySamples: number[] = [];

  // --- Prometheus registry ---
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const p50Gauge = new Gauge({
    name: 'agent_eval_latency_p50_ms',
    help: 'p50 request latency in ms',
    registers: [registry],
  });
  const p95Gauge = new Gauge({
    name: 'agent_eval_latency_p95_ms',
    help: 'p95 request latency in ms',
    registers: [registry],
  });
  const costGauge = new Gauge({
    name: 'agent_eval_total_cost_usd',
    help: 'Total estimated cost in USD',
    registers: [registry],
  });
  const faithfulnessGauge = new Gauge({
    name: 'agent_eval_avg_faithfulness',
    help: 'Average faithfulness across evaluated requests',
    registers: [registry],
  });

  /**
   * Health probe.
   */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * Evaluate a single agent output end-to-end.
   */
  app.post('/evaluate', (req: Request, res: Response) => {
    const body = req.body as EvaluateBody;

    const agentOutput = body.agentOutput;
    const query = body.query;
    const model = body.model;
    const context = body.context;

    if (typeof agentOutput !== 'string' || agentOutput.trim().length === 0) {
      return res
        .status(400)
        .json({ error: '"agentOutput" must be a non-empty string.' });
    }
    if (!Array.isArray(context) || !context.every((c) => typeof c === 'string')) {
      return res
        .status(400)
        .json({ error: '"context" must be an array of strings.' });
    }
    if (typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: '"query" must be a non-empty string.' });
    }
    if (typeof model !== 'string' || model.trim().length === 0) {
      return res.status(400).json({ error: '"model" must be a non-empty string.' });
    }

    const inputTokens =
      typeof body.inputTokens === 'number' ? body.inputTokens : estimateTokens(query, context);
    const outputTokens =
      typeof body.outputTokens === 'number' ? body.outputTokens : estimateTokens(agentOutput, []);

    const id = latency.start();
    let metrics: EvalMetrics;
    let hallucination: HallucinationResult;
    let costResult: CostResult;
    try {
      metrics = evaluator.evaluate(agentOutput, context, query);
      hallucination = detector.detect(agentOutput, context);
      costResult = cost.track(inputTokens, outputTokens, model);
    } catch (err: unknown) {
      latency.stop(id);
      const message = err instanceof Error ? err.message : 'Evaluation failed.';
      return res.status(400).json({ error: message });
    }
    const latencyMs = latency.stop(id);

    accuracySamples.push(metrics.faithfulness);

    // Refresh Prometheus gauges.
    p50Gauge.set(latency.getP50());
    p95Gauge.set(latency.getP95());
    costGauge.set(cost.getSummary().totalCost);
    faithfulnessGauge.set(average(accuracySamples));

    const response: EvaluateResponse = {
      metrics,
      hallucination,
      cost: costResult,
      latencyMs,
    };
    return res.json(response);
  });

  /**
   * Aggregated human-readable metrics summary.
   */
  app.get('/metrics', (_req: Request, res: Response) => {
    const summary = cost.getSummary();
    res.json({
      latency: { p50Ms: latency.getP50(), p95Ms: latency.getP95() },
      cost: summary,
      accuracy: {
        avgFaithfulness: average(accuracySamples),
        sampleCount: accuracySamples.length,
      },
    });
  });

  /**
   * Prometheus scrape endpoint (text exposition format).
   */
  app.get('/prometheus', async (_req: Request, res: Response) => {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  });

  return app;
}

/**
 * Very rough token estimate (~4 chars/token) used only when callers omit usage.
 *
 * @param text - Primary text.
 * @param extra - Additional text segments to include.
 * @returns Estimated token count.
 */
function estimateTokens(text: string, extra: string[]): number {
  const chars = [text, ...extra].join(' ').length;
  return Math.ceil(chars / 4);
}

/**
 * Computes the mean of a numeric array.
 *
 * @param values - The numbers.
 * @returns The mean, or 0 for an empty array.
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
