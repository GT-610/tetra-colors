import { describe, expect, it } from "vitest";

import { canAttemptJoin, leaveConfirmation } from "../client/src/entry-state";
import type { PublicPlayer, RoomSnapshot } from "../src/protocol";

describe("entry and leave decisions", () => {
  it("allows a room lookup once the room code is valid", () => {
    expect(canAttemptJoin("JASU9", false)).toBe(true);
    expect(canAttemptJoin(null, false)).toBe(false);
    expect(canAttemptJoin("JASU9", true)).toBe(false);
  });

  it("confirms when the last human leaves any room phase", () => {
    for (const phase of ["lobby", "playing", "finished"] as const) {
      expect(
        leaveConfirmation(snapshot(phase, [human("self"), bot("bot-one"), bot("bot-two")])),
      ).toBe("last-human");
    }
  });

  it("only confirms non-last humans during an active game", () => {
    const players = [human("self"), human("guest"), bot("bot")];
    expect(leaveConfirmation(snapshot("lobby", players))).toBeNull();
    expect(leaveConfirmation(snapshot("playing", players))).toBe("active-game");
    expect(leaveConfirmation(snapshot("finished", players))).toBeNull();
  });
});

function snapshot(phase: RoomSnapshot["phase"], players: PublicPlayer[]): RoomSnapshot {
  return {
    roomCode: "JASU9",
    phase,
    selfId: "self",
    hostId: "self",
    players,
    hand: [],
    game: null,
  };
}

function human(id: string): PublicPlayer {
  return {
    id,
    nickname: id,
    isBot: false,
    difficulty: null,
    connected: true,
    handCount: 0,
  };
}

function bot(id: string): PublicPlayer {
  return {
    id,
    nickname: id,
    isBot: true,
    difficulty: "medium",
    connected: true,
    handCount: 0,
  };
}
