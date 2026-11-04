import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: { $queryRaw: queryRaw },
}));

const { app } = await import("../../src/app.js");

describe("GET /api/health", () => {
  beforeEach(() => {
    queryRaw.mockReset();
  });

  it("returns 200 when the database answers", async () => {
    queryRaw.mockResolvedValue([{ 1: 1 }]);

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", database: "up" });
    expect(typeof response.body.uptime).toBe("number");
    expect(typeof response.body.timestamp).toBe("string");
  });

  it("returns 503 when the database is unreachable", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "degraded", database: "down" });
  });

  it("returns 503 within the connect timeout when the database never answers", async () => {
    queryRaw.mockReturnValue(new Promise(() => {}));

    const startedAt = Date.now();
    const response = await request(app).get("/api/health");
    const elapsed = Date.now() - startedAt;

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "degraded", database: "down" });
    // DATABASE_CONNECT_TIMEOUT_MS is 200 in vitest.config.ts
    expect(elapsed).toBeGreaterThanOrEqual(190);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("unknown routes", () => {
  it("return the standard error shape", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "No route for GET /api/does-not-exist" },
    });
  });

  it("reject invalid JSON with the standard error shape", async () => {
    const response = await request(app)
      .post("/api/health")
      .set("Content-Type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });
});
