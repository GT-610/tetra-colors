import { describe, expect, it } from "vitest";

import { oppositeDirection, requiresColorChoice } from "../client/src/game-interaction";
import type { Card } from "../src/logic";

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
});
