import type { RandomSource } from "./logic";

export const MIN_BOT_DELAY_MS = 1_000;
export const MAX_BOT_DELAY_MS = 5_000;

export function botDelayMs(random: RandomSource): number {
  const value = Math.max(0, Math.min(1, random()));
  return Math.min(
    MAX_BOT_DELAY_MS,
    Math.floor(MIN_BOT_DELAY_MS + value * (MAX_BOT_DELAY_MS - MIN_BOT_DELAY_MS + 1)),
  );
}
