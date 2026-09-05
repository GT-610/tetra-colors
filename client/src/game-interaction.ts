import type { Card, TurnDirection } from "../../src/logic";

export function requiresColorChoice(card: Card): boolean {
  return card.kind === "wild" || card.kind === "wild-draw-four";
}

export function oppositeDirection(direction: TurnDirection): TurnDirection {
  return direction === 1 ? -1 : 1;
}
