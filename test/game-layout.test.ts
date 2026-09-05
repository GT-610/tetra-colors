import { describe, expect, it } from "vitest";

import { arrangeOpponentSeats, calculateHandLayout } from "../client/src/game-layout";
import type { PublicPlayer } from "../src/protocol";

describe("game table seating", () => {
  it("keeps turn order around the current player's perspective", () => {
    const players = ["one", "two", "self", "three", "four", "five"].map(player);

    const seats = arrangeOpponentSeats(players, "self");

    expect(seats.map((seat) => seat.player.id)).toEqual(["three", "four", "five", "one", "two"]);
  });

  it("distributes every supported opponent count symmetrically inside the upper arc", () => {
    for (let count = 1; count <= 5; count += 1) {
      const players = [
        player("self"),
        ...Array.from({ length: count }, (_, index) => player(`p${index}`)),
      ];
      const seats = arrangeOpponentSeats(players, "self");

      expect(seats).toHaveLength(count);
      expect(seats.every((seat) => seat.left > 0 && seat.left < 100)).toBe(true);
      expect(seats.every((seat) => seat.top > 0 && seat.top < 58)).toBe(true);
      expect(seats.map((seat) => seat.left)).toEqual(
        [...seats.map((seat) => seat.left)].sort((a, b) => a - b),
      );

      for (let index = 0; index < seats.length; index += 1) {
        const opposite = seats.at(-(index + 1));
        expect(opposite).toBeDefined();
        expect((seats[index]?.left ?? 0) + (opposite?.left ?? 0)).toBeCloseTo(100);
        expect(seats[index]?.top).toBeCloseTo(opposite?.top ?? 0);
      }

      if (count === 5) {
        expect(seats[2]?.top).toBeLessThan(seats[1]?.top ?? 0);
        expect(seats[1]?.top).toBeLessThan(seats[0]?.top ?? 0);
      }
    }
  });
});

describe("hand layout", () => {
  it("keeps natural spacing when the full hand fits", () => {
    expect(calculateHandLayout(800, 92, 7)).toEqual({
      cardWidth: 92,
      step: 99,
      contentWidth: 686,
      overflowing: false,
    });
  });

  it("overlaps cards just enough to fit a narrow viewport", () => {
    const layout = calculateHandLayout(360, 76, 7);
    expect(layout.step).toBeCloseTo((360 - 76) / 6);
    expect(layout.contentWidth).toBeCloseTo(360);
    expect(layout.overflowing).toBe(false);
  });

  it("preserves a usable exposed edge and overflows when the hand is very large", () => {
    const layout = calculateHandLayout(360, 76, 15);
    expect(layout.step).toBeCloseTo(76 * 0.36);
    expect(layout.contentWidth).toBeGreaterThan(360);
    expect(layout.overflowing).toBe(true);
  });
});

function player(id: string): PublicPlayer {
  return {
    id,
    nickname: id,
    isBot: id !== "self",
    difficulty: id === "self" ? null : "medium",
    connected: true,
    handCount: 7,
  };
}
