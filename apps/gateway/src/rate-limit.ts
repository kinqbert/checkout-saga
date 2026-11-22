import { HttpException, HttpStatus } from "@nestjs/common";

interface HeaderSink {
  setHeader(name: string, value: string | number): unknown;
}

/**
 * In-memory token bucket per client IP: `capacity` requests at once, refilled
 * at `refillPerSecond`. Enough to keep a public demo on one VPS from being
 * flooded; a multi-instance deployment would keep the buckets in Redis or at
 * the edge.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  /** Spends one token for `key`, or throws 429 with Retry-After when none is left. */
  take(key: string, res?: HeaderSink): void {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSecond);
    b.at = now;
    if (this.buckets.size > 10_000) this.buckets.clear();
    this.buckets.set(key, b);

    res?.setHeader("RateLimit-Limit", this.capacity);
    if (b.tokens < 1) {
      const waitSeconds = Math.max(1, Math.ceil((1 - b.tokens) / this.refillPerSecond));
      res?.setHeader("RateLimit-Remaining", 0);
      res?.setHeader("Retry-After", waitSeconds);
      throw new HttpException(
        { error: `Too many orders: the limit is ${this.refillPerSecond} per second.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    b.tokens -= 1;
    res?.setHeader("RateLimit-Remaining", Math.floor(b.tokens));
  }
}
