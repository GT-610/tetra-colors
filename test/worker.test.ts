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

  it("rejects unknown API routes without falling through to assets", async () => {
    const response = await exports.default.fetch("https://example.com/api/missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "room_not_found" });
  });
});
