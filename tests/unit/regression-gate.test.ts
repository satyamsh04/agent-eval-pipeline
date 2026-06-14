import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { RegressionGate } from '../../src/eval/regression-gate';
import type { EvalMetrics } from '../../src/eval/ragas-evaluator';

describe('RegressionGate', () => {
  const gate = new RegressionGate(); // 5% tolerance
  const baseline: EvalMetrics = {
    faithfulness: 0.75,
    contextPrecision: 0.72,
    relevance: 0.78,
  };

  it('passes when metrics improve over baseline (happy path)', () => {
    const result = gate.gate(
      { faithfulness: 0.8, contextPrecision: 0.8, relevance: 0.85 },
      baseline,
    );
    expect(result.passed).toBe(true);
    expect(result.blockedBy).toHaveLength(0);
  });

  it('passes when metrics dip within the 5% tolerance (boundary)', () => {
    // 5% below faithfulness floor = 0.7125 — still acceptable.
    const result = gate.gate(
      { faithfulness: 0.72, contextPrecision: 0.7, relevance: 0.77 },
      baseline,
    );
    expect(result.passed).toBe(true);
  });

  it('blocks when a single metric regresses beyond tolerance (failure mode)', () => {
    const result = gate.gate(
      { faithfulness: 0.6, contextPrecision: 0.72, relevance: 0.78 },
      baseline,
    );
    expect(result.passed).toBe(false);
    expect(result.blockedBy).toContain('faithfulness');
    expect(result.blockedBy).not.toContain('relevance');
  });

  it('lists every regressing metric (failure mode)', () => {
    const result = gate.gate(
      { faithfulness: 0.1, contextPrecision: 0.1, relevance: 0.1 },
      baseline,
    );
    expect(result.passed).toBe(false);
    expect(result.blockedBy).toEqual(
      expect.arrayContaining(['faithfulness', 'contextPrecision', 'relevance']),
    );
    expect(result.blockedBy).toHaveLength(3);
  });

  it('treats the exact floor value as passing (boundary)', () => {
    const result = gate.gate(
      {
        faithfulness: 0.75 * 0.95,
        contextPrecision: 0.72 * 0.95,
        relevance: 0.78 * 0.95,
      },
      baseline,
    );
    expect(result.passed).toBe(true);
  });

  it('returns null for a missing baseline file (edge case)', async () => {
    const missing = path.join(os.tmpdir(), `nope-${Date.now()}.json`);
    expect(await gate.loadBaseline(missing)).toBeNull();
  });

  it('saves and reloads a baseline round-trip', async () => {
    const file = path.join(os.tmpdir(), `baseline-${Date.now()}.json`);
    await gate.saveBaseline(file, baseline);
    const loaded = await gate.loadBaseline(file);
    expect(loaded).toEqual(baseline);
    await fs.rm(file, { force: true });
  });
});
