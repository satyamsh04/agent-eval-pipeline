import { promises as fs } from 'fs';
import path from 'path';
import { RagasEvaluator, type EvalMetrics } from './ragas-evaluator';
import { HallucinationDetector } from './hallucination-detector';
import { RegressionGate, type GateResult } from './regression-gate';

/** A single labelled evaluation fixture. */
export interface Fixture {
  id: string;
  query: string;
  agentOutput: string;
  groundTruth: string;
  context: string[];
  expectedHallucination: boolean;
}

/** Aggregated result of a batch evaluation run. */
export interface RunEvalResult {
  /** Average quality metrics across non-hallucinated ("good") fixtures. */
  aggregate: EvalMetrics;
  /** Fraction of fixtures whose hallucination label was predicted correctly. */
  detectionAccuracy: number;
  /** The regression-gate outcome vs. the baseline. */
  gate: GateResult;
  /** Number of fixtures evaluated. */
  fixtureCount: number;
}

const DEFAULT_FIXTURES = path.resolve(
  __dirname,
  '../../tests/fixtures/sample-outputs.json',
);
const DEFAULT_BASELINE = path.resolve(
  __dirname,
  '../../eval-results/baseline.json',
);
const DEFAULT_LATEST = path.resolve(
  __dirname,
  '../../eval-results/latest.json',
);

/**
 * Loads fixtures from disk.
 *
 * @param fixturePath - Path to the fixtures JSON file.
 * @returns The parsed fixtures.
 */
export async function loadFixtures(fixturePath: string): Promise<Fixture[]> {
  const raw = await fs.readFile(fixturePath, 'utf-8');
  return JSON.parse(raw) as Fixture[];
}

/**
 * Evaluates a set of fixtures: computes average quality metrics over the
 * "good" (non-hallucinated) fixtures, measures hallucination-detection
 * accuracy across all fixtures, and runs the regression gate against baseline.
 *
 * @param fixtures - The fixtures to evaluate.
 * @param baseline - The accepted baseline metrics.
 * @param tolerance - Optional regression tolerance override.
 * @returns A {@link RunEvalResult}.
 */
export function evaluateFixtures(
  fixtures: Fixture[],
  baseline: EvalMetrics,
  tolerance?: number,
): RunEvalResult {
  const evaluator = new RagasEvaluator();
  const detector = new HallucinationDetector();
  const gate = new RegressionGate(tolerance);

  const goodMetrics: EvalMetrics[] = [];
  let correctDetections = 0;

  for (const fx of fixtures) {
    const metrics = evaluator.evaluate(fx.agentOutput, fx.context, fx.query);
    const { isHallucination } = detector.detect(fx.agentOutput, fx.context);

    if (isHallucination === fx.expectedHallucination) correctDetections += 1;
    if (!fx.expectedHallucination) goodMetrics.push(metrics);
  }

  const aggregate = averageMetrics(goodMetrics);
  const detectionAccuracy =
    fixtures.length === 0 ? 0 : correctDetections / fixtures.length;

  return {
    aggregate,
    detectionAccuracy,
    gate: gate.gate(aggregate, baseline),
    fixtureCount: fixtures.length,
  };
}

/** Options for {@link runEval}. */
export interface RunEvalOptions {
  fixturePath?: string;
  baselinePath?: string;
  latestPath?: string;
  /** When true, overwrite the baseline with the new aggregate if the gate passes. */
  updateBaseline?: boolean;
  tolerance?: number;
}

/**
 * End-to-end CI entry point: loads fixtures + baseline, evaluates, writes the
 * latest results, and optionally updates the baseline.
 *
 * @param options - Optional path/behavior overrides.
 * @returns The {@link RunEvalResult}.
 */
export async function runEval(options: RunEvalOptions = {}): Promise<RunEvalResult> {
  const fixturePath = options.fixturePath ?? DEFAULT_FIXTURES;
  const baselinePath = options.baselinePath ?? DEFAULT_BASELINE;
  const latestPath = options.latestPath ?? DEFAULT_LATEST;

  const gate = new RegressionGate(options.tolerance);
  const fixtures = await loadFixtures(fixturePath);

  // Missing baseline → seed it from this run (treated as a pass).
  const baseline =
    (await gate.loadBaseline(baselinePath)) ??
    ({ faithfulness: 0, contextPrecision: 0, relevance: 0 } as EvalMetrics);

  const result = evaluateFixtures(fixtures, baseline, options.tolerance);

  await fs.mkdir(path.dirname(latestPath), { recursive: true });
  await fs.writeFile(
    latestPath,
    `${JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        aggregate: result.aggregate,
        detectionAccuracy: result.detectionAccuracy,
        gate: result.gate,
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );

  if (options.updateBaseline && result.gate.passed) {
    await gate.saveBaseline(baselinePath, result.aggregate);
  }

  return result;
}

/**
 * Averages a list of metric bundles.
 *
 * @param list - Metric bundles.
 * @returns The element-wise mean (all zeros for an empty list).
 */
function averageMetrics(list: EvalMetrics[]): EvalMetrics {
  if (list.length === 0) {
    return { faithfulness: 0, contextPrecision: 0, relevance: 0 };
  }
  const sum = list.reduce(
    (acc, m) => ({
      faithfulness: acc.faithfulness + m.faithfulness,
      contextPrecision: acc.contextPrecision + m.contextPrecision,
      relevance: acc.relevance + m.relevance,
    }),
    { faithfulness: 0, contextPrecision: 0, relevance: 0 },
  );
  return {
    faithfulness: sum.faithfulness / list.length,
    contextPrecision: sum.contextPrecision / list.length,
    relevance: sum.relevance / list.length,
  };
}

/**
 * Formats a {@link RunEvalResult} as a Markdown report (used in CI PR comments).
 * Baseline values are read from {@link GateResult.details} inside `result`.
 *
 * @param result - The run result.
 * @returns A Markdown string.
 */
export function formatReport(result: RunEvalResult): string {
  const rows = result.gate.details
    .map(
      (d) =>
        `| ${d.metric} | ${d.current.toFixed(3)} | ${d.baseline.toFixed(3)} | ${d.floor.toFixed(
          3,
        )} | ${d.regressed ? '❌ regressed' : '✅'} |`,
    )
    .join('\n');

  return [
    '## 🤖 Agent Evaluation Report',
    '',
    `**Gate:** ${result.gate.passed ? '✅ PASSED' : '❌ BLOCKED'}`,
    `**Hallucination detection accuracy:** ${(result.detectionAccuracy * 100).toFixed(1)}% (${result.fixtureCount} fixtures)`,
    '',
    '| Metric | Current | Baseline | Floor (−5%) | Status |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    result.gate.passed
      ? '_No regressions detected._'
      : `**Blocked by:** ${result.gate.blockedBy.join(', ')}`,
  ].join('\n');
}

/* istanbul ignore next -- CLI bootstrap, exercised in CI not unit tests. */
if (require.main === module) {
  const updateBaseline = process.argv.includes('--update-baseline');
  runEval({ updateBaseline })
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(formatReport(result));
      if (!result.gate.passed) {
        // eslint-disable-next-line no-console
        console.error('\nRegression gate FAILED — blocking.');
        process.exit(1);
      }
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
