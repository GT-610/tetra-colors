import { describe, expect, it } from "vitest";

import { normalizeNickname, parseClientMessage } from "../src/protocol";

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
  });

  it("rejects malformed client intents", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage({ type: "lobby.add-bot", difficulty: "impossible" })).toBeNull();
    expect(parseClientMessage({ type: "game.play-card", cardId: "" })).toBeNull();
    expect(
      parseClientMessage({ type: "game.play-card", cardId: "card-1", chosenColor: "purple" }),
    ).toBeNull();
    expect(parseClientMessage({ type: "unknown" })).toBeNull();
  });
});
