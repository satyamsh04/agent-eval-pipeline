import { RagasEvaluator } from './ragas-evaluator';

/** Result of a hallucination check. */
export interface HallucinationResult {
  /** True when the output is judged to be hallucinated. */
  isHallucination: boolean;
  /** The underlying faithfulness score (0–1). */
  score: number;
  /** Human-readable explanation of the decision. */
  reason: string;
}

/** Default faithfulness threshold below which output is flagged. */
export const DEFAULT_HALLUCINATION_THRESHOLD = 0.7;

/**
 * Flags agent outputs that are not sufficiently grounded in their context.
 *
 * An output is a hallucination when its faithfulness score falls below the
 * configured threshold (default 0.70).
 */
export class HallucinationDetector {
  private readonly evaluator: RagasEvaluator;
  private readonly threshold: number;

  /**
   * @param threshold - Faithfulness threshold below which output is flagged
   *                    (default {@link DEFAULT_HALLUCINATION_THRESHOLD}).
   * @param evaluator - Optional injected evaluator (defaults to a new one).
   */
  constructor(
    threshold: number = DEFAULT_HALLUCINATION_THRESHOLD,
    evaluator: RagasEvaluator = new RagasEvaluator(),
  ) {
    this.threshold = threshold;
    this.evaluator = evaluator;
  }

  /**
   * Detects whether an output is hallucinated relative to its context.
   *
   * @param output - The agent's output text.
   * @param context - The context chunks the output should be grounded in.
   * @returns A {@link HallucinationResult}.
   */
  detect(output: string, context: string[]): HallucinationResult {
    if (!output.trim()) {
      return {
        isHallucination: true,
        score: 0,
        reason: 'Empty output cannot be grounded in any context.',
      };
    }
    if (context.length === 0) {
      return {
        isHallucination: true,
        score: 0,
        reason: 'No context supplied — output is ungrounded by definition.',
      };
    }

    const score = this.evaluator.evaluateFaithfulness(output, context);
    const isHallucination = score < this.threshold;

    const reason = isHallucination
      ? `Faithfulness ${score.toFixed(2)} is below threshold ${this.threshold.toFixed(
          2,
        )}; output is not adequately supported by the context.`
      : `Faithfulness ${score.toFixed(2)} meets threshold ${this.threshold.toFixed(
          2,
        )}; output is adequately grounded.`;

    return { isHallucination, score, reason };
  }
}
