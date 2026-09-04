import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import type { RoomSessionResponse, RoomSnapshot, ServerMessage } from "../src/protocol";

const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    try {
      socket.close(1000, "Test complete");
    } catch {
      // The server may already have replaced or closed this socket.
    }
  }
});

describe("RoomDO integration", () => {
  it("creates, joins, reconnects, and enforces room capacity", async () => {
    const host = await createRoom("房主");
    expect(host.roomCode).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);

    const guest = await joinRoom(host.roomCode, "来宾");
    const reconnected = await joinRoom(host.roomCode, "ignored", guest.playerToken);
    expect(reconnected.playerId).toBe(guest.playerId);
    expect(reconnected.playerToken).toBe(guest.playerToken);

    for (let index = 0; index < 4; index += 1) {
      const response = await joinRoomResponse(host.roomCode, `玩家 ${index}`);
      expect(response.status).toBe(201);
    }

    const fullResponse = await joinRoomResponse(host.roomCode, "第七位");
    expect(fullResponse.status).toBe(409);
    await expect(fullResponse.json()).resolves.toMatchObject({ error: "room_full" });

    const invalidReconnect = await joinRoomResponse(host.roomCode, "来宾", "0".repeat(64));
    expect(invalidReconnect.status).toBe(401);
  });

  it("runs a multi-connection lobby and sends only personalized game state", async () => {
    const host = await createRoom("山雀");
    const guest = await joinRoom(host.roomCode, "雨燕");
    const hostConnection = await connect(host);
    const guestConnection = await connect(guest);

    await hostConnection.inbox.waitFor(
      (message) => message.type === "snapshot" && message.snapshot.players.length === 2,
    );
    await guestConnection.inbox.waitFor(
      (message) => message.type === "snapshot" && message.snapshot.players.length === 2,
    );

    guestConnection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "hard" }));
    await expectServerError(guestConnection.inbox, "not_host");

    hostConnection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "hard" }));
    await hostConnection.inbox.waitFor(
      (message) => message.type === "snapshot" && message.snapshot.players.length === 3,
    );

    hostConnection.socket.send(JSON.stringify({ type: "lobby.start" }));
    const hostSnapshot = await snapshotFrom(
      hostConnection.inbox,
      (snapshot) => snapshot.phase === "playing",
    );
    const guestSnapshot = await snapshotFrom(
      guestConnection.inbox,
      (snapshot) => snapshot.phase === "playing",
    );

    expect(hostSnapshot.hand).toHaveLength(7);
    expect(guestSnapshot.hand).toHaveLength(7);
    expect(hostSnapshot.players.every((player) => player.handCount === 7)).toBe(true);
    expect(guestSnapshot.players.every((player) => player.handCount === 7)).toBe(true);
    expect(hostSnapshot.game?.currentPlayerId).toBe(host.playerId);
    expect(guestSnapshot.game?.playableCardIds).toEqual([]);
    expect(guestSnapshot.game?.drawnCardId).toBeNull();

    const hostPayload = JSON.stringify(hostSnapshot);
    const guestPayload = JSON.stringify(guestSnapshot);
    for (const card of guestSnapshot.hand) {
      expect(hostPayload).not.toContain(card.id);
    }
    for (const card of hostSnapshot.hand) {
      expect(guestPayload).not.toContain(card.id);
    }

    guestConnection.socket.send(JSON.stringify({ type: "game.draw-card" }));
    await expectServerError(guestConnection.inbox, "invalid_action");
  });

  it("rate limits excessive WebSocket actions", async () => {
    const host = await createRoom("节流测试");
    const connection = await connect(host);
    await connection.inbox.waitFor((message) => message.type === "snapshot");

    for (let index = 0; index < 20; index += 1) {
      connection.socket.send(JSON.stringify({ type: "heartbeat" }));
    }

    await expectServerError(connection.inbox, "rate_limited");
  });
});

class MessageInbox {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];

  constructor(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data) as ServerMessage;
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      const waiter = waiterIndex >= 0 ? this.waiters.splice(waiterIndex, 1)[0] : undefined;
      if (waiter) {
        waiter.resolve(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 3_000,
  ): Promise<ServerMessage> {
    const existingIndex = this.queue.findIndex(predicate);
    const existing = existingIndex >= 0 ? this.queue.splice(existingIndex, 1)[0] : undefined;
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
          reject(new Error("Timed out waiting for a WebSocket message"));
        }
      }, timeoutMs);
    });
  }
}

async function createRoom(nickname: string): Promise<RoomSessionResponse> {
  const response = await exports.default.fetch("https://example.com/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  expect(response.status).toBe(201);
  return response.json<RoomSessionResponse>();
}

async function joinRoom(
  roomCode: string,
  nickname: string,
  playerToken?: string,
): Promise<RoomSessionResponse> {
  const response = await joinRoomResponse(roomCode, nickname, playerToken);
  expect(response.status).toBe(playerToken ? 200 : 201);
  return response.json<RoomSessionResponse>();
}

function joinRoomResponse(roomCode: string, nickname: string, playerToken?: string) {
  return exports.default.fetch(`https://example.com/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(playerToken === undefined ? { nickname } : { nickname, playerToken }),
  });
}

async function connect(session: RoomSessionResponse) {
  const response = await exports.default.fetch(
    new Request(
      `https://example.com/ws/${session.roomCode}?token=${encodeURIComponent(session.playerToken)}`,
      { headers: { Upgrade: "websocket" } },
    ),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("WebSocket response did not include a client socket");

  const inbox = new MessageInbox(socket);
  sockets.push(socket);
  socket.accept();
  await inbox.waitFor((message) => message.type === "welcome");
  return { socket, inbox };
}

async function snapshotFrom(
  inbox: MessageInbox,
  predicate: (snapshot: RoomSnapshot) => boolean,
): Promise<RoomSnapshot> {
  const message = await inbox.waitFor(
    (candidate) => candidate.type === "snapshot" && predicate(candidate.snapshot),
  );
  if (message.type !== "snapshot") throw new Error("Expected a snapshot message");
  return message.snapshot;
}

async function expectServerError(inbox: MessageInbox, code: string): Promise<void> {
  const message = await inbox.waitFor(
    (candidate) => candidate.type === "error" && candidate.code === code,
  );
  expect(message).toMatchObject({ type: "error", code });
}
