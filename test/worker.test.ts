import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("worker", () => {
  it("reports a healthy service", async () => {
    const response = await exports.default.fetch("https://example.com/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "tetra-colors",
      status: "ok",
    });
  });

  it("can reach the room Durable Object", async () => {
    const response = await exports.default.fetch("https://example.com/api/hello");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ message: "房间服务已就绪" });
  });
});
