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

  it("requires JSON and rejects malformed or oversized request bodies", async () => {
    const plainText = await exports.default.fetch("https://example.com/api/rooms", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.51.100.1",
        "Content-Type": "text/plain",
      },
      body: JSON.stringify({ nickname: "访客" }),
    });
    expect(plainText.status).toBe(415);
    await expect(plainText.json()).resolves.toMatchObject({ error: "invalid_message" });

    const malformed = await exports.default.fetch("https://example.com/api/rooms", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.51.100.2",
        "Content-Type": "application/json",
      },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: "invalid_message" });

    const oversized = await exports.default.fetch("https://example.com/api/rooms", {
      method: "POST",
      headers: {
        "CF-Connecting-IP": "198.51.100.3",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nickname: "x".repeat(3_000) }),
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: "invalid_message" });
  });
});
