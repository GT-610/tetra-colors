import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import type { BotDifficulty, GameAction, GameEvent, GameState } from "./logic";
import { applyGameAction, chooseBotAction, getPlayableCards, startGame } from "./logic";
import {
  isPlayerToken,
  normalizeNickname,
  type PublicPlayer,
  parseClientMessage,
  type RoomEvent,
  type RoomSessionResponse,
  type RoomSnapshot,
  type ServerErrorCode,
  type ServerMessage,
} from "./protocol";
import { botDelayMs } from "./room-timing";
import { buildTransitionTimeline, initialDealDurationMs } from "./transition-timing";

const ROOM_STORAGE_KEY = "room";
const MAX_PLAYERS = 6;
const MAX_MESSAGE_BYTES = 8_192;
const ACTIONS_PER_SECOND = 15;
const RECONNECT_GRACE_MS = 30_000;
const TURN_DURATION_MS = 30_000;
const IDLE_ROOM_TTL_MS = 15 * 60_000;

interface RoomPlayer {
  id: string;
  nickname: string;
  kind: "human" | "bot";
  difficulty: BotDifficulty | null;
  tokenHash: string | null;
  connected: boolean;
  controlledByBot: boolean;
  disconnectedAt: number | null;
}

interface RoomData {
  code: string;
  phase: "lobby" | "playing" | "finished";
  hostId: string;
  players: RoomPlayer[];
  game: GameState | null;
  lastActivity: number;
  turnDeadline: number | null;
  scheduledBotAt: number | null;
  actionBlockedUntil: number | null;
}

interface SocketAttachment {
  playerId: string;
}

interface RateBucket {
  startedAt: number;
  count: number;
}

export class RoomDO extends DurableObject<Env> {
  private room: RoomData | null = null;
  private readonly ready: Promise<void>;
  private readonly rateBuckets = new Map<string, RateBucket>();
  private fastBotTarget: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get<RoomData>(ROOM_STORAGE_KEY)) ?? null;
      if (this.room) {
        this.room.actionBlockedUntil ??= null;
        if (this.room.game) this.room.game.skippedPlayerId ??= null;
      }
      this.reconcileConnections();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/create") {
      return this.createRoom(request);
    }

    if (request.method === "POST" && url.pathname === "/join") {
      return this.joinRoom(request);
    }

    if (request.method === "GET" && url.pathname === "/websocket") {
      return this.openWebSocket(request);
    }

    return jsonError("room_not_found", "房间不存在", 404);
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const attachment = readAttachment(socket);
    if (!attachment || !this.room) {
      socket.close(4401, "Session unavailable");
      return;
    }

    const size = typeof message === "string" ? new TextEncoder().encode(message).byteLength : 0;
    if (typeof message !== "string" || size > MAX_MESSAGE_BYTES) {
      this.sendError(socket, "invalid_message", "消息格式无效");
      return;
    }

    if (!this.consumeAction(attachment.playerId)) {
      this.sendError(socket, "rate_limited", "操作过于频繁，请稍后再试");
      return;
    }

    let input: unknown;
    try {
      input = JSON.parse(message);
    } catch {
      this.sendError(socket, "invalid_message", "消息不是有效的 JSON");
      return;
    }

    const parsed = parseClientMessage(input);
    if (!parsed) {
      this.sendError(socket, "invalid_message", "消息内容无效");
      return;
    }

    if (parsed.type === "heartbeat") {
      return;
    }

    this.room.lastActivity = Date.now();

    if (parsed.type === "lobby.add-bot") {
      await this.addBot(socket, attachment.playerId, parsed.difficulty);
      return;
    }
    if (parsed.type === "lobby.remove-bot") {
      await this.removeBot(socket, attachment.playerId, parsed.playerId);
      return;
    }
    if (parsed.type === "lobby.start" || parsed.type === "game.rematch") {
      await this.startRound(socket, attachment.playerId);
      return;
    }
    if (parsed.type === "room.leave") {
      await this.leaveRoom(socket, attachment.playerId);
      return;
    }

    const action: GameAction =
      parsed.type === "game.play-card"
        ? parsed.chosenColor === undefined
          ? { type: "play-card", cardId: parsed.cardId }
          : { type: "play-card", cardId: parsed.cardId, chosenColor: parsed.chosenColor }
        : parsed.type === "game.draw-card"
          ? { type: "draw-card" }
          : { type: "pass-turn" };
    await this.applyPlayerAction(socket, attachment.playerId, action);
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    await this.markDisconnected(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.ready;
    await this.markDisconnected(socket);
  }

  override async alarm(): Promise<void> {
    await this.ready;
    if (!this.room) {
      return;
    }

    const now = Date.now();
    const events: RoomEvent[] = [];

    await this.expireDisconnectedPlayers(now, events);
    if (!this.room) {
      return;
    }

    if (!this.hasConnectedHuman() && now - this.room.lastActivity >= IDLE_ROOM_TTL_MS) {
      await this.destroyRoom();
      return;
    }

    if (this.room.phase === "playing" && this.room.game) {
      if (this.room.scheduledBotAt !== null && this.room.scheduledBotAt <= now) {
        events.push(...this.runBotTurn());
      } else if (this.room.turnDeadline !== null && this.room.turnDeadline <= now) {
        events.push(...this.runTimedOutTurn());
      }
    }

    await this.persistAndBroadcast(events);
  }

  private async createRoom(request: Request): Promise<Response> {
    if (this.room) {
      return jsonError("invalid_phase", "房间码已被使用", 409);
    }

    const body = await readJson(request);
    const nickname = normalizeNickname(body?.nickname);
    const roomCode = typeof body?.roomCode === "string" ? body.roomCode : null;
    if (!nickname || !roomCode) {
      return jsonError("invalid_nickname", "昵称或房间码无效", 400);
    }

    const session = await createHumanPlayer(nickname);
    const now = Date.now();
    this.room = {
      code: roomCode,
      phase: "lobby",
      hostId: session.player.id,
      players: [session.player],
      game: null,
      lastActivity: now,
      turnDeadline: null,
      scheduledBotAt: null,
      actionBlockedUntil: null,
    };
    await this.persist();

    return Response.json(toSessionResponse(roomCode, session.player.id, session.rawToken), {
      status: 201,
      headers: noStoreHeaders(),
    });
  }

  private async joinRoom(request: Request): Promise<Response> {
    if (!this.room) {
      return jsonError("room_not_found", "房间不存在", 404);
    }

    const body = await readJson(request);
    const nickname = normalizeNickname(body?.nickname);
    const providedToken = body?.playerToken;

    if (providedToken !== undefined) {
      if (!isPlayerToken(providedToken)) {
        return jsonError("session_expired", "原会话已失效", 401);
      }
      const tokenHash = await hashToken(providedToken);
      const existing = this.room.players.find(
        (player) => player.kind === "human" && player.tokenHash === tokenHash,
      );
      if (!existing) {
        return jsonError("session_expired", "原会话已失效", 401);
      }

      return Response.json(toSessionResponse(this.room.code, existing.id, providedToken), {
        headers: noStoreHeaders(),
      });
    }

    if (!nickname) {
      return jsonError("invalid_nickname", "昵称无效", 400);
    }
    if (this.room.phase !== "lobby") {
      return jsonError("invalid_phase", "对局已经开始", 409);
    }
    if (this.room.players.length >= MAX_PLAYERS) {
      return jsonError("room_full", "房间已满", 409);
    }

    const session = await createHumanPlayer(nickname);
    this.room.players.push(session.player);
    this.room.lastActivity = Date.now();
    await this.persistAndBroadcast([]);

    return Response.json(toSessionResponse(this.room.code, session.player.id, session.rawToken), {
      status: 201,
      headers: noStoreHeaders(),
    });
  }

  private async openWebSocket(request: Request): Promise<Response> {
    if (!this.room) {
      return jsonError("room_not_found", "房间不存在", 404);
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return jsonError("invalid_message", "需要 WebSocket 连接", 426);
    }

    const rawToken = request.headers.get("Sec-WebSocket-Protocol")?.trim();
    if (!isPlayerToken(rawToken)) {
      return jsonError("session_expired", "缺少会话凭据", 401);
    }

    const tokenHash = await hashToken(rawToken);
    const player = this.room.players.find(
      (candidate) => candidate.kind === "human" && candidate.tokenHash === tokenHash,
    );
    if (!player) {
      return jsonError("session_expired", "会话凭据无效", 401);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    if (!client || !server) {
      return jsonError("internal_error", "无法建立连接", 500);
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: player.id } satisfies SocketAttachment);
    for (const existing of this.socketsForPlayer(player.id, server)) {
      existing.close(4001, "Replaced by a newer connection");
    }

    const wasAway = !player.connected || player.controlledByBot;
    player.connected = true;
    player.controlledByBot = false;
    player.disconnectedAt = null;
    this.room.lastActivity = Date.now();
    await this.persistAndBroadcast(
      wasAway ? [{ type: "player-reconnected", playerId: player.id }] : [],
    );

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": rawToken },
    });
  }

  private async addBot(
    socket: WebSocket,
    playerId: string,
    difficulty: BotDifficulty,
  ): Promise<void> {
    if (!this.requireHost(socket, playerId) || !this.room) return;
    if (this.room.phase !== "lobby") {
      this.sendError(socket, "invalid_phase", "只能在大厅添加电脑玩家");
      return;
    }
    if (this.room.players.length >= MAX_PLAYERS) {
      this.sendError(socket, "room_full", "房间已满");
      return;
    }

    const botNumber = this.room.players.filter((player) => player.kind === "bot").length + 1;
    const bot: RoomPlayer = {
      id: `bot-${crypto.randomUUID()}`,
      nickname: `电脑玩家 ${botNumber}`,
      kind: "bot",
      difficulty,
      tokenHash: null,
      connected: true,
      controlledByBot: true,
      disconnectedAt: null,
    };
    this.room.players.push(bot);
    await this.persistAndBroadcast([]);
  }

  private async removeBot(socket: WebSocket, playerId: string, botId: string): Promise<void> {
    if (!this.requireHost(socket, playerId) || !this.room) return;
    if (this.room.phase !== "lobby") {
      this.sendError(socket, "invalid_phase", "只能在大厅移除电脑玩家");
      return;
    }

    const bot = this.room.players.find((player) => player.id === botId && player.kind === "bot");
    if (!bot) {
      this.sendError(socket, "invalid_action", "电脑玩家不存在");
      return;
    }

    this.room.players = this.room.players.filter((player) => player.id !== botId);
    await this.persistAndBroadcast([]);
  }

  private async startRound(socket: WebSocket, playerId: string): Promise<void> {
    if (!this.requireHost(socket, playerId) || !this.room) return;
    if (this.room.phase !== "lobby" && this.room.phase !== "finished") {
      this.sendError(socket, "invalid_phase", "当前不能开始新一局");
      return;
    }
    if (this.room.players.length < 2) {
      this.sendError(socket, "invalid_action", "至少需要两位玩家");
      return;
    }

    for (const player of this.room.players) {
      if (player.kind === "human" && !player.connected) {
        player.controlledByBot = true;
        player.difficulty = "medium";
      }
    }

    this.room.game = startGame(
      this.room.players.map((player) => player.id),
      runtimeRandom,
    );
    this.room.phase = "playing";
    const now = Date.now();
    const initialDealDuration = initialDealDurationMs(
      this.room.game.players.reduce((sum, player) => sum + player.hand.length, 0),
    );
    this.room.actionBlockedUntil = now + initialDealDuration;
    this.room.turnDeadline = now + initialDealDuration + TURN_DURATION_MS;
    this.scheduleBotIfNeeded();
    await this.persistAndBroadcast([]);
  }

  private async applyPlayerAction(
    socket: WebSocket,
    playerId: string,
    action: GameAction,
  ): Promise<void> {
    if (this.room?.phase !== "playing" || !this.room.game) {
      this.sendError(socket, "invalid_phase", "对局尚未开始");
      return;
    }

    const player = this.room.players.find((candidate) => candidate.id === playerId);
    if (!player || player.controlledByBot) {
      this.sendError(socket, "invalid_action", "当前座位由电脑托管");
      return;
    }
    if (this.room.actionBlockedUntil !== null && this.room.actionBlockedUntil > Date.now()) {
      this.sendError(socket, "invalid_action", "请等待当前动画结束");
      return;
    }

    const result = applyGameAction(this.room.game, playerId, action, runtimeRandom);
    if (!result.ok) {
      this.sendError(socket, "invalid_action", gameErrorMessage(result.error));
      return;
    }

    this.room.game = result.state;
    this.syncGamePhase();
    this.updateTurnSchedule(result.events);
    await this.persistAndBroadcast(toRoomEvents(result.events));
  }

  private async leaveRoom(socket: WebSocket, playerId: string): Promise<void> {
    if (!this.room) return;
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    if (player?.kind !== "human") return;

    const isLastHuman = !this.room.players.some(
      (candidate) =>
        candidate.id !== playerId && candidate.kind === "human" && !candidate.controlledByBot,
    );
    if (isLastHuman) {
      socket.close(1000, "Left room");
      await this.destroyRoom();
      return;
    }

    if (this.room.phase === "lobby") {
      this.room.players = this.room.players.filter((candidate) => candidate.id !== playerId);
      this.reassignHost();
      await this.persistAndBroadcast([]);
    } else {
      player.connected = false;
      player.controlledByBot = true;
      player.difficulty = "medium";
      player.disconnectedAt = null;
      this.reassignHost();
      this.scheduleBotIfNeeded();
      await this.persistAndBroadcast([{ type: "player-became-bot", playerId }]);
    }

    socket.close(1000, "Left room");
  }

  private runBotTurn(): RoomEvent[] {
    if (!this.room?.game || this.room.phase !== "playing") return [];
    const gamePlayer = this.room.game.players[this.room.game.turnIndex];
    const roomPlayer = this.room.players.find((player) => player.id === gamePlayer?.id);
    if (!gamePlayer || !roomPlayer || !isBotControlled(roomPlayer)) {
      this.room.scheduledBotAt = null;
      return [];
    }

    const action = chooseBotAction(
      this.room.game,
      gamePlayer.id,
      roomPlayer.difficulty ?? "medium",
      runtimeRandom,
    );
    const result = applyGameAction(this.room.game, gamePlayer.id, action, runtimeRandom);
    if (!result.ok) {
      this.room.scheduledBotAt = Date.now() + 1_000;
      return [];
    }

    this.room.game = result.state;
    this.syncGamePhase();
    this.updateTurnSchedule(result.events);
    return toRoomEvents(result.events);
  }

  private runTimedOutTurn(): RoomEvent[] {
    if (!this.room?.game || this.room.phase !== "playing") return [];
    const gamePlayer = this.room.game.players[this.room.game.turnIndex];
    if (!gamePlayer) return [];

    const roomEvents: RoomEvent[] = [{ type: "turn-timed-out", playerId: gamePlayer.id }];
    const action: GameAction = this.room.game.drawnCardId
      ? { type: "pass-turn" }
      : { type: "draw-card" };
    const first = applyGameAction(this.room.game, gamePlayer.id, action, runtimeRandom);
    if (!first.ok) {
      this.room.turnDeadline = Date.now() + TURN_DURATION_MS;
      return roomEvents;
    }

    this.room.game = first.state;
    const gameEvents = [...first.events];
    if (this.room.game.phase === "playing" && this.room.game.drawnCardId) {
      const passed = applyGameAction(
        this.room.game,
        gamePlayer.id,
        { type: "pass-turn" },
        runtimeRandom,
      );
      if (passed.ok) {
        this.room.game = passed.state;
        gameEvents.push(...passed.events);
      }
    }

    this.syncGamePhase();
    this.updateTurnSchedule(gameEvents);
    roomEvents.push(...toRoomEvents(gameEvents));
    return roomEvents;
  }

  private async expireDisconnectedPlayers(now: number, events: RoomEvent[]): Promise<void> {
    if (!this.room) return;
    const expired = this.room.players.filter(
      (player) =>
        player.kind === "human" &&
        !player.connected &&
        player.disconnectedAt !== null &&
        player.disconnectedAt + RECONNECT_GRACE_MS <= now,
    );
    if (expired.length === 0) return;

    for (const player of expired) {
      if (this.room.phase === "lobby") {
        this.room.players = this.room.players.filter((candidate) => candidate.id !== player.id);
      } else {
        player.controlledByBot = true;
        player.difficulty = "medium";
        player.disconnectedAt = null;
        events.push({ type: "player-became-bot", playerId: player.id });
      }
    }

    this.reassignHost();
    if (this.room.players.length === 0) {
      await this.destroyRoom();
      return;
    }
    this.scheduleBotIfNeeded();
  }

  private async markDisconnected(socket: WebSocket): Promise<void> {
    if (!this.room) return;
    const attachment = readAttachment(socket);
    if (!attachment || this.socketsForPlayer(attachment.playerId, socket).length > 0) {
      return;
    }

    const player = this.room.players.find((candidate) => candidate.id === attachment.playerId);
    if (player?.kind !== "human" || !player.connected) {
      return;
    }

    const disconnectedAt = Date.now();
    player.connected = false;
    player.disconnectedAt = disconnectedAt;
    this.room.lastActivity = disconnectedAt;
    await this.persistAndBroadcast([]);
  }

  private reconcileConnections(): void {
    if (!this.room) return;
    const connected = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readAttachment(socket);
      if (attachment) connected.add(attachment.playerId);
    }

    for (const player of this.room.players) {
      if (player.kind === "human") {
        player.connected = connected.has(player.id);
      }
    }
  }

  private syncGamePhase(): void {
    if (!this.room?.game) return;
    if (this.room.game.phase === "finished") {
      this.room.phase = "finished";
      this.room.turnDeadline = null;
      this.room.scheduledBotAt = null;
      this.room.actionBlockedUntil = null;
    }
  }

  private updateTurnSchedule(events: readonly GameEvent[]): void {
    if (!this.room?.game || this.room.phase !== "playing") return;
    const transitionDuration = buildTransitionTimeline(events).durationMs;
    const now = Date.now();
    this.room.actionBlockedUntil = transitionDuration > 0 ? now + transitionDuration : null;
    if (events.some((event) => event.type === "turn-started")) {
      this.room.turnDeadline = now + transitionDuration + TURN_DURATION_MS;
    } else if (this.room.turnDeadline !== null) {
      this.room.turnDeadline += transitionDuration;
    }
    this.scheduleBotIfNeeded();
  }

  private scheduleBotIfNeeded(): void {
    if (!this.room?.game || this.room.phase !== "playing") {
      if (this.room) this.room.scheduledBotAt = null;
      return;
    }
    const gamePlayer = this.room.game.players[this.room.game.turnIndex];
    const roomPlayer = this.room.players.find((player) => player.id === gamePlayer?.id);
    const scheduleFrom = Math.max(Date.now(), this.room.actionBlockedUntil ?? 0);
    this.room.scheduledBotAt =
      roomPlayer && isBotControlled(roomPlayer) ? scheduleFrom + botDelayMs(runtimeRandom) : null;
  }

  private requireHost(socket: WebSocket, playerId: string): boolean {
    if (!this.room || this.room.hostId !== playerId) {
      this.sendError(socket, "not_host", "只有房主可以执行此操作");
      return false;
    }
    return true;
  }

  private reassignHost(): void {
    if (!this.room) return;
    const currentHost = this.room.players.find((player) => player.id === this.room?.hostId);
    if (currentHost && !isBotControlled(currentHost)) return;

    const connectedHuman = this.room.players.find(
      (player) => player.kind === "human" && player.connected && !player.controlledByBot,
    );
    this.room.hostId = connectedHuman?.id ?? currentHost?.id ?? this.room.players[0]?.id ?? "";
  }

  private consumeAction(playerId: string): boolean {
    const now = Date.now();
    const bucket = this.rateBuckets.get(playerId);
    if (!bucket || now - bucket.startedAt >= 1_000) {
      this.rateBuckets.set(playerId, { startedAt: now, count: 1 });
      return true;
    }

    bucket.count += 1;
    return bucket.count <= ACTIONS_PER_SECOND;
  }

  private async persistAndBroadcast(events: readonly RoomEvent[]): Promise<void> {
    await this.persist();
    for (const event of events) {
      this.broadcast({ type: "event", event });
    }
    this.broadcastSnapshots();
    this.scheduleFastBotWakeup();
  }

  private scheduleFastBotWakeup(): void {
    const target = this.room?.scheduledBotAt ?? null;
    if (target === null || !this.hasConnectedHuman() || this.fastBotTarget === target) {
      return;
    }

    this.fastBotTarget = target;
    this.ctx.waitUntil(this.runFastBotWakeup(target));
  }

  private async runFastBotWakeup(target: number): Promise<void> {
    try {
      await scheduler.wait(Math.max(0, target - Date.now()));
      await this.ready;
      if (
        this.room?.phase !== "playing" ||
        this.room.scheduledBotAt !== target ||
        !this.hasConnectedHuman()
      ) {
        return;
      }

      this.fastBotTarget = null;
      const events = this.runBotTurn();
      await this.persistAndBroadcast(events);
    } finally {
      if (this.fastBotTarget === target) {
        this.fastBotTarget = null;
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.room) return;
    await this.ctx.storage.put(ROOM_STORAGE_KEY, this.room);
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (!this.room) return;
    const times: number[] = [];
    if (this.room.turnDeadline !== null && this.room.phase === "playing") {
      times.push(this.room.turnDeadline);
    }
    if (this.room.scheduledBotAt !== null && this.room.phase === "playing") {
      times.push(this.room.scheduledBotAt);
    }
    for (const player of this.room.players) {
      if (player.disconnectedAt !== null) {
        times.push(player.disconnectedAt + RECONNECT_GRACE_MS);
      }
    }
    if (!this.hasConnectedHuman()) {
      times.push(this.room.lastActivity + IDLE_ROOM_TTL_MS);
    }

    if (times.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 10, Math.min(...times)));
  }

  private async destroyRoom(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1001, "Room expired");
    }
    this.room = null;
    await this.ctx.storage.deleteAll();
  }

  private hasConnectedHuman(): boolean {
    return (
      this.room?.players.some((player) => player.kind === "human" && player.connected) ?? false
    );
  }

  private socketsForPlayer(playerId: string, excluded?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((socket) => {
      if (socket === excluded) return false;
      return readAttachment(socket)?.playerId === playerId;
    });
  }

  private broadcastSnapshots(): void {
    if (!this.room) return;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readAttachment(socket);
      if (attachment) this.sendSnapshot(socket, attachment.playerId);
    }
  }

  private sendSnapshot(socket: WebSocket, playerId: string): void {
    if (!this.room) return;
    this.send(socketMessage({ type: "snapshot", snapshot: this.createSnapshot(playerId) }), socket);
  }

  private createSnapshot(playerId: string): RoomSnapshot {
    if (!this.room) {
      throw new Error("Cannot create a snapshot for a missing room");
    }

    const game = this.room.game;
    const selfHand = game?.players.find((player) => player.id === playerId)?.hand ?? [];
    const publicPlayers: PublicPlayer[] = this.room.players.map((player) => ({
      id: player.id,
      nickname: player.nickname,
      isBot: isBotControlled(player),
      difficulty: isBotControlled(player) ? (player.difficulty ?? "medium") : null,
      connected: player.kind === "bot" || player.connected,
      handCount: game?.players.find((gamePlayer) => gamePlayer.id === player.id)?.hand.length ?? 0,
    }));

    const currentPlayer = game?.players[game.turnIndex];
    const topDiscard = game?.discardPile.at(-1);
    return {
      roomCode: this.room.code,
      phase: this.room.phase,
      selfId: playerId,
      hostId: this.room.hostId,
      players: publicPlayers,
      hand: selfHand,
      game:
        game && currentPlayer && topDiscard
          ? {
              topDiscard,
              currentColor: game.currentColor,
              currentPlayerId: currentPlayer.id,
              direction: game.direction,
              drawPileCount: game.drawPile.length,
              turnNumber: game.turnNumber,
              turnDeadline: this.room.turnDeadline ?? 0,
              actionBlockedUntil: this.room.actionBlockedUntil ?? 0,
              playableCardIds:
                currentPlayer.id === playerId
                  ? getPlayableCards(game, playerId).map((card) => card.id)
                  : [],
              drawnCardId: currentPlayer.id === playerId ? game.drawnCardId : null,
              skippedPlayerId: game.skippedPlayerId,
              winnerId: game.winnerId,
            }
          : null,
    };
  }

  private broadcast(message: ServerMessage): void {
    const encoded = socketMessage(message);
    for (const socket of this.ctx.getWebSockets()) {
      this.send(encoded, socket);
    }
  }

  private sendError(socket: WebSocket, code: ServerErrorCode, message: string): void {
    this.send(socketMessage({ type: "error", code, message }), socket);
  }

  private send(message: string, socket: WebSocket): void {
    try {
      socket.send(message);
    } catch {
      // A close event will reconcile the seat if this socket is no longer healthy.
    }
  }
}

function isBotControlled(player: RoomPlayer): boolean {
  return player.kind === "bot" || player.controlledByBot;
}

function runtimeRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) / 4_294_967_296;
}

async function createHumanPlayer(
  nickname: string,
): Promise<{ player: RoomPlayer; rawToken: string }> {
  const rawToken = randomToken();
  return {
    rawToken,
    player: {
      id: `player-${crypto.randomUUID()}`,
      nickname,
      kind: "human",
      difficulty: null,
      tokenHash: await hashToken(rawToken),
      connected: false,
      controlledByBot: false,
      disconnectedAt: Date.now(),
    },
  };
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readAttachment(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (
    typeof value === "object" &&
    value !== null &&
    "playerId" in value &&
    typeof value.playerId === "string"
  ) {
    return { playerId: value.playerId };
  }
  return null;
}

function toSessionResponse(
  roomCode: string,
  playerId: string,
  playerToken: string,
): RoomSessionResponse {
  return { roomCode, playerId, playerToken };
}

function toRoomEvents(events: readonly GameEvent[]): RoomEvent[] {
  const mapped: RoomEvent[] = [];
  for (const event of events) {
    if (event.type === "card-played") {
      mapped.push({
        type: "card-played",
        playerId: event.playerId,
        card: event.card,
      });
    } else if (event.type === "cards-drawn") {
      mapped.push({ type: "cards-drawn", playerId: event.playerId, count: event.count });
    } else if (event.type === "player-skipped" || event.type === "player-unskipped") {
      mapped.push({ type: event.type, playerId: event.playerId });
    }
  }
  return mapped;
}

function gameErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    game_finished: "本局已经结束",
    not_your_turn: "还没轮到你",
    card_not_found: "手牌中没有这张牌",
    card_not_playable: "这张牌当前不能打出",
    color_required: "请先选择颜色",
    color_not_allowed: "选择的颜色无效",
    already_drew: "本回合已经抽过牌",
    must_play_drawn_card: "抽牌后只能打出刚抽到的牌",
    draw_required: "请先抽牌",
  };
  return messages[error] ?? "操作无效";
}

function socketMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function jsonError(code: ServerErrorCode, message: string, status: number): Response {
  return Response.json(
    { error: code, message },
    {
      status,
      headers: noStoreHeaders(),
    },
  );
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
