import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "../client/src/copy";
import { EVENT_DISPLAY_MS } from "../client/src/ui-timing";
import type { Card } from "../src/logic";
import type { RoomSnapshot } from "../src/protocol";

const hookHarness = vi.hoisted(() => ({
  effect: undefined as undefined | (() => unknown),
  stateSetters: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => {
    hookHarness.effect = effect;
  },
  useRef: (initialValue: unknown) => ({ current: initialValue }),
  useState: (initialState: unknown) => {
    const value = typeof initialState === "function" ? initialState() : initialState;
    const setter = vi.fn();
    hookHarness.stateSetters.push(setter);
    return [value, setter];
  },
}));

import { useRoomClient } from "../client/src/room-client";

const SESSION_KEY = "tetra-colors.session";
const session = {
  roomCode: "ABCD2",
  playerId: "player-one",
  playerToken: "a".repeat(64),
};

type SocketListener = (event: { data?: unknown }) => void;

class MockWebSocket {
  static readonly OPEN = 1;
  readonly listeners = new Map<string, SocketListener[]>();
  readonly close = vi.fn();
  readyState = 0;

  constructor(
    readonly url: URL,
    readonly protocol: string,
  ) {
    sockets.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(): void {}

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: MockWebSocket[] = [];
const timeoutCallbacks: Array<{ callback: () => void; delay: number }> = [];
let storedSession: string | null;
let removeItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hookHarness.effect = undefined;
  hookHarness.stateSetters.length = 0;
  sockets.length = 0;
  timeoutCallbacks.length = 0;
  storedSession = JSON.stringify(session);
  removeItem = vi.fn((key: string) => {
    if (key === SESSION_KEY) storedSession = null;
  });

  vi.stubGlobal("sessionStorage", {
    getItem: vi.fn((key: string) => (key === SESSION_KEY ? storedSession : null)),
    removeItem,
    setItem: vi.fn(),
  });
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal("window", {
    location: { host: "example.test", protocol: "https:" },
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    setTimeout: vi.fn((callback: () => void, delay: number) => {
      timeoutCallbacks.push({ callback, delay });
      return timeoutCallbacks.length;
    }),
    clearTimeout: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("room client session invalidation", () => {
  it("clears a rejected session after the bounded reconnect attempts", () => {
    useRoomClient();
    hookHarness.effect?.();

    for (let attempt = 0; attempt <= 5; attempt += 1) {
      sockets[attempt]?.emit("close");
      if (attempt < 5) timeoutCallbacks.shift()?.callback();
    }

    expect(sockets).toHaveLength(6);
    expect(timeoutCallbacks).toHaveLength(0);
    expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
    expect(stateSetter(0)).toHaveBeenCalledWith(null);
    expect(stateSetter(1)).toHaveBeenCalledWith(null);
    expect(stateSetter(3)).toHaveBeenCalledWith(copy.invalidSession);
    expect(stateSetter(4)).toHaveBeenCalledWith(null);
  });

  it("preserves cleanup for an accepted session-expired message", () => {
    useRoomClient();
    hookHarness.effect?.();
    const socket = sockets[0];

    socket?.emit("message", {
      data: JSON.stringify({
        type: "error",
        code: "session_expired",
        message: copy.invalidSession,
      }),
    });

    expect(removeItem).toHaveBeenCalledWith(SESSION_KEY);
    expect(stateSetter(0)).toHaveBeenCalledWith(null);
    expect(stateSetter(1)).toHaveBeenCalledWith(null);
    expect(stateSetter(4)).toHaveBeenCalledWith(null);
    expect(socket?.close).toHaveBeenCalledWith(4401, "Session expired");
  });

  it("clears room events after the display interval", () => {
    useRoomClient();
    hookHarness.effect?.();
    const event = { type: "player-reconnected", playerId: "player-two" } as const;

    sockets[0]?.emit("message", {
      data: JSON.stringify({ type: "event", event }),
    });

    expect(stateSetter(4)).toHaveBeenCalledWith(event);
    expect(timeoutCallbacks).toHaveLength(1);
    expect(timeoutCallbacks[0]?.delay).toBe(EVENT_DISPLAY_MS);

    timeoutCallbacks[0]?.callback();
    expect(stateSetter(4)).toHaveBeenLastCalledWith(null);
  });

  it("buffers consecutive events and freezes the snapshot until animation completes", () => {
    const client = useRoomClient();
    hookHarness.effect?.();
    const initial = gameSnapshot(1, [numberCard("old", 1)]);
    const next = gameSnapshot(2, [numberCard("old", 1), numberCard("drawn", 2)]);

    sockets[0]?.emit("message", {
      data: JSON.stringify({ type: "snapshot", snapshot: initial }),
    });
    sockets[0]?.emit("message", {
      data: JSON.stringify({
        type: "event",
        event: { type: "card-played", playerId: "other", card: numberCard("played", 3) },
      }),
    });
    sockets[0]?.emit("message", {
      data: JSON.stringify({
        type: "event",
        event: { type: "cards-drawn", playerId: "self", count: 1, cause: "turn" },
      }),
    });
    sockets[0]?.emit("message", {
      data: JSON.stringify({ type: "snapshot", snapshot: next }),
    });

    expect(stateSetter(1)).toHaveBeenLastCalledWith(initial);
    expect(stateSetter(5)).toHaveBeenLastCalledWith(
      expect.objectContaining({ previous: initial, next, events: expect.any(Array) }),
    );
    const transition = stateSetter(5).mock.calls.at(-1)?.[0];
    expect(transition.events.map((event: { type: string }) => event.type)).toEqual([
      "card-played",
      "cards-drawn",
    ]);

    client.completeTransition();
    expect(stateSetter(1)).toHaveBeenLastCalledWith(next);
    expect(stateSetter(5)).toHaveBeenLastCalledWith(null);
  });

  it("plays queued snapshot transitions in order", () => {
    const client = useRoomClient();
    hookHarness.effect?.();
    const initial = gameSnapshot(1, [numberCard("old", 1)]);
    const first = gameSnapshot(2, [numberCard("old", 1), numberCard("drawn", 2)]);
    const second = gameSnapshot(3, [numberCard("old", 1), numberCard("drawn", 2)]);

    emitServerMessage({ type: "snapshot", snapshot: initial });
    emitServerMessage({
      type: "event",
      event: {
        type: "cards-drawn",
        playerId: session.playerId,
        count: 1,
        cause: "turn",
      },
    });
    emitServerMessage({ type: "snapshot", snapshot: first });
    emitServerMessage({
      type: "event",
      event: { type: "card-played", playerId: "other", card: numberCard("played", 3) },
    });
    emitServerMessage({ type: "snapshot", snapshot: second });

    expect(stateSetter(1)).toHaveBeenLastCalledWith(initial);
    client.completeTransition();
    expect(stateSetter(1)).toHaveBeenLastCalledWith(first);
    expect(stateSetter(5)).toHaveBeenLastCalledWith(
      expect.objectContaining({ previous: first, next: second }),
    );
    client.completeTransition();
    expect(stateSetter(1)).toHaveBeenLastCalledWith(second);
  });
});

function stateSetter(index: number): ReturnType<typeof vi.fn> {
  const setter = hookHarness.stateSetters[index];
  if (!setter) throw new Error(`Missing state setter at index ${index}`);
  return setter;
}

function emitServerMessage(message: object): void {
  sockets[0]?.emit("message", { data: JSON.stringify(message) });
}

function gameSnapshot(turnNumber: number, hand: Card[]): RoomSnapshot {
  return {
    roomCode: session.roomCode,
    phase: "playing",
    selfId: session.playerId,
    hostId: session.playerId,
    players: [
      {
        id: session.playerId,
        nickname: "自己",
        isBot: false,
        difficulty: null,
        connected: true,
        handCount: hand.length,
        finalCalled: false,
      },
      {
        id: "other",
        nickname: "对手",
        isBot: false,
        difficulty: null,
        connected: true,
        handCount: 3,
        finalCalled: false,
      },
    ],
    hand,
    game: {
      topDiscard: numberCard("top", 0),
      currentColor: "coral",
      currentPlayerId: session.playerId,
      direction: 1,
      drawPileCount: 80,
      turnNumber,
      turnDeadline: Date.now() + 30_000,
      actionBlockedUntil: Date.now() + 1_000,
      playableCardIds: [],
      drawnCardId: null,
      pendingPenalty: null,
      finalCalled: false,
      skippedPlayerId: null,
      winnerId: null,
    },
  };
}

function numberCard(id: string, number: 0 | 1 | 2 | 3): Card {
  return { id, kind: "number", color: "coral", number };
}
