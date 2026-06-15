import { CostTracker } from '../../src/monitoring/cost-tracker';

describe('CostTracker', () => {
  it('computes cost for a known model (happy path)', () => {
    const tracker = new CostTracker();
    // gpt-4o: $2.50 / 1M input, $10.00 / 1M output.
    const result = tracker.track(1_000_000, 1_000_000, 'gpt-4o');
    expect(result.cost).toBeCloseTo(12.5, 6);
    expect(result.totalTokens).toBe(2_000_000);
  });

  it('prices each supported model differently', () => {
    const t1 = new CostTracker();
    const t2 = new CostTracker();
    const t3 = new CostTracker();
    const opus = t1.track(1_000_000, 0, 'claude-opus-4').cost;
    const gpt = t2.track(1_000_000, 0, 'gpt-4o').cost;
    const llama = t3.track(1_000_000, 0, 'llama3.1-8b').cost;
    expect(opus).toBeGreaterThan(gpt);
    expect(gpt).toBeGreaterThan(llama);
  });

  it('accumulates a running summary (happy path)', () => {
    const tracker = new CostTracker();
    tracker.track(1_000_000, 0, 'gpt-4o'); // 2.5
    tracker.track(1_000_000, 0, 'gpt-4o'); // 2.5
    const summary = tracker.getSummary();
    expect(summary.requestCount).toBe(2);
    expect(summary.totalCost).toBeCloseTo(5, 6);
    expect(summary.avgCostPerRequest).toBeCloseTo(2.5, 6);
  });

  it('returns a zeroed summary before any request (edge case)', () => {
    const tracker = new CostTracker();
    const summary = tracker.getSummary();
    expect(summary).toEqual({ totalCost: 0, avgCostPerRequest: 0, requestCount: 0 });
  });

  it('throws for an unknown model (failure mode)', () => {
    const tracker = new CostTracker();
    expect(() => tracker.track(100, 100, 'gpt-9-ultra')).toThrow(/unknown model/i);
  });

  it('throws for negative token counts (failure mode)', () => {
    const tracker = new CostTracker();
    expect(() => tracker.track(-1, 0, 'gpt-4o')).toThrow(/non-negative/i);
  });

  it('handles a zero-token request as zero cost (boundary)', () => {
    const tracker = new CostTracker();
    const result = tracker.track(0, 0, 'llama3.1-8b');
    expect(result.cost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('exposes the list of supported models', () => {
    expect(CostTracker.supportedModels()).toEqual(
      expect.arrayContaining([
        'gpt-4o',
        'claude-opus-4',
        'llama3.1-8b',
        'qwen2.5-coder:7b',
        'ollama-llama3.1-8b',
      ]),
    );
  });

  it('prices local qwen2.5-coder:7b at zero cost', () => {
    const tracker = new CostTracker();
    const result = tracker.track(1_000_000, 1_000_000, 'qwen2.5-coder:7b');
    expect(result.cost).toBe(0);
    expect(result.totalTokens).toBe(2_000_000);
  });

  it('resolves ollama-llama3.1-8b alias to llama3.1-8b pricing', () => {
    const canonical = new CostTracker();
    const alias = new CostTracker();
    const viaCanonical = canonical.track(1_000_000, 0, 'llama3.1-8b').cost;
    const viaAlias = alias.track(1_000_000, 0, 'ollama-llama3.1-8b').cost;
    expect(viaAlias).toBeCloseTo(viaCanonical, 6);
  });
});
