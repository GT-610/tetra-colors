import type {
  Card,
  CardColor,
  ColoredActionCard,
  NumberCard,
  NumberCardValue,
  RandomSource,
  WildCard,
} from "./types";
import { CARD_COLORS } from "./types";

const NUMBER_VALUES: NumberCardValue[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTION_KINDS: ColoredActionCard["kind"][] = ["skip", "reverse", "draw-two"];

export const DECK_SIZE = 108;

export function createDeck(): Card[] {
  const cards: Card[] = [];

  for (const color of CARD_COLORS) {
    for (const number of NUMBER_VALUES) {
      const copies = number === 0 ? 1 : 2;
      for (let copy = 0; copy < copies; copy += 1) {
        const card: NumberCard = {
          id: `number-${color}-${number}-${copy}`,
          kind: "number",
          color,
          number,
        };
        cards.push(card);
      }
    }

    for (const kind of ACTION_KINDS) {
      for (let copy = 0; copy < 2; copy += 1) {
        const card: ColoredActionCard = {
          id: `${kind}-${color}-${copy}`,
          kind,
          color,
        };
        cards.push(card);
      }
    }
  }

  for (let copy = 0; copy < 4; copy += 1) {
    const wild: WildCard = { id: `wild-${copy}`, kind: "wild" };
    const drawFour: WildCard = { id: `wild-draw-four-${copy}`, kind: "wild-draw-four" };
    cards.push(wild, drawFour);
  }

  return cards;
}

export function shuffleCards<T>(cards: readonly T[], random: RandomSource): T[] {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(normalizeRandom(random()) * (index + 1));
    const current = shuffled[index];
    const selected = shuffled[randomIndex];

    if (current === undefined || selected === undefined) {
      throw new Error("Shuffle index was outside the deck");
    }

    shuffled[index] = selected;
    shuffled[randomIndex] = current;
  }

  return shuffled;
}

export function isCardColor(value: unknown): value is CardColor {
  return typeof value === "string" && CARD_COLORS.includes(value as CardColor);
}

function normalizeRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}
