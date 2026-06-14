import { RagasEvaluator, type EvalMetrics } from '../../src/eval/ragas-evaluator';

describe('RagasEvaluator', () => {
  const evaluator = new RagasEvaluator();
  const context = [
    'Paris is the capital and most populous city of France.',
    'France is a country in Western Europe.',
  ];

  describe('evaluateFaithfulness', () => {
    it('returns a high score for output grounded in context (happy path)', () => {
      const score = evaluator.evaluateFaithfulness(
        'The capital of France is Paris.',
        context,
      );
      expect(score).toBeGreaterThanOrEqual(0.7);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('returns a low score for output unsupported by context (failure mode)', () => {
      const score = evaluator.evaluateFaithfulness(
        'Bananas are an excellent source of potassium.',
        context,
      );
      expect(score).toBeLessThan(0.3);
    });

    it('returns 0 when context is empty (edge case)', () => {
      expect(evaluator.evaluateFaithfulness('Anything here', [])).toBe(0);
    });

    it('returns 0 when output is empty (edge case)', () => {
      expect(evaluator.evaluateFaithfulness('', context)).toBe(0);
    });

    it('always returns a value within [0, 1] (boundary)', () => {
      const score = evaluator.evaluateFaithfulness(
        'Paris France capital Paris France capital',
        context,
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('evaluateContextPrecision', () => {
    it('returns 1 when all context chunks are relevant (happy path)', () => {
      const score = evaluator.evaluateContextPrecision(
        'The capital of France is Paris.',
        ['Paris is the capital of France.', 'France borders Spain and Germany, near Paris.'],
      );
      expect(score).toBeCloseTo(1, 5);
    });

    it('penalizes an irrelevant chunk ranked first (ordering matters)', () => {
      const relevantFirst = evaluator.evaluateContextPrecision('Paris France capital', [
        'Paris is the capital of France.',
        'The recipe calls for two eggs and flour.',
      ]);
      const irrelevantFirst = evaluator.evaluateContextPrecision('Paris France capital', [
        'The recipe calls for two eggs and flour.',
        'Paris is the capital of France.',
      ]);
      expect(irrelevantFirst).toBeLessThan(relevantFirst);
    });

    it('returns 0 when no context chunk is relevant (failure mode)', () => {
      const score = evaluator.evaluateContextPrecision('Quantum chromodynamics gluons', [
        'The cat sat on the mat.',
      ]);
      expect(score).toBe(0);
    });

    it('returns 0 for empty context (edge case)', () => {
      expect(evaluator.evaluateContextPrecision('anything', [])).toBe(0);
    });

    it('stays within [0, 1] (boundary)', () => {
      const score = evaluator.evaluateContextPrecision('Paris France', context);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('evaluateRelevance', () => {
    it('scores higher when output answers the query (happy path)', () => {
      const relevant = evaluator.evaluateRelevance(
        'The capital of France is Paris.',
        'What is the capital of France?',
      );
      const irrelevant = evaluator.evaluateRelevance(
        'The mitochondria is the powerhouse of the cell.',
        'What is the capital of France?',
      );
      expect(relevant).toBeGreaterThan(irrelevant);
    });

    it('returns 0 for an empty query (edge case)', () => {
      expect(evaluator.evaluateRelevance('Some answer', '')).toBe(0);
    });

    it('returns 0 for an empty output (edge case)', () => {
      expect(evaluator.evaluateRelevance('', 'What is the capital?')).toBe(0);
    });

    it('returns a value in [0, 1] (boundary)', () => {
      const score = evaluator.evaluateRelevance('Paris', 'capital of France Paris');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('evaluate', () => {
    it('returns all three metrics as a bundle', () => {
      const metrics: EvalMetrics = evaluator.evaluate(
        'The capital of France is Paris.',
        context,
        'What is the capital of France?',
      );
      expect(metrics).toHaveProperty('faithfulness');
      expect(metrics).toHaveProperty('contextPrecision');
      expect(metrics).toHaveProperty('relevance');
      for (const value of Object.values(metrics)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    });
  });
});
