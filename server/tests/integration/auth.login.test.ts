import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { api, PASSWORD, refreshCookie, registerUser } from "./helpers.js";

const HOUR = 60 * 60 * 1000;

describe("POST /api/auth/login", () => {
  it("logs in with email in any case and records the login time", async () => {
    const user = await registerUser();

    const response = await api()
      .post("/api/auth/login")
      .send({ email: `  ${user.email.toUpperCase()} `, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.id).toBe(user.id);
    expect(refreshCookie(response.headers["set-cookie"])).toMatch(/^unigo_refresh=.+/);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lastLoginAt).not.toBeNull();
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const user = await registerUser();

    const wrongPassword = await api().post("/api/auth/login").send({ email: user.email, password: "wrong1234" });
    const unknownEmail = await api().post("/api/auth/login").send({ email: "nobody@example.com", password: PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(wrongPassword.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses a password login for a Google-only account (no password yet)", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } });

    const response = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it.each([
    ["SUSPENDED", { accountStatus: "SUSPENDED" as const, suspendedUntil: new Date(Date.now() + HOUR) }, "ACCOUNT_SUSPENDED"],
    ["BANNED", { accountStatus: "BANNED" as const }, "ACCOUNT_BANNED"],
  ])("refuses a %s account", async (_status, overrides, code) => {
    const user = await registerUser(overrides);

    const response = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe(code);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("does not reveal the account status to someone with the wrong password", async () => {
    const user = await registerUser({ accountStatus: "BANNED" });

    const response = await api().post("/api/auth/login").send({ email: user.email, password: "wrong1234" });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("lets a RESTRICTED account log in", async () => {
    const user = await registerUser({ accountStatus: "RESTRICTED" });

    const response = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.accountStatus).toBe("RESTRICTED");
  });

  it("treats a suspension whose end date has passed as ACTIVE without changing the stored status", async () => {
    const user = await registerUser({ accountStatus: "SUSPENDED", suspendedUntil: new Date(Date.now() - HOUR) });

    const response = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user.accountStatus).toBe("ACTIVE");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.accountStatus).toBe("SUSPENDED");
  });
});
