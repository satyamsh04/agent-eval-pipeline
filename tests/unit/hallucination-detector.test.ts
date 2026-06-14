import {
  HallucinationDetector,
  DEFAULT_HALLUCINATION_THRESHOLD,
} from '../../src/eval/hallucination-detector';

describe('HallucinationDetector', () => {
  const detector = new HallucinationDetector();
  const context = [
    'The Eiffel Tower is a wrought-iron lattice tower located in Paris, France.',
    'It was completed in 1889 for the World Fair.',
  ];

  it('does not flag well-grounded output (happy path)', () => {
    const result = detector.detect(
      'The Eiffel Tower is located in Paris, France.',
      context,
    );
    expect(result.isHallucination).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_HALLUCINATION_THRESHOLD);
    expect(typeof result.reason).toBe('string');
  });

  it('flags fabricated output not supported by context (failure mode)', () => {
    const result = detector.detect(
      'The Eiffel Tower is made entirely of solid gold and floats in the sky.',
      context,
    );
    expect(result.isHallucination).toBe(true);
    expect(result.score).toBeLessThan(DEFAULT_HALLUCINATION_THRESHOLD);
  });

  it('flags empty output as hallucination (edge case)', () => {
    const result = detector.detect('', context);
    expect(result.isHallucination).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/empty/i);
  });

  it('flags output when no context is provided (edge case)', () => {
    const result = detector.detect('Some confident claim.', []);
    expect(result.isHallucination).toBe(true);
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/no context/i);
  });

  it('respects a custom threshold (boundary)', () => {
    const strict = new HallucinationDetector(0.99);
    const lenient = new HallucinationDetector(0.05);
    const output = 'The Eiffel Tower is located in Paris, France.';
    expect(strict.detect(output, context).isHallucination).toBe(true);
    expect(lenient.detect(output, context).isHallucination).toBe(false);
  });

  it('returns a score within [0, 1] for any input (boundary)', () => {
    const result = detector.detect('Paris France tower located', context);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
