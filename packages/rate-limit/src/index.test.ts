import { describe, expect, it } from "vitest";
import { MemoryRateLimiter } from "./index.js";

describe("rate-limit", () => {
  it("limits after max", () => {
    const limiter = new MemoryRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.consume("ip");
    limiter.consume("ip");
    expect(() => limiter.consume("ip")).toThrow();
  });
});
