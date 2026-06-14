import {
  cosineSimilarity,
  splitSentences,
  termFrequency,
  textSimilarity,
} from '../utils/text';

/** The three RAGAS-style quality scores produced for an agent output. */
export interface EvalMetrics {
  /** How well the output is supported by the provided context (0–1). */
  faithfulness: number;
  /** How relevant the retrieved context is to the output (0–1). */
  contextPrecision: number;
  /** How well the output answers the original query (0–1). */
  relevance: number;
}

/**
 * Relevance threshold above which a context chunk is considered "relevant" to
 * the output when computing context precision.
 */
const CONTEXT_RELEVANCE_THRESHOLD = 0.1;

/**
 * Offline RAGAS-style evaluator.
 *
 * Uses term-frequency cosine similarity as a deterministic proxy for the
 * embedding/LLM scorers a hosted RAGAS implementation would call. This keeps
 * evaluation reproducible and runnable in CI without API keys.
 */
export class RagasEvaluator {
  /**
   * Faithfulness: the degree to which the output is grounded in the context.
   *
   * For each sentence in the output we take its maximum similarity to any
   * context chunk, then average across sentences. An ungrounded sentence drags
   * the score down — the signal used by the hallucination detector.
   *
   * @param output - The agent's output text.
   * @param context - The context chunks the output should be grounded in.
   * @returns Faithfulness score in [0, 1].
   */
  evaluateFaithfulness(output: string, context: string[]): number {
    const sentences = splitSentences(output);
    if (sentences.length === 0 || context.length === 0) return 0;

    const contextVectors = context.map((c) => termFrequency(c));

    let total = 0;
    for (const sentence of sentences) {
      const sentenceVector = termFrequency(sentence);
      let best = 0;
      for (const cv of contextVectors) {
        const sim = cosineSimilarity(sentenceVector, cv);
        if (sim > best) best = sim;
      }
      total += best;
    }
    return clamp01(total / sentences.length);
  }

  /**
   * Context precision (RAGAS precision@k): rewards context that is relevant to
   * the output and ranked highly. Context chunks are ranked by similarity to
   * the output; precision@k is averaged over the positions of relevant chunks.
   *
   * @param output - The agent's output text.
   * @param context - The retrieved context chunks, in retrieval order.
   * @returns Context precision score in [0, 1].
   */
  evaluateContextPrecision(output: string, context: string[]): number {
    if (context.length === 0 || !output.trim()) return 0;

    const outputVector = termFrequency(output);
    const scored = context.map((chunk) => ({
      relevant: cosineSimilarity(outputVector, termFrequency(chunk)) >=
        CONTEXT_RELEVANCE_THRESHOLD,
    }));

    let relevantSeen = 0;
    let precisionSum = 0;
    let totalRelevant = 0;

    scored.forEach((item, index) => {
      if (item.relevant) {
        relevantSeen += 1;
        precisionSum += relevantSeen / (index + 1);
        totalRelevant += 1;
      }
    });

    if (totalRelevant === 0) return 0;
    return clamp01(precisionSum / totalRelevant);
  }

  /**
   * Answer relevance: how well the output addresses the original query.
   *
   * @param output - The agent's output text.
   * @param query - The original user query.
   * @returns Relevance score in [0, 1].
   */
  evaluateRelevance(output: string, query: string): number {
    if (!output.trim() || !query.trim()) return 0;
    return clamp01(textSimilarity(output, query));
  }

  /**
   * Convenience method computing all three metrics at once.
   *
   * @param output - The agent's output text.
   * @param context - The context chunks.
   * @param query - The original user query.
   * @returns The full {@link EvalMetrics} bundle.
   */
  evaluate(output: string, context: string[], query: string): EvalMetrics {
    return {
      faithfulness: this.evaluateFaithfulness(output, context),
      contextPrecision: this.evaluateContextPrecision(output, context),
      relevance: this.evaluateRelevance(output, query),
    };
  }
}

/**
 * Clamps a number into the [0, 1] range.
 *
 * @param value - The raw value.
 * @returns The clamped value.
 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
