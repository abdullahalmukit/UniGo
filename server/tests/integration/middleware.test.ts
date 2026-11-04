import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { authenticate } from "../../src/middleware/authenticate.js";
import { requireCanAct, requireRole, requireVerifiedStudent } from "../../src/middleware/authorize.js";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { prisma } from "../../src/lib/prisma.js";
import { bearer, registerUser } from "./helpers.js";

const HOUR = 60 * 60 * 1000;

// A small app that guards one route with each middleware chain.
const testApp = express();
const ok = (_req: express.Request, res: express.Response) => res.json({ ok: true });
testApp.get("/any", authenticate, ok);
testApp.get("/admin", authenticate, requireRole("MODERATOR", "SUPER_ADMIN"), ok);
testApp.get("/super", authenticate, requireRole("SUPER_ADMIN"), ok);
testApp.post("/create", authenticate, requireVerifiedStudent, requireCanAct, ok);
testApp.use(errorHandler);

const call = (method: "get" | "post", path: string, token: string) => request(testApp)[method](path).set(bearer(token));

describe("authenticate", () => {
  it.each([
    ["SUSPENDED", { accountStatus: "SUSPENDED" as const, suspendedUntil: new Date(Date.now() + HOUR) }, "ACCOUNT_SUSPENDED"],
    ["BANNED", { accountStatus: "BANNED" as const }, "ACCOUNT_BANNED"],
  ])("refuses a %s account at once, even with a valid token", async (_status, change, code) => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: change });

    const response = await call("get", "/any", user.accessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(code);
  });

  it("lets a user through once their suspension end date has passed", async () => {
    const user = await registerUser({ accountStatus: "SUSPENDED", suspendedUntil: new Date(Date.now() - HOUR) });

    expect((await call("get", "/any", user.accessToken)).status).toBe(200);
  });

  it("refuses the token of a deleted user", async () => {
    const user = await registerUser();
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.profile.delete({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });

    const response = await call("get", "/any", user.accessToken);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("requireRole", () => {
  it("allows only the listed roles", async () => {
    const student = await registerUser();
    const moderator = await registerUser({ role: "MODERATOR" });
    const superAdmin = await registerUser({ role: "SUPER_ADMIN" });

    expect((await call("get", "/admin", student.accessToken)).body.error.code).toBe("FORBIDDEN");
    expect((await call("get", "/admin", moderator.accessToken)).status).toBe(200);
    expect((await call("get", "/admin", superAdmin.accessToken)).status).toBe(200);
    expect((await call("get", "/super", moderator.accessToken)).status).toBe(403);
    expect((await call("get", "/super", superAdmin.accessToken)).status).toBe(200);
  });

  it("applies a role change at once, without a new token", async () => {
    const user = await registerUser({ role: "MODERATOR" });
    await prisma.user.update({ where: { id: user.id }, data: { role: "USER" } });

    expect((await call("get", "/admin", user.accessToken)).status).toBe(403);
  });
});

describe("requireVerifiedStudent and requireCanAct", () => {
  it.each(["UNVERIFIED", "PENDING", "REJECTED"] as const)("refuses a %s student", async (status) => {
    const user = await registerUser({ studentVerificationStatus: status });

    const response = await call("post", "/create", user.accessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NOT_VERIFIED");
  });

  it("refuses a verified but RESTRICTED account", async () => {
    const user = await registerUser({ studentVerificationStatus: "VERIFIED", accountStatus: "RESTRICTED" });

    const response = await call("post", "/create", user.accessToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ACCOUNT_RESTRICTED");
  });

  it("allows a verified ACTIVE account", async () => {
    const user = await registerUser({ studentVerificationStatus: "VERIFIED" });

    expect((await call("post", "/create", user.accessToken)).status).toBe(200);
  });
});
