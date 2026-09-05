import type { RoomSnapshot } from "../../src/protocol";

export type LeaveConfirmation = "last-human" | "active-game" | null;

export function canAttemptJoin(normalizedRoomCode: string | null, busy: boolean): boolean {
  return normalizedRoomCode !== null && !busy;
}

export function leaveConfirmation(snapshot: RoomSnapshot): LeaveConfirmation {
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const humanCount = snapshot.players.filter((player) => !player.isBot).length;

  if (self && !self.isBot && humanCount === 1) {
    return "last-human";
  }
  return snapshot.phase === "playing" ? "active-game" : null;
}
