import { createDeck, type GameState } from "../../src/logic";

const expectedCardIds = new Set(createDeck().map((card) => card.id));

export function validateGameState(state: GameState): string[] {
  const issues: string[] = [];
  const allCards = [
    ...state.drawPile,
    ...state.discardPile,
    ...state.players.flatMap((player) => player.hand),
  ];
  const ids = new Set(allCards.map((card) => card.id));

  if (allCards.length !== expectedCardIds.size) {
    issues.push(`expected ${expectedCardIds.size} cards, found ${allCards.length}`);
  }
  if (ids.size !== allCards.length) {
    issues.push("card identifiers are not unique");
  }
  if ([...ids].some((id) => !expectedCardIds.has(id))) {
    issues.push("game contains an unknown card identifier");
  }
  if (state.discardPile.length === 0) {
    issues.push("discard pile is empty");
  }
  if (!state.players[state.turnIndex]) {
    issues.push("turn index is outside the player list");
  }
  if (state.phase === "finished") {
    const winner = state.players.find((player) => player.id === state.winnerId);
    if (winner?.hand.length !== 0) {
      issues.push("finished game has no empty-handed winner");
    }
  }
  if (state.drawnCardId) {
    const currentPlayer = state.players[state.turnIndex];
    if (!currentPlayer?.hand.some((card) => card.id === state.drawnCardId)) {
      issues.push("drawn card is not held by the current player");
    }
  }
  if (
    state.pendingPenalty &&
    (state.pendingPenalty.total < state.pendingPenalty.minimum ||
      state.pendingPenalty.total % 2 !== 0)
  ) {
    issues.push("pending penalty total is invalid");
  }
  if (new Set(state.finalCalledPlayerIds).size !== state.finalCalledPlayerIds.length) {
    issues.push("final calls contain duplicate players");
  }
  for (const playerId of state.finalCalledPlayerIds) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (player?.hand.length !== 1) {
      issues.push("final call belongs to a player without one card");
    }
  }
  if (
    state.skippedPlayerId &&
    !state.players.some((player) => player.id === state.skippedPlayerId)
  ) {
    issues.push("skipped player is not part of the game");
  }

  return issues;
}
