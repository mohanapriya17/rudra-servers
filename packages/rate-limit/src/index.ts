import { RudraError } from "@rudra/errors";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Counter>();

  constructor(private readonly options: RateLimitOptions) {}

  consume(key: string): { remaining: number; resetAt: number } {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.options.windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { remaining: this.options.max - 1, resetAt };
    }
    if (existing.count >= this.options.max) {
      throw new RudraError("RATE_LIMITED", "Rate limit exceeded", {
        details: { resetAt: existing.resetAt },
      });
    }
    existing.count += 1;
    return { remaining: this.options.max - existing.count, resetAt: existing.resetAt };
  }
}

export function createDefaultHttpLimiter(): MemoryRateLimiter {
  return new MemoryRateLimiter({ windowMs: 60_000, max: 100 });
}
