import { describe, expect, it } from "vitest";

import { buildVisualTransitionPlan, createRoomTransition } from "../client/src/game-transition";
import type { Card } from "../src/logic";
import type { RoomEvent, RoomSnapshot } from "../src/protocol";
import { CARD_DEAL_STAGGER_MS } from "../src/transition-timing";

const oldCard = card("old", 1);
const firstDraw = card("first-draw", 2);
const secondDraw = card("second-draw", 3);

describe("client game transitions", () => {
  it("reveals newly dealt self cards independently half a flight apart", () => {
    const transition = createRoomTransition(
      snapshot([oldCard]),
      snapshot([oldCard, firstDraw, secondDraw]),
      [{ type: "cards-drawn", playerId: "self", count: 2 }],
    );
    expect(transition).not.toBeNull();
    if (!transition) return;

    const plan = buildVisualTransitionPlan(transition);
    expect(plan.dealtCards).toEqual([
      {
        type: "deal",
        playerId: "self",
        card: firstDraw,
        reveal: true,
        startsAt: 0,
      },
      {
        type: "deal",
        playerId: "self",
        card: secondDraw,
        reveal: true,
        startsAt: CARD_DEAL_STAGGER_MS,
      },
    ]);
  });

  it("keeps opponent draws face-down and sequences every card", () => {
    const transition = createRoomTransition(snapshot([oldCard]), snapshot([oldCard]), [
      { type: "cards-drawn", playerId: "other", count: 4 },
    ]);
    expect(transition).not.toBeNull();
    if (!transition) return;

    const plan = buildVisualTransitionPlan(transition);
    expect(plan.dealtCards).toHaveLength(4);
    expect(plan.dealtCards.every((step) => step.card === null && !step.reveal)).toBe(true);
    expect(plan.dealtCards.map((step) => step.startsAt)).toEqual([
      0,
      CARD_DEAL_STAGGER_MS,
      CARD_DEAL_STAGGER_MS * 2,
      CARD_DEAL_STAGGER_MS * 3,
    ]);
  });

  it("preserves the complete played-card and skip event sequence", () => {
    const events: RoomEvent[] = [
      { type: "player-unskipped", playerId: "other" },
      { type: "card-played", playerId: "self", card: oldCard },
      { type: "player-skipped", playerId: "next" },
    ];
    const transition = createRoomTransition(snapshot([oldCard]), snapshot([]), events);
    expect(transition).not.toBeNull();
    if (!transition) return;

    const plan = buildVisualTransitionPlan(transition);
    expect(plan.playedCards).toHaveLength(1);
    expect(plan.skipStatuses.map(({ type, playerId }) => ({ type, playerId }))).toEqual([
      { type: "unskip", playerId: "other" },
      { type: "skip", playerId: "next" },
    ]);
  });
});

function snapshot(hand: Card[]): RoomSnapshot {
  return {
    roomCode: "ABCD2",
    phase: "playing",
    selfId: "self",
    hostId: "self",
    players: [
      {
        id: "self",
        nickname: "自己",
        isBot: false,
        difficulty: null,
        connected: true,
        handCount: hand.length,
      },
      {
        id: "other",
        nickname: "对手",
        isBot: false,
        difficulty: null,
        connected: true,
        handCount: 3,
      },
    ],
    hand,
    game: {
      topDiscard: card("top", 0),
      currentColor: "coral",
      currentPlayerId: "self",
      direction: 1,
      drawPileCount: 80,
      turnNumber: 1,
      turnDeadline: Date.now() + 30_000,
      actionBlockedUntil: 0,
      playableCardIds: [],
      drawnCardId: null,
      skippedPlayerId: null,
      winnerId: null,
    },
  };
}

function card(id: string, number: 0 | 1 | 2 | 3): Card {
  return { id, kind: "number", color: "coral", number };
}
