import { getPlayableCards } from "./game";
import type { BotDifficulty, Card, CardColor, GameAction, GameState, RandomSource } from "./types";
import { CARD_COLORS } from "./types";

export const BOT_FINAL_FORGET_RATE = 0.1;

export function shouldBotCallFinal(random: RandomSource): boolean {
  const value = random();
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  return normalized >= BOT_FINAL_FORGET_RATE;
}

export function chooseBotAction(
  state: GameState,
  playerId: string,
  difficulty: BotDifficulty,
  random: RandomSource,
): GameAction {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Bot player does not exist");
  }

  const playable = getPlayableCards(state, playerId);
  if (playable.length === 0) {
    return state.drawnCardId ? { type: "pass-turn" } : { type: "draw-card" };
  }

  const card = selectCard(playable, state, difficulty, random);
  const action: GameAction = { type: "play-card", cardId: card.id };

  if (card.kind === "wild" || card.kind === "wild-draw-four") {
    action.chosenColor = chooseColor(player.hand, card.id);
  }

  return action;
}

function selectCard(
  playable: readonly Card[],
  state: GameState,
  difficulty: BotDifficulty,
  random: RandomSource,
): Card {
  if (difficulty === "easy") {
    return randomItem(playable, random);
  }

  const nextIndex =
    (state.turnIndex + state.direction + state.players.length) % state.players.length;
  const nextPlayer = state.players[nextIndex];
  const nextHandCount = nextPlayer?.hand.length ?? 7;

  const ranked = [...playable].sort((left, right) => {
    const scoreDifference =
      scoreCard(right, difficulty, nextHandCount) - scoreCard(left, difficulty, nextHandCount);
    return scoreDifference === 0 ? left.id.localeCompare(right.id) : scoreDifference;
  });

  const bestScore = scoreCard(ranked[0] as Card, difficulty, nextHandCount);
  const bestCards = ranked.filter(
    (card) => scoreCard(card, difficulty, nextHandCount) === bestScore,
  );
  return randomItem(bestCards, random);
}

function scoreCard(card: Card, difficulty: BotDifficulty, nextHandCount: number): number {
  if (difficulty === "medium") {
    if (card.kind === "wild-draw-four") return 7;
    if (card.kind === "draw-two") return 6;
    if (card.kind === "skip" || card.kind === "reverse") return 5;
    if (card.kind === "wild") return 4;
    return card.kind === "number" ? card.number : 0;
  }

  const threatBonus = nextHandCount <= 2 ? 10 : 0;
  if (card.kind === "wild-draw-four") return 22 + threatBonus;
  if (card.kind === "draw-two") return 18 + threatBonus;
  if (card.kind === "skip") return 16 + threatBonus;
  if (card.kind === "reverse") return 14 + threatBonus;
  if (card.kind === "wild") return nextHandCount <= 2 ? 13 : 2;
  return card.kind === "number" ? card.number : 0;
}

function chooseColor(hand: readonly Card[], excludedCardId: string): CardColor {
  const counts = new Map<CardColor, number>(CARD_COLORS.map((color) => [color, 0]));

  for (const card of hand) {
    if (card.id !== excludedCardId && "color" in card) {
      counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
    }
  }

  return [...CARD_COLORS].sort((left, right) => {
    const difference = (counts.get(right) ?? 0) - (counts.get(left) ?? 0);
    return difference === 0 ? CARD_COLORS.indexOf(left) - CARD_COLORS.indexOf(right) : difference;
  })[0] as CardColor;
}

function randomItem<T>(items: readonly T[], random: RandomSource): T {
  const value = random();
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
  const item = items[Math.floor(normalized * items.length)];
  if (item === undefined) {
    throw new Error("Cannot choose from an empty list");
  }
  return item;
}
