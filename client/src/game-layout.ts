import type { PublicPlayer } from "../../src/protocol";

export interface OpponentSeat {
  player: PublicPlayer;
  left: number;
  top: number;
}

export interface HandLayout {
  cardWidth: number;
  step: number;
  contentWidth: number;
  overflowing: boolean;
}

const ARC_TOP = 8;
const ARC_DEPTH = 41;
const ARC_RADIUS_X = 47;
const HAND_NATURAL_GAP = 7;
const HAND_MIN_VISIBLE_RATIO = 0.36;
export const CARD_ASPECT_RATIO = 0.68;
export const HAND_CARD_TOP_OFFSET = 15;
export const HAND_TRACK_VERTICAL_PADDING = HAND_CARD_TOP_OFFSET * 2;

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

export function calculateHandLayout(
  viewportWidth: number,
  cardWidth: number,
  cardCount: number,
): HandLayout {
  const safeViewportWidth = Math.max(0, viewportWidth);
  const safeCardWidth = Math.max(1, cardWidth);
  const safeCardCount = Math.max(0, Math.floor(cardCount));
  if (safeCardCount === 0) {
    return { cardWidth: safeCardWidth, step: 0, contentWidth: 0, overflowing: false };
  }
  if (safeCardCount === 1) {
    return {
      cardWidth: safeCardWidth,
      step: 0,
      contentWidth: safeCardWidth,
      overflowing: safeCardWidth > safeViewportWidth,
    };
  }

  const naturalStep = safeCardWidth + HAND_NATURAL_GAP;
  const minimumStep = safeCardWidth * HAND_MIN_VISIBLE_RATIO;
  const fittedStep = (safeViewportWidth - safeCardWidth) / (safeCardCount - 1);
  const step = Math.min(naturalStep, Math.max(minimumStep, fittedStep));
  const contentWidth = safeCardWidth + step * (safeCardCount - 1);
  return {
    cardWidth: safeCardWidth,
    step,
    contentWidth,
    overflowing: contentWidth > safeViewportWidth + 0.5,
  };
}
