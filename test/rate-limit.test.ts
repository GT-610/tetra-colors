import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "../src/rate-limit";

describe("fixed window rate limiter", () => {
  it("enforces a limit and resets after the window", () => {
    const limiter = new FixedWindowRateLimiter(1_000, 10);

    expect(limiter.consume("player", 2, 0)).toBe(true);
    expect(limiter.consume("player", 2, 100)).toBe(true);
    expect(limiter.consume("player", 2, 200)).toBe(false);
    expect(limiter.consume("player", 2, 1_000)).toBe(true);
  });

  it("evicts the oldest bucket when capacity is reached", () => {
    const limiter = new FixedWindowRateLimiter(10_000, 2);

    expect(limiter.consume("oldest", 1, 0)).toBe(true);
    expect(limiter.consume("oldest", 1, 1)).toBe(false);
    expect(limiter.consume("second", 1, 2)).toBe(true);
    expect(limiter.consume("third", 1, 3)).toBe(true);
    expect(limiter.consume("oldest", 1, 4)).toBe(true);
  });
});
