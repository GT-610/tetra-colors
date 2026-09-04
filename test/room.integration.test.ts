import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import type { RoomSessionResponse, RoomSnapshot, ServerMessage } from "../src/protocol";

const sockets: WebSocket[] = [];

interface StoredRoomHarness {
  phase: "lobby" | "playing" | "finished";
  lastActivity: number;
  turnDeadline: number | null;
  scheduledBotAt: number | null;
  players: Array<{
    id: string;
    connected: boolean;
    controlledByBot: boolean;
    disconnectedAt: number | null;
  }>;
  game: { winnerId: string | null; turnNumber: number } | null;
}

interface RoomInstanceHarness {
  room: StoredRoomHarness | null;
  alarm: () => Promise<void>;
}

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
  it("rejects WebSocket tokens supplied in the request URL", async () => {
    const host = await createRoom("鉴权测试");
    const response = await exports.default.fetch(
      new Request(
        `https://example.com/ws/${host.roomCode}?token=${encodeURIComponent(host.playerToken)}`,
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "session_expired" });
  });

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

  it("advances a bot turn through the short scheduler path", async () => {
    const host = await createRoom("节奏测试");
    const connection = await connect(host);

    connection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "hard" }));
    const lobby = await snapshotFrom(
      connection.inbox,
      (snapshot) => snapshot.phase === "lobby" && snapshot.players.length === 2,
    );
    const bot = lobby.players.find((player) => player.isBot);
    expect(bot?.difficulty).toBe("hard");
    if (!bot) throw new Error("Bot snapshot was missing");

    connection.socket.send(JSON.stringify({ type: "lobby.start" }));
    await snapshotFrom(connection.inbox, (snapshot) => snapshot.phase === "playing");

    connection.socket.send(JSON.stringify({ type: "game.draw-card" }));
    const afterDraw = await snapshotFrom(
      connection.inbox,
      (snapshot) =>
        snapshot.phase === "playing" &&
        (snapshot.game?.currentPlayerId === bot.id || snapshot.game?.drawnCardId !== null),
    );
    let botTurn = afterDraw;
    if (afterDraw.game?.currentPlayerId !== bot.id) {
      connection.socket.send(JSON.stringify({ type: "game.pass-turn" }));
      botTurn = await snapshotFrom(
        connection.inbox,
        (snapshot) => snapshot.phase === "playing" && snapshot.game?.currentPlayerId === bot.id,
      );
    }

    const initialTurnNumber = botTurn.game?.turnNumber;
    const initialBotHand = botTurn.players.find((player) => player.id === bot.id)?.handCount;
    const initialDrawPile = botTurn.game?.drawPileCount;
    const initialDiscard = botTurn.game?.topDiscard.id;
    const startedAt = Date.now();

    await snapshotFrom(
      connection.inbox,
      (snapshot) =>
        snapshot.phase === "finished" ||
        snapshot.game?.turnNumber !== initialTurnNumber ||
        snapshot.players.find((player) => player.id === bot.id)?.handCount !== initialBotHand ||
        snapshot.game?.drawPileCount !== initialDrawPile ||
        snapshot.game?.topDiscard.id !== initialDiscard,
      5_000,
    );

    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });

  it("transfers host control when the host leaves an active game", async () => {
    const host = await createRoom("原房主");
    const guest = await joinRoom(host.roomCode, "新房主");
    const hostConnection = await connect(host);
    const guestConnection = await connect(guest);

    await snapshotFrom(
      hostConnection.inbox,
      (snapshot) => snapshot.phase === "lobby" && snapshot.players.length === 2,
    );
    await snapshotFrom(
      guestConnection.inbox,
      (snapshot) => snapshot.phase === "lobby" && snapshot.players.length === 2,
    );

    hostConnection.socket.send(JSON.stringify({ type: "lobby.start" }));
    await snapshotFrom(guestConnection.inbox, (snapshot) => snapshot.phase === "playing");

    hostConnection.socket.send(JSON.stringify({ type: "room.leave" }));
    const transferred = await snapshotFrom(
      guestConnection.inbox,
      (snapshot) => snapshot.phase === "playing" && snapshot.hostId === guest.playerId,
    );

    expect(transferred.players.find((player) => player.id === host.playerId)?.isBot).toBe(true);
    expect(transferred.players.find((player) => player.id === guest.playerId)?.isBot).toBe(false);
  });

  it("survives hibernation and completes the disconnect, reconnect, and rematch lifecycle", async () => {
    const host = await createRoom("生命周期测试");
    const connection = await connect(host);

    connection.socket.send(JSON.stringify({ type: "lobby.add-bot", difficulty: "medium" }));
    await snapshotFrom(
      connection.inbox,
      (snapshot) => snapshot.phase === "lobby" && snapshot.players.length === 2,
    );

    connection.socket.send(JSON.stringify({ type: "lobby.start" }));
    const started = await snapshotFrom(
      connection.inbox,
      (snapshot) => snapshot.phase === "playing",
    );
    const initialTurn = started.game?.turnNumber;
    const stub = env.ROOMS.getByName(host.roomCode);

    await runInDurableObject(stub, async (_instance, state) => {
      const room = await state.storage.get<StoredRoomHarness>("room");
      if (!room) throw new Error("Stored room was missing");
      room.turnDeadline = Date.now() - 1;
      room.scheduledBotAt = null;
      await state.storage.put("room", room);
      await state.storage.setAlarm(Date.now() - 1);
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.setAlarm(Date.now() - 1);
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);

    await connection.inbox.waitFor(
      (message) => message.type === "event" && message.event.type === "turn-timed-out",
    );
    await snapshotFrom(
      connection.inbox,
      (snapshot) => snapshot.phase === "playing" && snapshot.game?.turnNumber !== initialTurn,
    );

    const staleActivity = Date.now() - 16 * 60_000;
    await runInDurableObject(stub, (instance) => {
      const room = (instance as unknown as RoomInstanceHarness).room;
      if (!room) throw new Error("Room instance was missing before disconnect");
      room.lastActivity = staleActivity;
    });
    connection.socket.close(1000, "Lifecycle test disconnect");
    await waitForCondition(() =>
      runInDurableObject(stub, (instance) => {
        const room = (instance as unknown as RoomInstanceHarness).room;
        if (!room) throw new Error("Room was deleted before the reconnect grace elapsed");
        const human = room.players.find((player) => player.id === host.playerId);
        return human?.connected === false && room.lastActivity > staleActivity;
      }),
    );

    const finishedRoom = await runInDurableObject(stub, async (instance) => {
      const roomInstance = instance as unknown as RoomInstanceHarness;
      const human = roomInstance.room?.players.find((player) => player.id === host.playerId);
      if (!human) throw new Error("Host player was missing");
      human.disconnectedAt = Date.now() - 30_001;

      const expiringRoom = roomInstance.room;
      if (!expiringRoom) throw new Error("Room disappeared before reconnect expiry");
      if (expiringRoom.scheduledBotAt !== null) expiringRoom.scheduledBotAt = Date.now() - 1;
      else if (expiringRoom.turnDeadline !== null) expiringRoom.turnDeadline = Date.now() - 1;
      await roomInstance.alarm();
      expect(human.controlledByBot).toBe(true);
      expect(human.disconnectedAt).toBeNull();

      for (let step = 1; step < 1_000; step += 1) {
        const room = roomInstance.room;
        if (!room || room.phase === "finished") return room;
        if (room.scheduledBotAt !== null) room.scheduledBotAt = Date.now() - 1;
        else if (room.turnDeadline !== null) room.turnDeadline = Date.now() - 1;
        await roomInstance.alarm();
      }

      throw new Error("Automated room did not finish within 1,000 alarm steps");
    });

    expect(finishedRoom?.phase).toBe("finished");
    expect(finishedRoom?.game?.winnerId).toBeTruthy();

    const restoredSession = await joinRoom(host.roomCode, "ignored", host.playerToken);
    const restoredConnection = await connect(restoredSession);
    const finishedSnapshot = await snapshotFrom(
      restoredConnection.inbox,
      (snapshot) => snapshot.phase === "finished",
    );
    expect(finishedSnapshot.game?.winnerId).toBe(finishedRoom?.game?.winnerId);

    restoredConnection.socket.send(JSON.stringify({ type: "game.rematch" }));
    const rematch = await snapshotFrom(
      restoredConnection.inbox,
      (snapshot) => snapshot.phase === "playing",
    );
    expect(rematch.players).toHaveLength(2);
    expect(rematch.hand).toHaveLength(7);
  }, 30_000);

  it("deletes an abandoned room after the idle retention period", async () => {
    const host = await createRoom("闲置测试");
    const stub = env.ROOMS.getByName(host.roomCode);

    await runInDurableObject(stub, async (instance) => {
      const roomInstance = instance as unknown as RoomInstanceHarness;
      if (!roomInstance.room) throw new Error("Room instance was missing");
      roomInstance.room.lastActivity = Date.now() - 16 * 60_000;
      await roomInstance.alarm();
      expect(roomInstance.room).toBeNull();
    });

    const response = await joinRoomResponse(host.roomCode, "迟到玩家");
    expect(response.status).toBe(404);
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
    new Request(`https://example.com/ws/${session.roomCode}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": session.playerToken,
      },
    }),
  );
  expect(response.status).toBe(101);
  expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(session.playerToken);
  const socket = response.webSocket;
  if (!socket) throw new Error("WebSocket response did not include a client socket");

  const inbox = new MessageInbox(socket);
  sockets.push(socket);
  socket.accept();
  return { socket, inbox };
}

async function snapshotFrom(
  inbox: MessageInbox,
  predicate: (snapshot: RoomSnapshot) => boolean,
  timeoutMs?: number,
): Promise<RoomSnapshot> {
  const message = await inbox.waitFor(
    (candidate) => candidate.type === "snapshot" && predicate(candidate.snapshot),
    timeoutMs,
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

async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}
