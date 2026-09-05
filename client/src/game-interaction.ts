import type { Card, TurnDirection } from "../../src/logic";
import type { RoomEvent } from "../../src/protocol";

export function requiresColorChoice(card: Card): boolean {
  return card.kind === "wild" || card.kind === "wild-draw-four";
}

export function oppositeDirection(direction: TurnDirection): TurnDirection {
  return direction === 1 ? -1 : 1;
}

export function directionNoticeKey(event: RoomEvent | null): string {
  return event?.type === "card-played" && event.card.kind === "reverse"
    ? `reverse:${event.card.id}`
    : "direction:steady";
}
