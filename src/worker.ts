import type { Env } from "./env";

export { RoomDO } from "./room-do";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ service: "tetra-colors", status: "ok" });
    }

    if (url.pathname === "/api/hello") {
      const room = env.ROOMS.getByName("phase-zero");
      return room.fetch(new Request("https://room.internal/hello"));
    }

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/")) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
