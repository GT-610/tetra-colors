import { describe, expect, it } from "vitest";
import type { BotDifficulty, GameState, RandomSource } from "../src/logic";
import { applyGameAction, chooseBotAction, startGame } from "../src/logic";
import { validateGameState } from "./helpers/game-state";

describe("headless bot simulation", () => {
  it("finishes 120 games without deadlocks or invalid states", () => {
    const difficulties: BotDifficulty[] = ["easy", "medium", "hard"];
    const results: Array<{ turns: number; winnerId: string }> = [];

    for (let gameNumber = 0; gameNumber < 120; gameNumber += 1) {
      const playerCount = 2 + (gameNumber % 5);
      const random = seededRandom(gameNumber + 1);
      const playerIds = Array.from({ length: playerCount }, (_, index) => `bot-${index}`);
      let state = startGame(playerIds, random);
      let actions = 0;

      while (state.phase === "playing" && actions < 5_000) {
        expect(validateGameState(state)).toEqual([]);
        const player = state.players[state.turnIndex];
        if (!player) {
          throw new Error("Simulation turn points to a missing player");
        }

        const difficulty = difficulties[(gameNumber + state.turnIndex) % difficulties.length];
        if (!difficulty) {
          throw new Error("Simulation difficulty was not selected");
        }

        const action = chooseBotAction(state, player.id, difficulty, random);
        const result = applyGameAction(state, player.id, action, random);
        if (!result.ok) {
          throw new Error(`Bot produced an invalid action: ${result.error}`);
        }

        state = result.state;
        actions += 1;
      }

      expect(state.phase, `game ${gameNumber} exceeded the action limit`).toBe("finished");
      expect(validateGameState(state)).toEqual([]);
      const winner = getWinner(state);
      expect(winner.hand).toHaveLength(0);
      results.push({ turns: actions, winnerId: winner.id });
    }

    expect(results).toHaveLength(120);
    expect(Math.max(...results.map((result) => result.turns))).toBeLessThan(5_000);
  });
});

function getWinner(state: GameState) {
  const winner = state.players.find((player) => player.id === state.winnerId);
  if (!winner) {
    throw new Error("Finished simulation has no winner");
  }
  return winner;
}

function seededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 4_294_967_296;
  };
}
