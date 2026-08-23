import { MemoryRateLimiter } from "@rudra/rate-limit";
import { RudraError } from "@rudra/errors";
import { GatewayHttpError } from "./errors.js";

export class ConcurrentLimiter {
  private readonly active = new Map<string, number>();

  constructor(private readonly max: number) {}

  acquire(key: string): () => void {
    const current = this.active.get(key) ?? 0;
    if (current >= this.max) {
      throw new GatewayHttpError("RATE_LIMITED", "The assistant is temporarily unavailable.", 429, {
        retryable: true,
        retryAfterMs: 1000,
      });
    }
    this.active.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.active.get(key) ?? 1) - 1;
      if (next <= 0) this.active.delete(key);
      else this.active.set(key, next);
    };
  }
}

export function createAssistantRateLimiter(requestsPerMinute: number): MemoryRateLimiter {
  return new MemoryRateLimiter({ windowMs: 60_000, max: requestsPerMinute });
}

export function consumeOrThrow(limiter: MemoryRateLimiter, key: string) {
  try {
    return limiter.consume(key);
  } catch (error) {
    if (error instanceof RudraError && error.code === "RATE_LIMITED") {
      const details = error.details as { resetAt?: number } | undefined;
      const resetAt = typeof details?.resetAt === "number" ? details.resetAt : Date.now() + 60_000;
      throw new GatewayHttpError("RATE_LIMITED", "The assistant is temporarily unavailable.", 429, {
        retryable: true,
        retryAfterMs: Math.max(0, resetAt - Date.now()),
      });
    }
    throw error;
  }
}
