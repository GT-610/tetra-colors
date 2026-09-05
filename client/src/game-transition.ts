import type { Card, TurnDirection } from "../../src/logic";
import type { RoomEvent, RoomSnapshot } from "../../src/protocol";
import {
  buildTransitionTimeline,
  CARD_DEAL_STAGGER_MS,
  INITIAL_DEAL_STAGGER_MS,
  initialDealDurationMs,
  type TransitionTimeline,
} from "../../src/transition-timing";

export interface RoomTransition {
  kind: "events" | "initial-deal";
  previous: RoomSnapshot;
  next: RoomSnapshot;
  events: RoomEvent[];
  timeline: TransitionTimeline;
}

export interface PlayedCardStep {
  type: "play";
  playerId: string;
  card: Card;
  startsAt: number;
}

export interface DealtCardStep {
  type: "deal";
  playerId: string;
  card: Card | null;
  reveal: boolean;
  startsAt: number;
  targetIndex: number | null;
  targetCount: number | null;
}

export interface SkipStatusStep {
  type: "skip" | "unskip";
  playerId: string;
  startsAt: number;
}

export interface DirectionChangeStep {
  direction: TurnDirection;
}

export interface VisualTransitionPlan {
  durationMs: number;
  playedCards: PlayedCardStep[];
  dealtCards: DealtCardStep[];
  skipStatuses: SkipStatusStep[];
  directionChange: DirectionChangeStep | null;
}

export function createRoomTransition(
  previous: RoomSnapshot,
  next: RoomSnapshot,
  events: readonly RoomEvent[],
): RoomTransition | null {
  if (previous.phase !== "playing" && next.phase === "playing" && next.game) {
    const dealtCardCount = next.players.reduce((sum, player) => sum + player.handCount, 0);
    return {
      kind: "initial-deal",
      previous: emptyPlayingSnapshot(next, dealtCardCount),
      next,
      events: [...events],
      timeline: {
        durationMs: initialDealDurationMs(dealtCardCount),
        eventStartsMs: [],
      },
    };
  }

  if (previous.phase !== "playing" || !previous.game || events.every((event) => !isVisual(event))) {
    return null;
  }

  return {
    kind: "events",
    previous,
    next,
    events: [...events],
    timeline: buildTransitionTimeline(events),
  };
}

export function addedHandCards(transition: RoomTransition): Card[] {
  const previousIds = new Set(transition.previous.hand.map((card) => card.id));
  return transition.next.hand.filter((card) => !previousIds.has(card.id));
}

export function buildVisualTransitionPlan(transition: RoomTransition): VisualTransitionPlan {
  if (transition.kind === "initial-deal") {
    return buildInitialDealPlan(transition);
  }

  const addedCards = addedHandCards(transition);
  let addedCardIndex = 0;
  const playedCards: PlayedCardStep[] = [];
  const dealtCards: DealtCardStep[] = [];
  const skipStatuses: SkipStatusStep[] = [];
  let directionChange: DirectionChangeStep | null = null;

  for (const [eventIndex, event] of transition.events.entries()) {
    const startsAt = transition.timeline.eventStartsMs[eventIndex] ?? 0;
    if (event.type === "card-played") {
      playedCards.push({
        type: "play",
        playerId: event.playerId,
        card: event.card,
        startsAt,
      });
      if (event.card.kind === "reverse" && transition.next.game) {
        directionChange = {
          direction: transition.next.game.direction,
        };
      }
    } else if (event.type === "cards-drawn") {
      const reveal = event.playerId === transition.previous.selfId;
      for (let cardIndex = 0; cardIndex < event.count; cardIndex += 1) {
        const card = reveal ? (addedCards[addedCardIndex++] ?? null) : null;
        dealtCards.push({
          type: "deal",
          playerId: event.playerId,
          card,
          reveal: reveal && card !== null,
          startsAt: startsAt + cardIndex * CARD_DEAL_STAGGER_MS,
          targetIndex: card ? transition.next.hand.findIndex((item) => item.id === card.id) : null,
          targetCount: reveal ? transition.next.hand.length : null,
        });
      }
    } else if (event.type === "player-skipped" || event.type === "player-unskipped") {
      skipStatuses.push({
        type: event.type === "player-skipped" ? "skip" : "unskip",
        playerId: event.playerId,
        startsAt,
      });
    }
  }

  return {
    durationMs: transition.timeline.durationMs,
    playedCards,
    dealtCards,
    skipStatuses,
    directionChange,
  };
}

export function projectedHandCount(
  currentCount: number,
  selfId: string,
  plan: VisualTransitionPlan | null,
): number {
  return (
    plan?.dealtCards.find(
      (step) => step.playerId === selfId && step.targetIndex !== null && step.targetCount !== null,
    )?.targetCount ?? currentCount
  );
}

export function latestSkipStatusForPlayer(
  plan: VisualTransitionPlan | null,
  playerId: string,
): SkipStatusStep | undefined {
  if (!plan) return undefined;
  for (let index = plan.skipStatuses.length - 1; index >= 0; index -= 1) {
    const status = plan.skipStatuses[index];
    if (status?.playerId === playerId) return status;
  }
  return undefined;
}

export function isDirectionChangeEvent(event: RoomEvent | null): boolean {
  return event?.type === "card-played" && event.card.kind === "reverse";
}

function buildInitialDealPlan(transition: RoomTransition): VisualTransitionPlan {
  const dealtCards: DealtCardStep[] = [];
  const maxHandCount = Math.max(0, ...transition.next.players.map((player) => player.handCount));
  let sequence = 0;

  for (let handIndex = 0; handIndex < maxHandCount; handIndex += 1) {
    for (const player of transition.next.players) {
      if (handIndex >= player.handCount) continue;
      const reveal = player.id === transition.next.selfId;
      const card = reveal ? (transition.next.hand[handIndex] ?? null) : null;
      dealtCards.push({
        type: "deal",
        playerId: player.id,
        card,
        reveal: card !== null,
        startsAt: sequence * INITIAL_DEAL_STAGGER_MS,
        targetIndex: reveal ? handIndex : null,
        targetCount: reveal ? transition.next.hand.length : null,
      });
      sequence += 1;
    }
  }

  return {
    durationMs: transition.timeline.durationMs,
    playedCards: [],
    dealtCards,
    skipStatuses: [],
    directionChange: null,
  };
}

function emptyPlayingSnapshot(next: RoomSnapshot, dealtCardCount: number): RoomSnapshot {
  if (!next.game) return next;
  return {
    ...next,
    players: next.players.map((player) => ({ ...player, handCount: 0 })),
    hand: [],
    game: {
      ...next.game,
      drawPileCount: next.game.drawPileCount + dealtCardCount,
      playableCardIds: [],
      drawnCardId: null,
    },
  };
}

function isVisual(event: RoomEvent): boolean {
  return (
    event.type === "card-played" ||
    event.type === "cards-drawn" ||
    event.type === "player-skipped" ||
    event.type === "player-unskipped"
  );
}
