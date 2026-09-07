export const CARD_COLORS = ["coral", "amber", "teal", "azure"] as const;

export type CardColor = (typeof CARD_COLORS)[number];
export type BotDifficulty = "easy" | "medium" | "hard";
export type TurnDirection = 1 | -1;

export type NumberCardValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface NumberCard {
  id: string;
  kind: "number";
  color: CardColor;
  number: NumberCardValue;
}

export interface ColoredActionCard {
  id: string;
  kind: "skip" | "reverse" | "draw-two";
  color: CardColor;
}

export interface WildCard {
  id: string;
  kind: "wild" | "wild-draw-four";
}

export type Card = NumberCard | ColoredActionCard | WildCard;

export interface GamePlayer {
  id: string;
  hand: Card[];
}

export interface GameConfig {
  initialHandSize: number;
  maxPlayers: number;
  enforceWildDrawFour: boolean;
}

export interface PendingPenalty {
  total: number;
  minimum: 2 | 4;
}

export interface GameState {
  phase: "playing" | "finished";
  players: GamePlayer[];
  drawPile: Card[];
  discardPile: Card[];
  currentColor: CardColor;
  turnIndex: number;
  direction: TurnDirection;
  drawnCardId: string | null;
  pendingPenalty: PendingPenalty | null;
  skippedPlayerId: string | null;
  winnerId: string | null;
  turnNumber: number;
  config: GameConfig;
}

export type GameAction =
  | { type: "play-card"; cardId: string; chosenColor?: CardColor }
  | { type: "draw-card" }
  | { type: "pass-turn" };

export type GameErrorCode =
  | "game_finished"
  | "not_your_turn"
  | "card_not_found"
  | "card_not_playable"
  | "color_required"
  | "color_not_allowed"
  | "already_drew"
  | "must_play_drawn_card"
  | "draw_required"
  | "penalty_draw_required";

export type GameEvent =
  | { type: "card-played"; playerId: string; card: Card }
  | {
      type: "cards-drawn";
      playerId: string;
      count: number;
      cause: "turn" | "penalty";
    }
  | { type: "player-skipped"; playerId: string }
  | { type: "player-unskipped"; playerId: string }
  | { type: "turn-started" };

export type GameResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: GameErrorCode };

export type RandomSource = () => number;
