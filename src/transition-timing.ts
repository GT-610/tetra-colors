export const CARD_PLAY_ANIMATION_MS = 560;
export const CARD_DEAL_ANIMATION_MS = 560;
export const CARD_DEAL_STAGGER_MS = CARD_DEAL_ANIMATION_MS / 2;
export const CARD_REVEAL_ANIMATION_MS = 320;
export const SKIP_STATUS_ANIMATION_MS = 360;

interface TimedEvent {
  type: string;
  count?: number;
}

export interface TransitionTimeline {
  durationMs: number;
  eventStartsMs: number[];
}

export function buildTransitionTimeline(events: readonly TimedEvent[]): TransitionTimeline {
  const eventStartsMs = events.map(() => 0);
  let cursor = 0;
  let lastCardPlayEnd = 0;

  for (const [index, event] of events.entries()) {
    if (event.type === "card-played") {
      eventStartsMs[index] = cursor;
      cursor += CARD_PLAY_ANIMATION_MS;
      lastCardPlayEnd = cursor;
    } else if (event.type === "cards-drawn") {
      eventStartsMs[index] = cursor;
      const count = Math.max(0, event.count ?? 0);
      if (count > 0) {
        cursor +=
          CARD_DEAL_ANIMATION_MS + CARD_DEAL_STAGGER_MS * (count - 1) + CARD_REVEAL_ANIMATION_MS;
      }
    }
  }

  const hasNewSkip = events.some((event) => event.type === "player-skipped");
  const skipStatusStart = hasNewSkip ? lastCardPlayEnd : 0;
  let durationMs = cursor;
  for (const [index, event] of events.entries()) {
    if (event.type !== "player-skipped" && event.type !== "player-unskipped") continue;
    eventStartsMs[index] = skipStatusStart;
    durationMs = Math.max(durationMs, skipStatusStart + SKIP_STATUS_ANIMATION_MS);
  }

  return { durationMs, eventStartsMs };
}
