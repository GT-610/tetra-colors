import type { PublicPlayer } from "../../src/protocol";

export interface OpponentSeat {
  player: PublicPlayer;
  left: number;
  top: number;
}

const ARC_TOP = 8;
const ARC_DEPTH = 41;
const ARC_RADIUS_X = 47;

export function arrangeOpponentSeats(
  players: readonly PublicPlayer[],
  selfId: string,
): OpponentSeat[] {
  const selfIndex = players.findIndex((player) => player.id === selfId);
  const orderedPlayers =
    selfIndex === -1 ? players : [...players.slice(selfIndex + 1), ...players.slice(0, selfIndex)];

  return orderedPlayers.map((player, index) => {
    const angle = Math.PI - ((index + 1) * Math.PI) / (orderedPlayers.length + 1);
    const horizontalPosition = Math.cos(angle);
    return {
      player,
      left: 50 + ARC_RADIUS_X * horizontalPosition,
      top: ARC_TOP + ARC_DEPTH * Math.abs(horizontalPosition) ** 1.35,
    };
  });
}
