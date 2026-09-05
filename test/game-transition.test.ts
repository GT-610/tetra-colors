import { describe, expect, it } from "vitest";

import {
  buildVisualTransitionPlan,
  createRoomTransition,
  isDirectionChangeEvent,
  projectedHandCount,
} from "../client/src/game-transition";
import type { Card } from "../src/logic";
import type { RoomEvent, RoomSnapshot } from "../src/protocol";
import {
  CARD_DEAL_STAGGER_MS,
  CARD_PLAY_ANIMATION_MS,
  INITIAL_DEAL_STAGGER_MS,
  initialDealDurationMs,
} from "../src/transition-timing";

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
    expect(projectedHandCount(1, "self", plan)).toBe(3);
    expect(plan.dealtCards).toEqual([
      {
        type: "deal",
        playerId: "self",
        card: firstDraw,
        reveal: true,
        startsAt: 0,
        targetIndex: 1,
        targetCount: 3,
      },
      {
        type: "deal",
        playerId: "self",
        card: secondDraw,
        reveal: true,
        startsAt: CARD_DEAL_STAGGER_MS,
        targetIndex: 2,
        targetCount: 3,
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
    expect(plan.dealtCards.every((step) => step.targetIndex === null)).toBe(true);
    expect(plan.dealtCards.map((step) => step.startsAt)).toEqual([
      0,
      CARD_DEAL_STAGGER_MS,
      CARD_DEAL_STAGGER_MS * 2,
      CARD_DEAL_STAGGER_MS * 3,
    ]);
    expect(projectedHandCount(1, "self", plan)).toBe(1);
  });

  it("builds a round-robin initial deal from an empty playing table", () => {
    const previous = snapshot([]);
    previous.phase = "lobby";
    previous.game = null;
    previous.players = previous.players.map((player) => ({ ...player, handCount: 0 }));
    const next = snapshot([firstDraw, secondDraw], 2);

    const transition = createRoomTransition(previous, next, []);
    expect(transition?.kind).toBe("initial-deal");
    if (!transition) return;

    expect(transition.previous).toMatchObject({ phase: "playing", hand: [] });
    expect(transition.previous.players.every((player) => player.handCount === 0)).toBe(true);
    expect(transition.previous.game?.drawPileCount).toBe((next.game?.drawPileCount ?? 0) + 4);
    expect(transition.timeline.durationMs).toBe(initialDealDurationMs(4));

    const plan = buildVisualTransitionPlan(transition);
    expect(plan.dealtCards.map((step) => step.playerId)).toEqual([
      "self",
      "other",
      "self",
      "other",
    ]);
    expect(plan.dealtCards.map((step) => step.startsAt)).toEqual([
      0,
      INITIAL_DEAL_STAGGER_MS,
      INITIAL_DEAL_STAGGER_MS * 2,
      INITIAL_DEAL_STAGGER_MS * 3,
    ]);
    expect(
      plan.dealtCards
        .filter((step) => step.playerId === "self")
        .map(({ card, reveal, targetIndex, targetCount }) => ({
          card,
          reveal,
          targetIndex,
          targetCount,
        })),
    ).toEqual([
      { card: firstDraw, reveal: true, targetIndex: 0, targetCount: 2 },
      { card: secondDraw, reveal: true, targetIndex: 1, targetCount: 2 },
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

  it("presents the updated direction while a reverse card is animating", () => {
    const reverseCard: Card = { id: "reverse", kind: "reverse", color: "coral" };
    const previous = snapshot([reverseCard]);
    const next = snapshot([]);
    if (next.game) next.game.direction = -1;

    const transition = createRoomTransition(previous, next, [
      { type: "card-played", playerId: "self", card: reverseCard },
    ]);
    expect(transition).not.toBeNull();
    if (!transition) return;

    expect(buildVisualTransitionPlan(transition).directionChange).toEqual({
      direction: -1,
      startsAt: CARD_PLAY_ANIMATION_MS / 3,
    });
    expect(
      isDirectionChangeEvent({ type: "card-played", playerId: "self", card: reverseCard }),
    ).toBe(true);
    expect(isDirectionChangeEvent({ type: "card-played", playerId: "self", card: oldCard })).toBe(
      false,
    );
  });
});

function snapshot(hand: Card[], otherHandCount = 3): RoomSnapshot {
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
        handCount: otherHandCount,
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
