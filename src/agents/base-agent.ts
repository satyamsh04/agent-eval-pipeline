/**
 * Strongly-typed contract that every concrete agent in the pipeline implements.
 *
 * Keeping the input/output shapes generic lets the evaluation layer treat all
 * agents uniformly while preserving compile-time type safety for each one.
 */

/** Standard envelope describing a single agent invocation. */
export interface AgentRequest {
  /** The user query / task prompt. */
  query: string;
  /** Retrieved context chunks the agent may ground its answer in. */
  context: string[];
  /** Optional free-form metadata (e.g. session id, user id). */
  metadata?: Record<string, unknown>;
}

/** Standard envelope describing an agent's produced result. */
export interface AgentResponse {
  /** The agent's natural-language output. */
  output: string;
  /** Model identifier used to produce the output. */
  model: string;
  /** Token usage for cost accounting. */
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Abstract base class for all agents.
 *
 * @typeParam TInput  - Concrete request shape (defaults to {@link AgentRequest}).
 * @typeParam TOutput - Concrete response shape (defaults to {@link AgentResponse}).
 */
export abstract class BaseAgent<
  TInput extends AgentRequest = AgentRequest,
  TOutput extends AgentResponse = AgentResponse,
> {
  /**
   * @param name - Human-readable agent name, surfaced in metrics and logs.
   */
  protected constructor(public readonly name: string) {}

  /**
   * Executes the agent against a typed request.
   *
   * @param input - The typed agent request.
   * @returns A promise resolving to the typed agent response.
   */
  abstract run(input: TInput): Promise<TOutput>;

  /**
   * Lightweight validation shared by all agents. Override to extend.
   *
   * @param input - The request to validate.
   * @throws {Error} If the request is structurally invalid.
   */
  protected validate(input: TInput): void {
    if (typeof input.query !== 'string' || input.query.trim().length === 0) {
      throw new Error(`[${this.name}] "query" must be a non-empty string.`);
    }
    if (!Array.isArray(input.context)) {
      throw new Error(`[${this.name}] "context" must be an array of strings.`);
    }
  }
}
