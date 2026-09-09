import { createDeck, isCardColor, shuffleCards } from "./deck";
import type {
  Card,
  CardColor,
  GameAction,
  GameConfig,
  GameEvent,
  GamePlayer,
  GameResult,
  GameState,
  RandomSource,
  TurnDirection,
} from "./types";

const DEFAULT_GAME_CONFIG: GameConfig = {
  initialHandSize: 7,
  maxPlayers: 6,
  enforceWildDrawFour: true,
};

export function startGame(
  playerIds: readonly string[],
  random: RandomSource,
  config: GameConfig = DEFAULT_GAME_CONFIG,
): GameState {
  validatePlayers(playerIds, config);

  const drawPile = shuffleCards(createDeck(), random);
  const players: GamePlayer[] = playerIds.map((id) => ({ id, hand: [] }));

  for (let round = 0; round < config.initialHandSize; round += 1) {
    for (const player of players) {
      const card = drawPile.pop();
      if (!card) {
        throw new Error("Deck ran out while dealing");
      }
      player.hand.push(card);
    }
  }

  const starterIndex = findStarterIndex(drawPile);
  const starter = drawPile.splice(starterIndex, 1)[0];

  if (starter?.kind !== "number") {
    throw new Error("A numbered starter card was not available");
  }

  return {
    phase: "playing",
    players,
    drawPile,
    discardPile: [starter],
    currentColor: starter.color,
    turnIndex: 0,
    direction: 1,
    drawnCardId: null,
    pendingPenalty: null,
    finalCalledPlayerIds: [],
    skippedPlayerId: null,
    winnerId: null,
    turnNumber: 1,
    config: { ...config },
  };
}

export function applyGameAction(
  state: GameState,
  playerId: string,
  action: GameAction,
  random: RandomSource,
): GameResult {
  if (state.phase === "finished") {
    return { ok: false, error: "game_finished" };
  }

  const currentPlayer = state.players[state.turnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId) {
    return { ok: false, error: "not_your_turn" };
  }

  if (action.type === "play-card") {
    return playCard(state, currentPlayer, action.cardId, action.chosenColor, random);
  }

  if (action.type === "draw-card") {
    return drawCard(state, currentPlayer, random);
  }

  return passTurn(state);
}

export function canPlayCard(
  card: Card,
  topDiscard: Card,
  currentColor: CardColor,
  hand: readonly Card[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
): boolean {
  if (card.kind === "wild") {
    return true;
  }

  if (card.kind === "wild-draw-four") {
    return (
      !config.enforceWildDrawFour ||
      !hand.some((candidate) => "color" in candidate && candidate.color === currentColor)
    );
  }

  if ("color" in card && card.color === currentColor) {
    return true;
  }

  if (card.kind === "number" && topDiscard.kind === "number") {
    return card.number === topDiscard.number;
  }

  return card.kind !== "number" && card.kind === topDiscard.kind;
}

function canStackPenalty(
  card: Card,
  minimum: 2 | 4,
  topDiscard: Card,
  currentColor: CardColor,
  hand: readonly Card[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
): boolean {
  if (card.kind === "draw-two") {
    return minimum <= 2;
  }

  return (
    card.kind === "wild-draw-four" &&
    minimum <= 4 &&
    canPlayCard(card, topDiscard, currentColor, hand, config)
  );
}

export function getPlayableCards(state: GameState, playerId: string): Card[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const topDiscard = state.discardPile.at(-1);

  if (!player || !topDiscard || state.phase !== "playing") {
    return [];
  }

  if (state.pendingPenalty) {
    const { minimum } = state.pendingPenalty;
    return player.hand.filter((card) =>
      canStackPenalty(card, minimum, topDiscard, state.currentColor, player.hand, state.config),
    );
  }

  const playable = player.hand.filter((card) =>
    canPlayCard(card, topDiscard, state.currentColor, player.hand, state.config),
  );

  if (state.drawnCardId) {
    return playable.filter((card) => card.id === state.drawnCardId);
  }

  return playable;
}

export function callFinal(state: GameState, playerId: string): GameResult {
  if (state.phase === "finished") {
    return { ok: false, error: "game_finished" };
  }

  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player?.hand.length !== 1 || state.finalCalledPlayerIds.includes(playerId)) {
    return { ok: false, error: "final_not_available" };
  }

  const nextState = cloneState(state);
  nextState.finalCalledPlayerIds.push(playerId);
  return {
    ok: true,
    state: nextState,
    events: [{ type: "final-called", playerId }],
  };
}

export function catchFinal(
  state: GameState,
  catcherId: string,
  playerId: string,
  random: RandomSource,
): GameResult {
  if (state.phase === "finished") {
    return { ok: false, error: "game_finished" };
  }

  const catcher = state.players.find((candidate) => candidate.id === catcherId);
  const playerIndex = state.players.findIndex((candidate) => candidate.id === playerId);
  const player = state.players[playerIndex];
  if (
    !catcher ||
    !player ||
    catcher.id === player.id ||
    player.hand.length !== 1 ||
    state.finalCalledPlayerIds.includes(player.id)
  ) {
    return { ok: false, error: "final_not_catchable" };
  }

  const nextState = cloneState(state);
  const count = drawCards(nextState, playerIndex, 2, random);
  if (nextState.players[playerIndex]?.hand.length === 1) {
    nextState.finalCalledPlayerIds.push(playerId);
  }
  return {
    ok: true,
    state: nextState,
    events: [
      { type: "cards-drawn", playerId, count, cause: "final" },
      { type: "final-caught", catcherId, playerId, count },
    ],
  };
}

function advanceIndex(
  currentIndex: number,
  direction: TurnDirection,
  playerCount: number,
  steps = 1,
): number {
  return (((currentIndex + direction * steps) % playerCount) + playerCount) % playerCount;
}

function playCard(
  state: GameState,
  currentPlayer: GamePlayer,
  cardId: string,
  chosenColor: CardColor | undefined,
  random: RandomSource,
): GameResult {
  const card = currentPlayer.hand.find((candidate) => candidate.id === cardId);
  const topDiscard = state.discardPile.at(-1);

  if (!card || !topDiscard) {
    return { ok: false, error: "card_not_found" };
  }
  if (state.drawnCardId && card.id !== state.drawnCardId) {
    return { ok: false, error: "must_play_drawn_card" };
  }
  const cardIsPlayable = state.pendingPenalty
    ? canStackPenalty(
        card,
        state.pendingPenalty.minimum,
        topDiscard,
        state.currentColor,
        currentPlayer.hand,
        state.config,
      )
    : canPlayCard(card, topDiscard, state.currentColor, currentPlayer.hand, state.config);
  if (!cardIsPlayable) {
    return { ok: false, error: "card_not_playable" };
  }

  const isWild = card.kind === "wild" || card.kind === "wild-draw-four";
  if (isWild && chosenColor === undefined) {
    return { ok: false, error: "color_required" };
  }
  if (chosenColor !== undefined && (!isWild || !isCardColor(chosenColor))) {
    return { ok: false, error: "color_not_allowed" };
  }

  const nextState = cloneState(state);
  const nextPlayer = nextState.players[nextState.turnIndex];
  if (!nextPlayer) {
    throw new Error("Current player disappeared while applying a card");
  }

  nextPlayer.hand = nextPlayer.hand.filter((candidate) => candidate.id !== card.id);
  nextState.finalCalledPlayerIds = nextState.finalCalledPlayerIds.filter(
    (playerId) => playerId !== nextPlayer.id,
  );
  nextState.discardPile.push(card);
  nextState.currentColor = "color" in card ? card.color : (chosenColor as CardColor);
  nextState.drawnCardId = null;

  const events: GameEvent[] = [];
  clearSkippedPlayer(nextState, events);
  events.push({
    type: "card-played",
    playerId: currentPlayer.id,
    card,
  });

  if (card.kind === "draw-two" || card.kind === "wild-draw-four") {
    const penalty = card.kind === "draw-two" ? 2 : 4;
    nextState.pendingPenalty = {
      total: (nextState.pendingPenalty?.total ?? 0) + penalty,
      minimum: penalty,
    };
    const penalizedIndex = advanceIndex(
      nextState.turnIndex,
      nextState.direction,
      nextState.players.length,
    );
    if (nextPlayer.hand.length === 0) {
      settlePenalty(nextState, penalizedIndex, random, events);
      return finishGame(nextState, nextPlayer.id, events);
    }

    const penalizedPlayer = nextState.players[penalizedIndex];
    if (!penalizedPlayer) {
      throw new Error("Penalty target disappeared");
    }
    const canRespond = hasPenaltyResponse(nextState, penalizedPlayer);
    if (canRespond) {
      moveTurn(nextState, 1, events);
      return { ok: true, state: nextState, events };
    }

    settlePenalty(nextState, penalizedIndex, random, events);
    moveTurn(nextState, 2, events);
    return { ok: true, state: nextState, events };
  }

  if (nextPlayer.hand.length === 0) {
    return finishGame(nextState, nextPlayer.id, events);
  }

  if (card.kind === "reverse") {
    nextState.direction = nextState.direction === 1 ? -1 : 1;
    const steps = nextState.players.length === 2 ? 2 : 1;
    moveTurn(nextState, steps, events);
    return { ok: true, state: nextState, events };
  }

  if (card.kind === "skip") {
    const skippedPlayer =
      nextState.players[
        advanceIndex(nextState.turnIndex, nextState.direction, nextState.players.length)
      ];
    if (!skippedPlayer) {
      throw new Error("Skipped player does not exist");
    }
    nextState.skippedPlayerId = skippedPlayer.id;
    events.push({ type: "player-skipped", playerId: skippedPlayer.id });
    moveTurn(nextState, 2, events);
    return { ok: true, state: nextState, events };
  }

  moveTurn(nextState, 1, events);
  return { ok: true, state: nextState, events };
}

function finishGame(state: GameState, winnerId: string, events: GameEvent[]): GameResult {
  state.phase = "finished";
  state.winnerId = winnerId;
  return { ok: true, state, events };
}

function drawCard(state: GameState, currentPlayer: GamePlayer, random: RandomSource): GameResult {
  if (state.drawnCardId) {
    return { ok: false, error: "already_drew" };
  }

  const nextState = cloneState(state);
  const events: GameEvent[] = [];
  clearSkippedPlayer(nextState, events);

  if (nextState.pendingPenalty) {
    settlePenalty(nextState, nextState.turnIndex, random, events);
    moveTurn(nextState, 1, events);
    return { ok: true, state: nextState, events };
  }

  const count = drawCards(nextState, nextState.turnIndex, 1, random);
  const nextPlayer = nextState.players[nextState.turnIndex];

  if (!nextPlayer) {
    throw new Error("Current player disappeared while drawing");
  }

  events.push({ type: "cards-drawn", playerId: currentPlayer.id, count, cause: "turn" });

  const drawn = nextPlayer.hand.at(-1);
  const topDiscard = nextState.discardPile.at(-1);
  if (
    drawn &&
    topDiscard &&
    canPlayCard(drawn, topDiscard, nextState.currentColor, nextPlayer.hand, nextState.config)
  ) {
    nextState.drawnCardId = drawn.id;
    return { ok: true, state: nextState, events };
  }

  moveTurn(nextState, 1, events);
  return { ok: true, state: nextState, events };
}

function passTurn(state: GameState): GameResult {
  if (state.pendingPenalty) {
    return { ok: false, error: "penalty_draw_required" };
  }
  if (!state.drawnCardId) {
    return { ok: false, error: "draw_required" };
  }

  const nextState = cloneState(state);
  const events: GameEvent[] = [];
  clearSkippedPlayer(nextState, events);
  nextState.drawnCardId = null;
  moveTurn(nextState, 1, events);
  return { ok: true, state: nextState, events };
}

function hasPenaltyResponse(state: GameState, player: GamePlayer): boolean {
  const topDiscard = state.discardPile.at(-1);
  if (!state.pendingPenalty || !topDiscard) return false;
  const { minimum } = state.pendingPenalty;
  return player.hand.some((card) =>
    canStackPenalty(card, minimum, topDiscard, state.currentColor, player.hand, state.config),
  );
}

function settlePenalty(
  state: GameState,
  playerIndex: number,
  random: RandomSource,
  events: GameEvent[],
): void {
  const penalty = state.pendingPenalty;
  const player = state.players[playerIndex];
  if (!penalty || !player) {
    throw new Error("Penalty state is incomplete");
  }

  const drawn = drawCards(state, playerIndex, penalty.total, random);
  state.pendingPenalty = null;
  events.push({
    type: "cards-drawn",
    playerId: player.id,
    count: drawn,
    cause: "penalty",
  });
}

function drawCards(
  state: GameState,
  playerIndex: number,
  count: number,
  random: RandomSource,
): number {
  const player = state.players[playerIndex];
  if (!player) {
    throw new Error("Draw target does not exist");
  }

  let drawn = 0;
  for (let index = 0; index < count; index += 1) {
    if (state.drawPile.length === 0) {
      recycleDiscardPile(state, random);
    }

    const card = state.drawPile.pop();
    if (!card) {
      break;
    }

    player.hand.push(card);
    drawn += 1;
  }

  if (drawn > 0) {
    state.finalCalledPlayerIds = state.finalCalledPlayerIds.filter(
      (playerId) => playerId !== player.id,
    );
  }

  return drawn;
}

function recycleDiscardPile(state: GameState, random: RandomSource): void {
  if (state.discardPile.length <= 1) {
    return;
  }

  const topDiscard = state.discardPile.at(-1);
  if (!topDiscard) {
    return;
  }

  const recyclable = state.discardPile.slice(0, -1);
  state.discardPile = [topDiscard];
  state.drawPile = shuffleCards(recyclable, random);
}

function moveTurn(state: GameState, steps: number, events: GameEvent[]): void {
  state.turnIndex = advanceIndex(state.turnIndex, state.direction, state.players.length, steps);
  state.turnNumber += 1;
  const nextPlayer = state.players[state.turnIndex];
  if (!nextPlayer) {
    throw new Error("Next player does not exist");
  }
  events.push({ type: "turn-started" });
}

function clearSkippedPlayer(state: GameState, events: GameEvent[]): void {
  if (!state.skippedPlayerId) return;
  events.push({ type: "player-unskipped", playerId: state.skippedPlayerId });
  state.skippedPlayerId = null;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    config: { ...state.config },
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    pendingPenalty: state.pendingPenalty ? { ...state.pendingPenalty } : null,
    finalCalledPlayerIds: [...state.finalCalledPlayerIds],
  };
}

function findStarterIndex(drawPile: readonly Card[]): number {
  for (let index = drawPile.length - 1; index >= 0; index -= 1) {
    if (drawPile[index]?.kind === "number") {
      return index;
    }
  }
  throw new Error("Deck contains no numbered cards");
}

function validatePlayers(playerIds: readonly string[], config: GameConfig): void {
  if (playerIds.length < 2 || playerIds.length > config.maxPlayers) {
    throw new Error(`A game requires between 2 and ${config.maxPlayers} players`);
  }
  if (new Set(playerIds).size !== playerIds.length || playerIds.some((id) => id.length === 0)) {
    throw new Error("Player identifiers must be non-empty and unique");
  }
  if (config.initialHandSize < 1) {
    throw new Error("Initial hand size must be positive");
  }
}
