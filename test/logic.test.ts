import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Card, GameState, NumberCard, RandomSource } from "../src/logic";
import {
  applyGameAction,
  CARD_COLORS,
  canPlayCard,
  createDeck,
  getPlayableCards,
  shuffleCards,
  startGame,
} from "../src/logic";
import { validateGameState } from "./helpers/game-state";

const EXPECTED_DECK_SIZE = 108;

describe("deck", () => {
  it("builds a complete deck with unique identifiers", () => {
    const deck = createDeck();

    expect(deck).toHaveLength(EXPECTED_DECK_SIZE);
    expect(new Set(deck.map((card) => card.id)).size).toBe(EXPECTED_DECK_SIZE);
    expect(deck.filter((card) => card.kind === "wild")).toHaveLength(4);
    expect(deck.filter((card) => card.kind === "wild-draw-four")).toHaveLength(4);

    for (const color of CARD_COLORS) {
      expect(deck.filter((card) => "color" in card && card.color === color)).toHaveLength(25);
    }
  });

  it("shuffles without mutating or losing cards", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const deck = createDeck();
        const originalIds = deck.map((card) => card.id);
        const shuffled = shuffleCards(deck, seededRandom(seed));

        expect(deck.map((card) => card.id)).toEqual(originalIds);
        expect([...shuffled].map((card) => card.id).sort()).toEqual([...originalIds].sort());
      }),
      { numRuns: 100 },
    );
  });
});

describe("game rules", () => {
  it("deals a deterministic valid opening state", () => {
    const first = startGame(["a", "b", "c"], seededRandom(42));
    const second = startGame(["a", "b", "c"], seededRandom(42));

    expect(first).toEqual(second);
    expect(first.players.map((player) => player.hand.length)).toEqual([7, 7, 7]);
    expect(first.discardPile.at(-1)?.kind).toBe("number");
    expect(validateGameState(first)).toEqual([]);
  });

  it("accepts matching colors, numbers, action kinds, and wild cards", () => {
    const top = numberCard("top", "coral", 4);
    const hand: Card[] = [
      numberCard("color", "coral", 7),
      numberCard("number", "teal", 4),
      { id: "wild", kind: "wild" },
    ];

    expect(canPlayCard(hand[0] as Card, top, "coral", hand)).toBe(true);
    expect(canPlayCard(hand[1] as Card, top, "coral", hand)).toBe(true);
    expect(canPlayCard(hand[2] as Card, top, "coral", hand)).toBe(true);
    expect(canPlayCard(numberCard("miss", "azure", 9), top, "coral", hand)).toBe(false);
    expect(
      canPlayCard(
        { id: "skip", kind: "skip", color: "azure" },
        { id: "top-skip", kind: "skip", color: "amber" },
        "amber",
        hand,
      ),
    ).toBe(true);
  });

  it("enforces the draw-four color restriction", () => {
    const drawFour: Card = { id: "draw-four", kind: "wild-draw-four" };
    const top = numberCard("top", "coral", 4);

    expect(canPlayCard(drawFour, top, "coral", [drawFour, numberCard("same", "coral", 1)])).toBe(
      false,
    );
    expect(canPlayCard(drawFour, top, "coral", [drawFour, numberCard("other", "teal", 1)])).toBe(
      true,
    );
  });

  it("rejects actions from anyone except the current player", () => {
    const state = startGame(["a", "b"], seededRandom(1));

    expect(applyGameAction(state, "b", { type: "draw-card" }, seededRandom(2))).toEqual({
      ok: false,
      error: "not_your_turn",
    });
  });

  it("keeps a playable drawn card available for play or pass", () => {
    const playable = numberCard("playable", "coral", 8);
    const state = testState({
      players: [
        { id: "a", hand: [numberCard("a-card", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      drawPile: [playable],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(state, "a", { type: "draw-card" }, seededRandom(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.turnIndex).toBe(0);
    expect(result.state.drawnCardId).toBe(playable.id);
    expect(getPlayableCards(result.state, "a").map((card) => card.id)).toEqual([playable.id]);

    const passed = applyGameAction(result.state, "a", { type: "pass-turn" }, seededRandom(2));
    expect(passed.ok).toBe(true);
    if (passed.ok) {
      expect(passed.state.turnIndex).toBe(1);
      expect(passed.state.drawnCardId).toBeNull();
    }
  });

  it("automatically ends the turn after drawing an unplayable card", () => {
    const state = testState({
      players: [
        { id: "a", hand: [numberCard("a-card", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      drawPile: [numberCard("miss", "amber", 8)],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(state, "a", { type: "draw-card" }, seededRandom(2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turnIndex).toBe(1);
      expect(result.state.drawnCardId).toBeNull();
    }
  });

  it("applies draw penalties and skips the penalized player", () => {
    const drawTwo: Card = { id: "draw-two", kind: "draw-two", color: "coral" };
    const state = testState({
      players: [
        { id: "a", hand: [drawTwo, numberCard("keep", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
        { id: "c", hand: [numberCard("c-card", "amber", 3)] },
      ],
      drawPile: [numberCard("draw-1", "teal", 5), numberCard("draw-2", "azure", 6)],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(
      state,
      "a",
      { type: "play-card", cardId: drawTwo.id },
      seededRandom(2),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.players[1]?.hand).toHaveLength(3);
      expect(result.state.players[result.state.turnIndex]?.id).toBe("c");
    }
  });

  it("keeps a skipped player marked until the following player acts", () => {
    const skip: Card = { id: "skip", kind: "skip", color: "coral" };
    const followUp = numberCard("follow-up", "coral", 7);
    const state = testState({
      players: [
        { id: "a", hand: [skip, numberCard("keep", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
        { id: "c", hand: [followUp, numberCard("c-card", "amber", 3)] },
      ],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const skipped = applyGameAction(
      state,
      "a",
      { type: "play-card", cardId: skip.id },
      seededRandom(2),
    );
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(skipped.state.skippedPlayerId).toBe("b");
    expect(skipped.state.players[skipped.state.turnIndex]?.id).toBe("c");
    expect(skipped.events.map((event) => event.type)).toEqual([
      "card-played",
      "player-skipped",
      "turn-started",
    ]);

    const cleared = applyGameAction(
      skipped.state,
      "c",
      { type: "play-card", cardId: followUp.id },
      seededRandom(3),
    );
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.state.skippedPlayerId).toBeNull();
      expect(cleared.events.map((event) => event.type)).toEqual([
        "player-unskipped",
        "card-played",
        "turn-started",
      ]);
    }
  });

  it("clears and reapplies skip state during consecutive skip cards", () => {
    const skip: Card = { id: "next-skip", kind: "skip", color: "coral" };
    const state = testState({
      players: [
        { id: "a", hand: [numberCard("a-card", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
        { id: "c", hand: [skip, numberCard("keep", "amber", 3)] },
        { id: "d", hand: [numberCard("d-card", "teal", 4)] },
      ],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
      turnIndex: 2,
      skippedPlayerId: "b",
    });

    const result = applyGameAction(
      state,
      "c",
      { type: "play-card", cardId: skip.id },
      seededRandom(2),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.skippedPlayerId).toBe("d");
      expect(result.state.players[result.state.turnIndex]?.id).toBe("a");
      expect(result.events.map((event) => event.type)).toEqual([
        "player-unskipped",
        "card-played",
        "player-skipped",
        "turn-started",
      ]);
    }
  });

  it("applies a draw penalty before finishing the game", () => {
    const drawTwo: Card = { id: "winning-draw-two", kind: "draw-two", color: "coral" };
    const state = testState({
      players: [
        { id: "a", hand: [drawTwo] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      drawPile: [numberCard("draw-1", "teal", 5), numberCard("draw-2", "azure", 6)],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(
      state,
      "a",
      { type: "play-card", cardId: drawTwo.id },
      seededRandom(2),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe("finished");
      expect(result.state.winnerId).toBe("a");
      expect(result.state.players[1]?.hand).toHaveLength(3);
      expect(result.events.map((event) => event.type)).toEqual(["card-played", "cards-drawn"]);
    }
  });

  it("rejects a color choice for a non-wild card", () => {
    const playable = numberCard("playable", "coral", 8);
    const state = testState({
      players: [
        { id: "a", hand: [playable, numberCard("keep", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    expect(
      applyGameAction(
        state,
        "a",
        { type: "play-card", cardId: playable.id, chosenColor: "teal" },
        seededRandom(2),
      ),
    ).toEqual({ ok: false, error: "color_not_allowed" });
  });

  it("makes reverse act as a skip with two players", () => {
    const reverse: Card = { id: "reverse", kind: "reverse", color: "coral" };
    const state = testState({
      players: [
        { id: "a", hand: [reverse, numberCard("keep", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(
      state,
      "a",
      { type: "play-card", cardId: reverse.id },
      seededRandom(2),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turnIndex).toBe(0);
      expect(result.state.direction).toBe(-1);
    }
  });

  it("recycles all but the top discard when the draw pile is empty", () => {
    const state = testState({
      players: [
        { id: "a", hand: [numberCard("a-card", "teal", 1)] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      drawPile: [],
      discardPile: [
        numberCard("recycle-1", "amber", 5),
        numberCard("recycle-2", "azure", 8),
        numberCard("top", "coral", 3),
      ],
      currentColor: "coral",
    });

    const result = applyGameAction(state, "a", { type: "draw-card" }, seededRandom(2));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.discardPile.map((card) => card.id)).toEqual(["top"]);
      expect(result.state.players[0]?.hand).toHaveLength(2);
    }
  });

  it("finishes only when a player empties their hand", () => {
    const winning = numberCard("winning", "coral", 8);
    const state = testState({
      players: [
        { id: "a", hand: [winning] },
        { id: "b", hand: [numberCard("b-card", "azure", 2)] },
      ],
      discardPile: [numberCard("top", "coral", 3)],
      currentColor: "coral",
    });

    const result = applyGameAction(
      state,
      "a",
      { type: "play-card", cardId: winning.id },
      seededRandom(2),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe("finished");
      expect(result.state.winnerId).toBe("a");
      expect(result.state.players[0]?.hand).toEqual([]);
    }
  });
});

function testState(overrides: Partial<GameState>): GameState {
  return {
    phase: "playing",
    players: [
      { id: "a", hand: [] },
      { id: "b", hand: [] },
    ],
    drawPile: [],
    discardPile: [numberCard("top", "coral", 0)],
    currentColor: "coral",
    turnIndex: 0,
    direction: 1,
    drawnCardId: null,
    skippedPlayerId: null,
    winnerId: null,
    turnNumber: 1,
    config: {
      initialHandSize: 7,
      maxPlayers: 6,
      enforceWildDrawFour: true,
    },
    ...overrides,
  };
}

function numberCard(
  id: string,
  color: NumberCard["color"],
  number: NumberCard["number"],
): NumberCard {
  return { id, kind: "number", color, number };
}

function seededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}
