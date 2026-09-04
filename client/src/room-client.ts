import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ClientMessage,
  RoomEvent,
  RoomSessionResponse,
  RoomSnapshot,
  ServerMessage,
} from "../../src/protocol";
import { isPlayerToken, normalizeRoomCode } from "../../src/protocol";
import { copy } from "./copy";

const SESSION_KEY = "tetra-colors.session";
const HEARTBEAT_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 5;

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

interface RoomClient {
  session: RoomSessionResponse | null;
  snapshot: RoomSnapshot | null;
  connectionState: ConnectionState;
  error: string | null;
  latestEvent: RoomEvent | null;
  busy: boolean;
  createRoom: (nickname: string) => Promise<void>;
  joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  send: (message: ClientMessage) => boolean;
  leave: () => void;
  clearError: () => void;
}

export function useRoomClient(): RoomClient {
  const [session, setSession] = useState<RoomSessionResponse | null>(readSession);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    session ? "connecting" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [latestEvent, setLatestEvent] = useState<RoomEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAllowedRef = useRef(true);

  useEffect(() => {
    if (!session) {
      setConnectionState("idle");
      return;
    }

    reconnectAllowedRef.current = true;
    let disposed = false;
    let reconnectAttempts = 0;
    let reconnectTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    const connect = () => {
      if (disposed) return;
      setConnectionState(reconnectAttempts === 0 ? "connecting" : "reconnecting");
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = new URL(`${protocol}//${window.location.host}/ws/${session.roomCode}`);
      const socket = new WebSocket(url, session.playerToken);
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        setConnectionState("connected");
        setError(null);
        heartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "heartbeat" } satisfies ClientMessage));
          }
        }, HEARTBEAT_MS);
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          setError(copy.unknownError);
          return;
        }

        if (message.type === "snapshot") {
          setSnapshot(message.snapshot);
        } else if (message.type === "event") {
          setLatestEvent(message.event);
        } else if (message.type === "error") {
          setError(message.message);
          if (message.code === "session_expired") clearStoredSession();
        }
      });

      socket.addEventListener("close", () => {
        if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
        if (disposed || !reconnectAllowedRef.current) return;
        reconnectAttempts += 1;
        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          setConnectionState("disconnected");
          setError(copy.invalidSession);
          return;
        }

        setConnectionState("reconnecting");
        reconnectTimer = window.setTimeout(
          connect,
          Math.min(1_000 * 2 ** (reconnectAttempts - 1), 8_000),
        );
      });
    };

    connect();
    return () => {
      disposed = true;
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socketRef.current?.close(1000, "Client navigation");
      socketRef.current = null;
    };
  }, [session]);

  const activateSession = useCallback((nextSession: RoomSessionResponse) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setSnapshot(null);
    setLatestEvent(null);
    setError(null);
    setSession(nextSession);
  }, []);

  const createRoom = useCallback(
    async (nickname: string) => {
      setBusy(true);
      setError(null);
      try {
        activateSession(
          await requestSession("/api/rooms", {
            nickname,
          }),
        );
      } catch (requestError) {
        setError(errorMessage(requestError));
      } finally {
        setBusy(false);
      }
    },
    [activateSession],
  );

  const joinRoom = useCallback(
    async (nickname: string, roomCode: string) => {
      setBusy(true);
      setError(null);
      try {
        activateSession(
          await requestSession(`/api/rooms/${roomCode.trim().toUpperCase()}/join`, {
            nickname,
          }),
        );
      } catch (requestError) {
        setError(errorMessage(requestError));
      } finally {
        setBusy(false);
      }
    },
    [activateSession],
  );

  const send = useCallback((message: ClientMessage): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError(copy.reconnecting);
      return false;
    }
    socket.send(JSON.stringify(message));
    setError(null);
    return true;
  }, []);

  const leave = useCallback(() => {
    reconnectAllowedRef.current = false;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "room.leave" } satisfies ClientMessage));
    }
    socket?.close(1000, "Left room");
    clearStoredSession();
    setSession(null);
    setSnapshot(null);
    setLatestEvent(null);
    setError(null);
  }, []);

  return {
    session,
    snapshot,
    connectionState,
    error,
    latestEvent,
    busy,
    createRoom,
    joinRoom,
    send,
    leave,
    clearError: () => setError(null),
  };
}

async function requestSession(
  path: string,
  body: Record<string, unknown>,
): Promise<RoomSessionResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    throw new Error(readApiMessage(value) ?? copy.unknownError);
  }
  if (!isSession(value)) {
    throw new Error(copy.unknownError);
  }
  return value;
}

function readSession(): RoomSessionResponse | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    return isSession(value) ? value : null;
  } catch {
    return null;
  }
}

function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function isSession(value: unknown): value is RoomSessionResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "roomCode" in value &&
    typeof value.roomCode === "string" &&
    normalizeRoomCode(value.roomCode) === value.roomCode &&
    "playerId" in value &&
    typeof value.playerId === "string" &&
    "playerToken" in value &&
    isPlayerToken(value.playerToken)
  );
}

function readApiMessage(value: unknown): string | null {
  return typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string"
    ? value.message
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : copy.unknownError;
}
