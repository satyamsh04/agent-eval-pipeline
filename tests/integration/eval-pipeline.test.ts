import path from 'path';
import request from 'supertest';
import { createApp } from '../../src/api/server';
import {
  evaluateFixtures,
  loadFixtures,
  type Fixture,
} from '../../src/eval/run-eval';
import { RegressionGate } from '../../src/eval/regression-gate';
import type { EvalMetrics } from '../../src/eval/ragas-evaluator';

const FIXTURES = path.resolve(__dirname, '../fixtures/sample-outputs.json');
const BASELINE = path.resolve(__dirname, '../../eval-results/baseline.json');

describe('Integration: HTTP API', () => {
  const app = createApp();

  it('GET /health returns ok with a timestamp', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('POST /evaluate returns metrics, hallucination, cost and latency', async () => {
    const res = await request(app)
      .post('/evaluate')
      .send({
        agentOutput: 'The capital of France is Paris.',
        context: ['Paris is the capital and most populous city of France.'],
        query: 'What is the capital of France?',
        model: 'gpt-4o',
        inputTokens: 120,
        outputTokens: 30,
      });

    expect(res.status).toBe(200);
    expect(res.body.metrics).toHaveProperty('faithfulness');
    expect(res.body.metrics).toHaveProperty('contextPrecision');
    expect(res.body.metrics).toHaveProperty('relevance');
    expect(res.body.hallucination.isHallucination).toBe(false);
    expect(res.body.cost.cost).toBeGreaterThan(0);
    expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('POST /evaluate flags a hallucinated output', async () => {
    const res = await request(app)
      .post('/evaluate')
      .send({
        agentOutput: 'The capital of France is Tokyo, a city in Japan.',
        context: ['Paris is the capital and most populous city of France.'],
        query: 'What is the capital of France?',
        model: 'gpt-4o',
      });
    expect(res.status).toBe(200);
    expect(res.body.hallucination.isHallucination).toBe(true);
  });

  it('POST /evaluate rejects a malformed body with 400', async () => {
    const res = await request(app)
      .post('/evaluate')
      .send({ context: [], query: 'x', model: 'gpt-4o' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /evaluate rejects an unknown model with 400', async () => {
    const res = await request(app)
      .post('/evaluate')
      .send({
        agentOutput: 'Paris is the capital of France.',
        context: ['Paris is the capital of France.'],
        query: 'capital of France?',
        model: 'totally-made-up-model',
      });
    expect(res.status).toBe(400);
  });

  it('GET /metrics returns aggregated summary stats after requests', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.latency).toHaveProperty('p50Ms');
    expect(res.body.latency).toHaveProperty('p95Ms');
    expect(res.body.cost).toHaveProperty('totalCost');
    expect(res.body.accuracy).toHaveProperty('avgFaithfulness');
  });

  it('GET /prometheus exposes metrics in text format', async () => {
    const res = await request(app).get('/prometheus');
    expect(res.status).toBe(200);
    expect(res.text).toContain('agent_eval_');
  });
});

describe('Integration: fixture evaluation pipeline', () => {
  let fixtures: Fixture[];

  beforeAll(async () => {
    fixtures = await loadFixtures(FIXTURES);
  });

  it('loads exactly 10 fixtures', () => {
    expect(fixtures).toHaveLength(10);
  });

  it('detects hallucination labels with high accuracy', () => {
    const baseline: EvalMetrics = {
      faithfulness: 0.75,
      contextPrecision: 0.72,
      relevance: 0.78,
    };
    const result = evaluateFixtures(fixtures, baseline);
    expect(result.detectionAccuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('passes the regression gate against the committed baseline', async () => {
    const gate = new RegressionGate();
    const baseline = await gate.loadBaseline(BASELINE);
    expect(baseline).not.toBeNull();
    const result = evaluateFixtures(fixtures, baseline as EvalMetrics);
    expect(result.gate.passed).toBe(true);
    expect(result.gate.blockedBy).toHaveLength(0);
  });

  it('produces aggregate metrics within [0, 1]', () => {
    const baseline: EvalMetrics = {
      faithfulness: 0.75,
      contextPrecision: 0.72,
      relevance: 0.78,
    };
    const { aggregate } = evaluateFixtures(fixtures, baseline);
    for (const value of Object.values(aggregate)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
