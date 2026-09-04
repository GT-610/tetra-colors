import type { Card } from "../../src/logic";
import type { RoomEvent, RoomSnapshot } from "../../src/protocol";
import {
  buildTransitionTimeline,
  CARD_DEAL_STAGGER_MS,
  type TransitionTimeline,
} from "../../src/transition-timing";

export interface RoomTransition {
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
}

export interface SkipStatusStep {
  type: "skip" | "unskip";
  playerId: string;
  startsAt: number;
}

export interface VisualTransitionPlan {
  durationMs: number;
  playedCards: PlayedCardStep[];
  dealtCards: DealtCardStep[];
  skipStatuses: SkipStatusStep[];
}

export function createRoomTransition(
  previous: RoomSnapshot,
  next: RoomSnapshot,
  events: readonly RoomEvent[],
): RoomTransition | null {
  if (previous.phase !== "playing" || !previous.game || events.every((event) => !isVisual(event))) {
    return null;
  }

  return {
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
  const addedCards = addedHandCards(transition);
  let addedCardIndex = 0;
  const playedCards: PlayedCardStep[] = [];
  const dealtCards: DealtCardStep[] = [];
  const skipStatuses: SkipStatusStep[] = [];

  for (const [eventIndex, event] of transition.events.entries()) {
    const startsAt = transition.timeline.eventStartsMs[eventIndex] ?? 0;
    if (event.type === "card-played") {
      playedCards.push({
        type: "play",
        playerId: event.playerId,
        card: event.card,
        startsAt,
      });
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
