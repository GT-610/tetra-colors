import assert from "node:assert/strict";
import WebSocket, { type RawData } from "ws";

import type { RoomSessionResponse, RoomSnapshot, ServerMessage } from "../src/protocol";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:8787";
const sockets: WebSocket[] = [];

try {
  const host = await createRoom("本地房主");
  const guest = await joinRoom(host.roomCode, "本地来宾");
  const hostConnection = await connect(host);
  const guestConnection = await connect(guest);

  await hostConnection.inbox.waitFor(
    (message) => message.type === "snapshot" && message.snapshot.players.length === 2,
  );
  await guestConnection.inbox.waitFor(
    (message) => message.type === "snapshot" && message.snapshot.players.length === 2,
  );

  guestConnection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "hard" }));
  await guestConnection.inbox.waitFor(
    (message) => message.type === "error" && message.code === "not_host",
  );

  hostConnection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "medium" }));
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

  assert.equal(hostSnapshot.hand.length, 7);
  assert.equal(guestSnapshot.hand.length, 7);
  assert.equal(hostSnapshot.players.length, 3);
  assert.equal(guestSnapshot.game?.playableCardIds.length, 0);

  const hostPayload = JSON.stringify(hostSnapshot);
  const guestPayload = JSON.stringify(guestSnapshot);
  for (const card of guestSnapshot.hand) assert.equal(hostPayload.includes(card.id), false);
  for (const card of hostSnapshot.hand) assert.equal(guestPayload.includes(card.id), false);

  console.log(
    JSON.stringify({
      ok: true,
      roomCode: host.roomCode,
      connections: 2,
      players: hostSnapshot.players.length,
      phase: hostSnapshot.phase,
      hiddenHandsVerified: true,
    }),
  );
} finally {
  for (const socket of sockets) socket.close(1000, "Smoke test complete");
}

class MessageInbox {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data: RawData) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message));
      const waiter = waiterIndex >= 0 ? this.waiters.splice(waiterIndex, 1)[0] : undefined;
      if (waiter) waiter.resolve(message);
      else this.queue.push(message);
    });
  }

  waitFor(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 5_000,
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
  const response = await fetch(`${baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as RoomSessionResponse;
}

async function joinRoom(roomCode: string, nickname: string): Promise<RoomSessionResponse> {
  const response = await fetch(`${baseUrl}/api/rooms/${roomCode}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as RoomSessionResponse;
}

async function connect(session: RoomSessionResponse) {
  const webSocketUrl = new URL(`/ws/${session.roomCode}`, baseUrl);
  webSocketUrl.protocol = webSocketUrl.protocol === "https:" ? "wss:" : "ws:";
  webSocketUrl.searchParams.set("token", session.playerToken);

  const socket = new WebSocket(webSocketUrl);
  const inbox = new MessageInbox(socket);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
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
