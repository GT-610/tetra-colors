import { describe, expect, it } from "vitest";

import {
  directionNoticeKey,
  oppositeDirection,
  requiresColorChoice,
} from "../client/src/game-interaction";
import type { Card } from "../src/logic";
import type { RoomEvent } from "../src/protocol";

describe("game table interactions", () => {
  it("requests an inline color choice only for color-changing cards", () => {
    const cards: Card[] = [
      { id: "wild", kind: "wild" },
      { id: "draw-four", kind: "wild-draw-four" },
      { id: "number", kind: "number", color: "coral", number: 4 },
      { id: "reverse", kind: "reverse", color: "azure" },
    ];

    expect(cards.map(requiresColorChoice)).toEqual([true, true, false, false]);
  });

  it("predicts the direction shown before the committed snapshot arrives", () => {
    expect(oppositeDirection(1)).toBe(-1);
    expect(oppositeDirection(-1)).toBe(1);
  });

  it("gives consecutive reverse events distinct animation keys", () => {
    const first: RoomEvent = {
      type: "card-played",
      playerId: "self",
      card: { id: "reverse-one", kind: "reverse", color: "coral" },
    };
    const second: RoomEvent = {
      type: "card-played",
      playerId: "self",
      card: { id: "reverse-two", kind: "reverse", color: "coral" },
    };

    expect(directionNoticeKey(first)).not.toBe(directionNoticeKey(second));
    expect(directionNoticeKey(null)).toBe("direction:steady");
  });
});
