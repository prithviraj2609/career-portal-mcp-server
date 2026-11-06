import { CareerPortalError } from "./errors.js";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly periodMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): void {
    const now = this.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };
    const refill =
      ((now - bucket.updatedAt) / this.periodMs) * this.capacity;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
    bucket.updatedAt = now;
    if (bucket.tokens < 1) {
      const retryAfterMs = Math.ceil(
        ((1 - bucket.tokens) / this.capacity) * this.periodMs,
      );
      this.buckets.set(key, bucket);
      throw new CareerPortalError(
        "RATE_LIMITED",
        "Provider request rate limit reached",
        true,
        retryAfterMs,
      );
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
  }
}
