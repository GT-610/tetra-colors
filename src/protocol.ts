import { isCardColor } from "./logic/deck";
import type { BotDifficulty, Card, CardColor, PendingPenalty, TurnDirection } from "./logic/types";

export const MAX_NICKNAME_LENGTH = 20;
export const MAX_PLAYERS = 6;
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const PLAYER_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export type RoomPhase = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isBot: boolean;
  difficulty: BotDifficulty | null;
  connected: boolean;
  handCount: number;
  finalCalled: boolean;
}

export interface PublicGameView {
  topDiscard: Card;
  currentColor: CardColor;
  currentPlayerId: string;
  direction: TurnDirection;
  drawPileCount: number;
  turnNumber: number;
  turnDeadline: number;
  actionBlockedUntil: number;
  playableCardIds: string[];
  drawnCardId: string | null;
  pendingPenalty: PendingPenalty | null;
  finalCalled: boolean;
  skippedPlayerId: string | null;
  winnerId: string | null;
}

export interface RoomSnapshot {
  roomCode: string;
  phase: RoomPhase;
  selfId: string;
  hostId: string;
  players: PublicPlayer[];
  hand: Card[];
  game: PublicGameView | null;
}

export type ClientMessage =
  | { type: "heartbeat" }
  | { type: "lobby.add-bot"; difficulty: BotDifficulty }
  | { type: "lobby.remove-bot"; playerId: string }
  | { type: "lobby.start" }
  | { type: "game.play-card"; cardId: string; chosenColor?: CardColor }
  | { type: "game.draw-card" }
  | { type: "game.pass-turn" }
  | { type: "game.call-final" }
  | { type: "game.catch-final"; playerId: string }
  | { type: "game.rematch" }
  | { type: "room.leave" };

export type RoomEvent =
  | { type: "player-reconnected"; playerId: string }
  | { type: "player-became-bot"; playerId: string }
  | { type: "card-played"; playerId: string; card: Card }
  | {
      type: "cards-drawn";
      playerId: string;
      count: number;
      cause: "turn" | "penalty" | "final";
    }
  | { type: "final-called"; playerId: string }
  | { type: "final-caught"; catcherId: string; playerId: string; count: number }
  | { type: "player-skipped"; playerId: string }
  | { type: "player-unskipped"; playerId: string }
  | { type: "turn-timed-out"; playerId: string };

export type ServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "event"; event: RoomEvent }
  | { type: "error"; code: ServerErrorCode; message: string };

export type ServerErrorCode =
  | "invalid_message"
  | "invalid_nickname"
  | "room_full"
  | "room_not_found"
  | "not_host"
  | "invalid_phase"
  | "rate_limited"
  | "invalid_action"
  | "session_expired"
  | "internal_error";

export interface RoomSessionResponse {
  roomCode: string;
  playerId: string;
  playerToken: string;
}

export function parseClientMessage(input: unknown): ClientMessage | null {
  if (!isRecord(input) || typeof input.type !== "string") {
    return null;
  }

  switch (input.type) {
    case "heartbeat":
    case "lobby.start":
    case "game.draw-card":
    case "game.pass-turn":
    case "game.call-final":
    case "game.rematch":
    case "room.leave":
      return { type: input.type };
    case "lobby.add-bot":
      return isBotDifficulty(input.difficulty)
        ? { type: "lobby.add-bot", difficulty: input.difficulty }
        : null;
    case "lobby.remove-bot":
      return typeof input.playerId === "string" && input.playerId.length > 0
        ? { type: "lobby.remove-bot", playerId: input.playerId }
        : null;
    case "game.catch-final":
      return typeof input.playerId === "string" && input.playerId.length > 0
        ? { type: "game.catch-final", playerId: input.playerId }
        : null;
    case "game.play-card": {
      if (typeof input.cardId !== "string" || input.cardId.length === 0) {
        return null;
      }
      if (input.chosenColor !== undefined && !isCardColor(input.chosenColor)) {
        return null;
      }
      return input.chosenColor === undefined
        ? { type: "game.play-card", cardId: input.cardId }
        : { type: "game.play-card", cardId: input.cardId, chosenColor: input.chosenColor };
    }
    default:
      return null;
  }
}

export function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0 || normalized.length > MAX_NICKNAME_LENGTH) {
    return null;
  }

  return normalized;
}

export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function isPlayerToken(value: unknown): value is string {
  return typeof value === "string" && PLAYER_TOKEN_PATTERN.test(value);
}

export function isRoomSessionResponse(value: unknown): value is RoomSessionResponse {
  return (
    isRecord(value) &&
    typeof value.roomCode === "string" &&
    normalizeRoomCode(value.roomCode) === value.roomCode &&
    typeof value.playerId === "string" &&
    value.playerId.length > 0 &&
    isPlayerToken(value.playerToken)
  );
}

function isBotDifficulty(value: unknown): value is BotDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
