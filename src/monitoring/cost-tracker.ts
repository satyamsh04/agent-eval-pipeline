/** Result of tracking a single request's cost. */
export interface CostResult {
  /** Estimated USD cost for this request. */
  cost: number;
  /** Total tokens (input + output) for this request. */
  totalTokens: number;
}

/** Rolling cost summary across all tracked requests. */
export interface CostSummary {
  /** Total USD cost across all requests. */
  totalCost: number;
  /** Average USD cost per request (0 when no requests). */
  avgCostPerRequest: number;
  /** Number of requests tracked. */
  requestCount: number;
}

/** Per-model pricing in USD per 1,000,000 tokens. */
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/** Supported model identifiers (canonical pricing keys). */
export type SupportedModel =
  | 'gpt-4o'
  | 'claude-opus-4'
  | 'llama3.1-8b'
  | 'ollama-llama3.1-8b'
  | 'qwen2.5-coder:7b';

/**
 * Estimated public pricing (USD per 1M tokens). Values are approximate and
 * centralized here so they are trivial to update.
 *
 * Local/Ollama models are priced at $0 — they incur no API spend.
 */
const PRICING: Record<SupportedModel, ModelPricing> = {
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'claude-opus-4': { inputPer1M: 15.0, outputPer1M: 75.0 },
  'llama3.1-8b': { inputPer1M: 0.05, outputPer1M: 0.08 },
  'ollama-llama3.1-8b': { inputPer1M: 0, outputPer1M: 0 },
  'qwen2.5-coder:7b': { inputPer1M: 0, outputPer1M: 0 },
};

/**
 * Estimates and accumulates LLM token cost per request.
 */
export class CostTracker {
  private totalCost = 0;
  private requestCount = 0;

  /**
   * Tracks the cost of a single request and adds it to the running total.
   *
   * @param inputTokens - Prompt token count (non-negative).
   * @param outputTokens - Completion token count (non-negative).
   * @param model - One of the supported model identifiers.
   * @returns The {@link CostResult} for this request.
   * @throws {Error} If the model is unknown or token counts are negative.
   */
  track(
    inputTokens: number,
    outputTokens: number,
    model: string,
  ): CostResult {
    if (inputTokens < 0 || outputTokens < 0) {
      throw new Error('Token counts must be non-negative.');
    }
    const pricing = PRICING[model as SupportedModel];
    if (!pricing) {
      throw new Error(
        `Unknown model "${model}". Supported: ${CostTracker.supportedModels().join(', ')}.`,
      );
    }

    const cost =
      (inputTokens / 1_000_000) * pricing.inputPer1M +
      (outputTokens / 1_000_000) * pricing.outputPer1M;

    this.totalCost += cost;
    this.requestCount += 1;

    return { cost, totalTokens: inputTokens + outputTokens };
  }

  /**
   * @returns The rolling {@link CostSummary} across all tracked requests.
   */
  getSummary(): CostSummary {
    return {
      totalCost: this.totalCost,
      avgCostPerRequest:
        this.requestCount === 0 ? 0 : this.totalCost / this.requestCount,
      requestCount: this.requestCount,
    };
  }

  /**
   * Resets all accumulated state (useful for tests / scoped windows).
   */
  reset(): void {
    this.totalCost = 0;
    this.requestCount = 0;
  }

  /**
   * Lists every model identifier accepted by {@link track}.
   *
   * @returns All supported model identifiers.
   */
  static supportedModels(): string[] {
    return Object.keys(PRICING);
  }
}
