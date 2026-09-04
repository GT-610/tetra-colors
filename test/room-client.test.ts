import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copy } from "../client/src/copy";

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
const reconnectCallbacks: Array<() => void> = [];
let storedSession: string | null;
let removeItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  hookHarness.effect = undefined;
  hookHarness.stateSetters.length = 0;
  sockets.length = 0;
  reconnectCallbacks.length = 0;
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
    setTimeout: vi.fn((callback: () => void) => {
      reconnectCallbacks.push(callback);
      return reconnectCallbacks.length;
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
      if (attempt < 5) reconnectCallbacks.shift()?.();
    }

    expect(sockets).toHaveLength(6);
    expect(reconnectCallbacks).toHaveLength(0);
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
});

function stateSetter(index: number): ReturnType<typeof vi.fn> {
  const setter = hookHarness.stateSetters[index];
  if (!setter) throw new Error(`Missing state setter at index ${index}`);
  return setter;
}
