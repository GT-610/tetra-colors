import { describe, expect, it } from "vitest";

import {
  buildTransitionTimeline,
  CARD_DEAL_ANIMATION_MS,
  CARD_DEAL_STAGGER_MS,
  CARD_PLAY_ANIMATION_MS,
  CARD_REVEAL_ANIMATION_MS,
  initialDealDurationMs,
  SKIP_STATUS_ANIMATION_MS,
} from "../src/transition-timing";

describe("game transition timing", () => {
  it("bounds the opening deal window at zero and pins a representative size", () => {
    expect(initialDealDurationMs(0)).toBe(0);
    // 2 players x 7 cards: 560 + 120 * 13 + 320.
    expect(initialDealDurationMs(14)).toBe(2_440);
  });

  it("deals multiple cards half a flight apart after a played card", () => {
    const timeline = buildTransitionTimeline([
      { type: "card-played" },
      { type: "cards-drawn", count: 4 },
      { type: "turn-started" },
    ]);

    expect(timeline.eventStartsMs).toEqual([0, CARD_PLAY_ANIMATION_MS, 0]);
    expect(timeline.durationMs).toBe(
      CARD_PLAY_ANIMATION_MS +
        CARD_DEAL_ANIMATION_MS +
        CARD_DEAL_STAGGER_MS * 3 +
        CARD_REVEAL_ANIMATION_MS,
    );
  });

  it("animates consecutive skip removal and application together", () => {
    const timeline = buildTransitionTimeline([
      { type: "player-unskipped" },
      { type: "card-played" },
      { type: "player-skipped" },
      { type: "turn-started" },
    ]);

    expect(timeline.eventStartsMs.slice(0, 3)).toEqual([
      CARD_PLAY_ANIMATION_MS,
      0,
      CARD_PLAY_ANIMATION_MS,
    ]);
    expect(timeline.durationMs).toBe(CARD_PLAY_ANIMATION_MS + SKIP_STATUS_ANIMATION_MS);
  });
});
