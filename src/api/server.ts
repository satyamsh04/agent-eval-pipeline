import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
 * API key authentication middleware.
 *
 * If `API_KEY` is not configured, this middleware is a no-op to keep local
 * development friction low. `/health` is always exempt for probes.
 *
 * @param req - Express request object.
 * @param res - Express response object.
 * @param next - Next middleware callback.
 */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    next();
    return;
  }
  const expected = process.env.API_KEY?.trim();
  if (!expected) {
    next();
    return;
  }
  const received = req.header('x-api-key')?.trim();
  if (received === expected) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized: invalid API key.' });
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
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(helmet());
  app.use(
    cors({
      origin:
        allowedOrigins.length > 0
          ? (origin, callback) => {
              if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
              }
              callback(new Error('Origin not allowed by CORS policy.'));
            }
          : true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.use(express.json());
  app.use(requireApiKey);

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

    // --- 400: client input validation ---
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
    const supported = CostTracker.supportedModels();
    if (!supported.includes(model)) {
      return res.status(400).json({
        error: `Unsupported model "${model}". Supported: ${supported.join(', ')}.`,
      });
    }

    const inputTokens =
      typeof body.inputTokens === 'number'
        ? body.inputTokens
        : estimateTokens(query, context);
    const outputTokens =
      typeof body.outputTokens === 'number'
        ? body.outputTokens
        : estimateTokens(agentOutput, []);
    if (inputTokens < 0 || outputTokens < 0) {
      return res
        .status(400)
        .json({ error: 'Token counts must be non-negative.' });
    }

    // --- 500: anything unexpected past validation is a server fault ---
    const id = latency.start();
    try {
      const metrics = evaluator.evaluate(agentOutput, context, query);
      const hallucination = detector.detect(agentOutput, context);
      const costResult = cost.track(inputTokens, outputTokens, model);
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
    } catch (err: unknown) {
      try {
        latency.stop(id);
      } catch {
        /* timer already stopped */
      }
      const message =
        err instanceof Error ? err.message : 'Internal evaluation error.';
      return res
        .status(500)
        .json({ error: 'Internal server error.', detail: message });
    }
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

  app.use(
    (
      err: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ): void => {
      if (
        err instanceof SyntaxError &&
        'status' in err &&
        (err as { status?: number }).status === 400
      ) {
        res.status(400).json({ error: 'Invalid JSON body.' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unexpected error.';
      res.status(500).json({ error: 'Internal server error.', detail: message });
    },
  );

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
