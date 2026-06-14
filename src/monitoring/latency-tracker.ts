import { performance } from 'perf_hooks';

/**
 * Tracks request latency using an in-memory ring buffer and exposes p50/p95
 * percentiles. No external dependency — suitable for embedding directly in the
 * request path.
 */
export class LatencyTracker {
  private readonly capacity: number;
  private readonly samples: number[] = [];
  private readonly pending = new Map<number, number>();
  private nextId = 1;

  /**
   * @param capacity - Maximum number of latency samples retained (ring buffer
   *                   window). Defaults to 1000.
   */
  constructor(capacity = 1000) {
    if (capacity <= 0) throw new Error('capacity must be a positive integer.');
    this.capacity = capacity;
  }

  /**
   * Marks the start of a request.
   *
   * @returns An opaque id to pass to {@link stop}.
   */
  start(): number {
    const id = this.nextId++;
    this.pending.set(id, performance.now());
    return id;
  }

  /**
   * Marks the end of a request and records its duration.
   *
   * @param id - The id returned by {@link start}.
   * @returns The elapsed milliseconds.
   * @throws {Error} If the id is unknown (already stopped or never started).
   */
  stop(id: number): number {
    const startedAt = this.pending.get(id);
    if (startedAt === undefined) {
      throw new Error(`Unknown latency id: ${id}`);
    }
    this.pending.delete(id);
    const elapsed = performance.now() - startedAt;
    this.record(elapsed);
    return elapsed;
  }

  /**
   * Records a pre-measured duration directly into the buffer. Useful for
   * back-filling or testing.
   *
   * @param ms - Duration in milliseconds (negatives are clamped to 0).
   */
  record(ms: number): void {
    const value = ms < 0 ? 0 : ms;
    this.samples.push(value);
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /**
   * @returns The 50th-percentile (median) latency in ms, or 0 if no samples.
   */
  getP50(): number {
    return this.percentile(50);
  }

  /**
   * @returns The 95th-percentile latency in ms, or 0 if no samples.
   */
  getP95(): number {
    return this.percentile(95);
  }

  /**
   * @returns The number of samples currently in the buffer.
   */
  count(): number {
    return this.samples.length;
  }

  /**
   * Computes a percentile using the nearest-rank method.
   *
   * @param p - Percentile in (0, 100].
   * @returns The percentile value, or 0 when there are no samples.
   */
  private percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    return sorted[index] as number;
  }
}
