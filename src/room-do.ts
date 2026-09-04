import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";

export class RoomDO extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/hello") {
      return Response.json({ message: "房间服务已就绪" });
    }

    return new Response("Not found", { status: 404 });
  }
}
