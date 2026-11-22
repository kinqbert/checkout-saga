import { HttpException, HttpStatus } from "@nestjs/common";

interface HeaderSink {
  setHeader(name: string, value: string | number): unknown;
}

// in-memory token bucket per IP; several instances would keep the buckets in Redis.
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

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
