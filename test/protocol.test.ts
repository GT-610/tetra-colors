import { describe, expect, it } from "vitest";

import {
  isPlayerToken,
  isRoomSessionResponse,
  normalizeNickname,
  normalizeRoomCode,
  parseClientMessage,
} from "../src/protocol";

describe("protocol validation", () => {
  it("normalizes safe display nicknames", () => {
    expect(normalizeNickname("  青色   玩家  ")).toBe("青色 玩家");
    expect(normalizeNickname(" ")).toBeNull();
    expect(normalizeNickname("a".repeat(21))).toBeNull();
    expect(normalizeNickname({})).toBeNull();
  });

  it("accepts valid client intents", () => {
    expect(parseClientMessage({ type: "heartbeat" })).toEqual({ type: "heartbeat" });
    expect(parseClientMessage({ type: "lobby.add-bot", difficulty: "hard" })).toEqual({
      type: "lobby.add-bot",
      difficulty: "hard",
    });
    expect(
      parseClientMessage({ type: "game.play-card", cardId: "card-1", chosenColor: "teal" }),
    ).toEqual({ type: "game.play-card", cardId: "card-1", chosenColor: "teal" });
    expect(parseClientMessage({ type: "lobby.remove-bot", playerId: "bot-1" })).toEqual({
      type: "lobby.remove-bot",
      playerId: "bot-1",
    });
    expect(parseClientMessage({ type: "lobby.start" })).toEqual({ type: "lobby.start" });
    expect(parseClientMessage({ type: "game.draw-card" })).toEqual({ type: "game.draw-card" });
    expect(parseClientMessage({ type: "game.pass-turn" })).toEqual({ type: "game.pass-turn" });
    expect(parseClientMessage({ type: "game.call-final" })).toEqual({ type: "game.call-final" });
    expect(parseClientMessage({ type: "game.catch-final", playerId: "player-2" })).toEqual({
      type: "game.catch-final",
      playerId: "player-2",
    });
    expect(parseClientMessage({ type: "game.rematch" })).toEqual({ type: "game.rematch" });
    expect(parseClientMessage({ type: "room.leave" })).toEqual({ type: "room.leave" });
  });

  it("rejects malformed client intents", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ type: "lobby.add-bot", difficulty: "impossible" })).toBeNull();
    expect(parseClientMessage({ type: "lobby.remove-bot", playerId: "" })).toBeNull();
    expect(parseClientMessage({ type: "game.play-card", cardId: "" })).toBeNull();
    expect(parseClientMessage({ type: "game.catch-final", playerId: "" })).toBeNull();
    expect(
      parseClientMessage({ type: "game.play-card", cardId: "card-1", chosenColor: "purple" }),
    ).toBeNull();
    expect(parseClientMessage({ type: "unknown" })).toBeNull();
  });

  it("normalizes room codes and validates player tokens", () => {
    expect(normalizeRoomCode(" abcd2 ")).toBe("ABCD2");
    expect(normalizeRoomCode("ABCDI")).toBeNull();
    expect(normalizeRoomCode(null)).toBeNull();
    expect(isPlayerToken("a".repeat(64))).toBe(true);
    expect(isPlayerToken("A".repeat(64))).toBe(false);
    expect(isPlayerToken("a".repeat(63))).toBe(false);
  });

  it("validates persisted room sessions", () => {
    const valid = {
      roomCode: "ABCD2",
      playerId: "player-1",
      playerToken: "a".repeat(64),
    };

    expect(isRoomSessionResponse(valid)).toBe(true);
    expect(isRoomSessionResponse({ ...valid, roomCode: "abcd2" })).toBe(false);
    expect(isRoomSessionResponse({ ...valid, playerId: "" })).toBe(false);
    expect(isRoomSessionResponse({ ...valid, playerToken: "invalid" })).toBe(false);
    expect(isRoomSessionResponse(null)).toBe(false);
  });
});
