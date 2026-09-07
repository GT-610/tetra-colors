import type { Card, TurnDirection } from "../../src/logic";
import type { PublicPlayer, RoomEvent } from "../../src/protocol";

export function requiresColorChoice(card: Card): boolean {
  return card.kind === "wild" || card.kind === "wild-draw-four";
}

export function canAttemptFinalCatch(
  player: Pick<PublicPlayer, "handCount" | "finalCalled">,
): boolean {
  return player.handCount === 1 && !player.finalCalled;
}

export function oppositeDirection(direction: TurnDirection): TurnDirection {
  return direction === 1 ? -1 : 1;
}

export function directionNoticeKey(event: RoomEvent | null): string {
  return event?.type === "card-played" && event.card.kind === "reverse"
    ? `reverse:${event.card.id}`
    : "direction:steady";
}
