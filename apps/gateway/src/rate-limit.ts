import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Tiny in-memory token bucket per client IP. Enough to keep a public demo on a
 * single VPS from being flooded; a real deployment would do this at the edge.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  take(key: string): void {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSecond);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      throw new HttpException({ error: "slow down a little" }, HttpStatus.TOO_MANY_REQUESTS);
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
  }
}
