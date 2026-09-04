import type { Env } from "./env";
import {
  isPlayerToken,
  normalizeNickname,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type ServerErrorCode,
} from "./protocol";
import { FixedWindowRateLimiter } from "./rate-limit";

export { RoomDO } from "./room-do";

const HTTP_BODY_LIMIT = 2_048;
const CREATE_LIMIT_PER_MINUTE = 8;
const JOIN_LIMIT_PER_MINUTE = 30;
const HTTP_RATE_WINDOW_MS = 60_000;
const HTTP_RATE_BUCKET_LIMIT = 1_000;
const httpRateLimiter = new FixedWindowRateLimiter(HTTP_RATE_WINDOW_MS, HTTP_RATE_BUCKET_LIMIT);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json(
        { service: "tetra-colors", status: "ok" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/rooms") {
      if (!consumeHttpLimit(request, "create", CREATE_LIMIT_PER_MINUTE)) {
        return apiError("rate_limited", "创建房间过于频繁，请稍后再试", 429);
      }
      if (!isJsonRequest(request)) {
        return apiError("invalid_message", "请求必须使用 JSON 格式", 415);
      }

      const body = await readSmallJson(request);
      if (!body) {
        return apiError("invalid_message", "请求内容无效", 400);
      }
      const nickname = normalizeNickname(body?.nickname);
      if (!nickname) {
        return apiError("invalid_nickname", "请输入 1–20 个字符的昵称", 400);
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const roomCode = generateRoomCode();
        const room = env.ROOMS.getByName(roomCode);
        const response = await room.fetch(
          new Request("https://room.internal/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nickname, roomCode }),
          }),
        );
        if (response.status !== 409) {
          return response;
        }
      }

      return apiError("internal_error", "暂时无法分配房间码，请重试", 503);
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      if (!consumeHttpLimit(request, "join", JOIN_LIMIT_PER_MINUTE)) {
        return apiError("rate_limited", "加入房间过于频繁，请稍后再试", 429);
      }
      if (!isJsonRequest(request)) {
        return apiError("invalid_message", "请求必须使用 JSON 格式", 415);
      }

      const roomCode = normalizeRoomCode(joinMatch[1]);
      if (!roomCode) {
        return apiError("room_not_found", "房间码无效", 404);
      }

      const body = await readSmallJson(request);
      if (!body) {
        return apiError("invalid_message", "请求内容无效", 400);
      }

      const providedToken = typeof body.playerToken === "string" ? body.playerToken : undefined;
      if (providedToken !== undefined && !isPlayerToken(providedToken)) {
        return apiError("session_expired", "会话凭据无效", 401);
      }
      const nickname = normalizeNickname(body.nickname);
      if (providedToken === undefined && !nickname) {
        return apiError("invalid_nickname", "请输入 1–20 个字符的昵称", 400);
      }

      const room = env.ROOMS.getByName(roomCode);
      return room.fetch(
        new Request("https://room.internal/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            providedToken === undefined ? { nickname } : { nickname, playerToken: providedToken },
          ),
        }),
      );
    }

    const webSocketMatch = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (request.method === "GET" && webSocketMatch) {
      const roomCode = normalizeRoomCode(webSocketMatch[1]);
      const token = request.headers.get("Sec-WebSocket-Protocol")?.trim();
      if (!roomCode || !isPlayerToken(token)) {
        return apiError("session_expired", "会话凭据无效", 401);
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return apiError("invalid_message", "需要 WebSocket 连接", 426);
      }

      const room = env.ROOMS.getByName(roomCode);
      const internalUrl = new URL("https://room.internal/websocket");
      return room.fetch(new Request(internalUrl, request));
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
      return apiError("room_not_found", "接口不存在", 404);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<Env>;

function generateRoomCode(): string {
  const values = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(values);
  return [...values].map((value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join("");
}

async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > HTTP_BODY_LIMIT) {
    return null;
  }

  try {
    if (!request.body) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > HTTP_BODY_LIMIT) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function consumeHttpLimit(request: Request, action: string, limit: number): boolean {
  const address = request.headers.get("CF-Connecting-IP") ?? "local";
  return httpRateLimiter.consume(`${action}:${address}`, limit);
}

function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

function apiError(error: ServerErrorCode, message: string, status: number): Response {
  return Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });
}

function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  secured.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return secured;
}
