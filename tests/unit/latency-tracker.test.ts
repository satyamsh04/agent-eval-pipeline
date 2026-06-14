import { LatencyTracker } from '../../src/monitoring/latency-tracker';

describe('LatencyTracker', () => {
  it('measures elapsed time between start and stop (happy path)', () => {
    const tracker = new LatencyTracker();
    const id = tracker.start();
    const elapsed = tracker.stop(id);
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(tracker.count()).toBe(1);
  });

  it('computes p50 and p95 from recorded samples', () => {
    const tracker = new LatencyTracker();
    for (let i = 1; i <= 100; i++) tracker.record(i);
    // Nearest-rank: p50 of 1..100 -> 50, p95 -> 95.
    expect(tracker.getP50()).toBe(50);
    expect(tracker.getP95()).toBe(95);
  });

  it('returns 0 for percentiles when there are no samples (edge case)', () => {
    const tracker = new LatencyTracker();
    expect(tracker.getP50()).toBe(0);
    expect(tracker.getP95()).toBe(0);
  });

  it('throws when stopping an unknown id (failure mode)', () => {
    const tracker = new LatencyTracker();
    expect(() => tracker.stop(999)).toThrow(/unknown latency id/i);
  });

  it('evicts oldest samples beyond capacity (ring buffer boundary)', () => {
    const tracker = new LatencyTracker(3);
    tracker.record(10);
    tracker.record(20);
    tracker.record(30);
    tracker.record(40); // evicts 10
    expect(tracker.count()).toBe(3);
    // Remaining samples are 20,30,40 -> p50 (nearest-rank) = 30.
    expect(tracker.getP50()).toBe(30);
  });

  it('clamps negative durations to 0 (boundary)', () => {
    const tracker = new LatencyTracker();
    tracker.record(-5);
    expect(tracker.getP50()).toBe(0);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new LatencyTracker(0)).toThrow();
  });
});
