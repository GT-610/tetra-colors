import { describe, expect, it } from "vitest";

import { botDelayMs, MAX_BOT_DELAY_MS, MIN_BOT_DELAY_MS } from "../src/room-timing";

describe("room timing", () => {
  it("keeps bot actions inside the inclusive one-to-five-second range", () => {
    expect(botDelayMs(() => 0)).toBe(MIN_BOT_DELAY_MS);
    expect(botDelayMs(() => 0.5)).toBeGreaterThan(MIN_BOT_DELAY_MS);
    expect(botDelayMs(() => 0.999_999)).toBe(MAX_BOT_DELAY_MS);
    expect(botDelayMs(() => 1)).toBe(MAX_BOT_DELAY_MS);
  });
});
