import { promises as fs } from 'fs';
import path from 'path';
import type { EvalMetrics } from './ragas-evaluator';

/** Outcome of a regression-gate evaluation. */
export interface GateResult {
  /** True when no metric regressed beyond tolerance. */
  passed: boolean;
  /** Names of the metrics that caused a block (empty when passed). */
  blockedBy: string[];
  /** Per-metric detail for reporting. */
  details: Array<{
    metric: keyof EvalMetrics;
    baseline: number;
    current: number;
    /** Minimum acceptable value = baseline * (1 - tolerance). */
    floor: number;
    regressed: boolean;
  }>;
}

/** Default tolerance: block if a metric drops more than 5% below baseline. */
export const DEFAULT_REGRESSION_TOLERANCE = 0.05;

/**
 * Quality gate that compares freshly-computed evaluation metrics against an
 * accepted baseline and blocks regressions. This is what turns "evaluation"
 * into a hard CI signal.
 */
export class RegressionGate {
  private readonly tolerance: number;

  /**
   * @param tolerance - Fractional drop allowed before blocking
   *                    (default {@link DEFAULT_REGRESSION_TOLERANCE} = 5%).
   */
  constructor(tolerance: number = DEFAULT_REGRESSION_TOLERANCE) {
    this.tolerance = tolerance;
  }

  /**
   * Compares new metrics to a baseline. A metric blocks the gate when it falls
   * more than `tolerance` below its baseline value.
   *
   * @param newMetrics - Freshly computed metrics.
   * @param baseline - The accepted baseline metrics.
   * @returns A {@link GateResult}.
   */
  gate(newMetrics: EvalMetrics, baseline: EvalMetrics): GateResult {
    const keys: Array<keyof EvalMetrics> = [
      'faithfulness',
      'contextPrecision',
      'relevance',
    ];

    const details = keys.map((metric) => {
      const baseValue = baseline[metric];
      const current = newMetrics[metric];
      const floor = baseValue * (1 - this.tolerance);
      // Use a tiny epsilon so exact-floor values are not flagged by float drift.
      const regressed = current < floor - 1e-9;
      return { metric, baseline: baseValue, current, floor, regressed };
    });

    const blockedBy = details
      .filter((d) => d.regressed)
      .map((d) => d.metric as string);

    return { passed: blockedBy.length === 0, blockedBy, details };
  }

  /**
   * Loads a baseline from disk. Returns `null` if the file does not exist,
   * letting a first run seed the baseline rather than fail.
   *
   * @param filePath - Path to the baseline JSON file.
   * @returns The parsed {@link EvalMetrics} or `null`.
   */
  async loadBaseline(filePath: string): Promise<EvalMetrics | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as EvalMetrics;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Persists a new baseline to disk (creating parent directories as needed).
   * Intended to be called only when the gate passes.
   *
   * @param filePath - Path to write the baseline JSON to.
   * @param metrics - The metrics to persist as the new baseline.
   */
  async saveBaseline(filePath: string, metrics: EvalMetrics): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf-8');
  }
}

/**
 * Narrows an unknown error to a Node.js `errno` exception.
 *
 * @param err - The caught value.
 * @returns True if it looks like a `NodeJS.ErrnoException`.
 */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === 'object' && err !== null && 'code' in err;
}
