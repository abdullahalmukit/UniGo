import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { api, bearer, PASSWORD, refreshCookie, registerUser } from "./helpers.js";

const refresh = (cookie: string) => api().post("/api/auth/refresh").set("Cookie", cookie);
const me = (token: string) => api().get("/api/auth/me").set(bearer(token));

describe("GET /api/auth/me", () => {
  it("returns the caller's own account without secrets", async () => {
    const user = await registerUser();

    const response = await me(user.accessToken);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: user.id, email: user.email });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(response.body.user).not.toHaveProperty("tokensValidAfter");
  });

  it("refuses a missing, malformed or forged token", async () => {
    const user = await registerUser();
    const [header, payload] = user.accessToken.split(".");

    const missing = await api().get("/api/auth/me");
    const malformed = await me("not-a-token");
    const forged = await me(`${header}.${payload}.forged-signature`);

    for (const response of [missing, malformed, forged]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("refuses a refresh token used as an access token", async () => {
    const user = await registerUser();

    const response = await me(user.refreshCookie.split("=")[1]);

    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/refresh", () => {
  it("rotates the refresh token and issues a new access token", async () => {
    const user = await registerUser();

    const response = await refresh(user.refreshCookie);

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
    expect((await me(response.body.accessToken)).status).toBe(200);
    const newCookie = refreshCookie(response.headers["set-cookie"]);
    expect(newCookie).not.toBe(user.refreshCookie);

    const sessions = await prisma.refreshToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0].revokedAt).not.toBeNull();
    expect(sessions[1].revokedAt).toBeNull();
    expect(sessions[1].familyId).toBe(sessions[0].familyId);
  });

  it("treats reuse of a rotated token as theft and ends the whole session family", async () => {
    const user = await registerUser();
    const rotated = await refresh(user.refreshCookie);
    const newCookie = refreshCookie(rotated.headers["set-cookie"]);

    const reuse = await refresh(user.refreshCookie);
    const afterReuse = await refresh(newCookie);

    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("INVALID_REFRESH_TOKEN");
    expect(afterReuse.status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it("does not end other session families when one is reused", async () => {
    const user = await registerUser();
    const otherLogin = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const otherCookie = refreshCookie(otherLogin.headers["set-cookie"]);
    await refresh(user.refreshCookie);

    await refresh(user.refreshCookie);

    expect((await refresh(otherCookie)).status).toBe(200);
  });

  it("lets only one of two simultaneous refreshes with the same token succeed", async () => {
    const user = await registerUser();

    const results = await Promise.all([refresh(user.refreshCookie), refresh(user.refreshCookie)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it("refuses a missing, tampered or expired refresh token and clears the cookie", async () => {
    const user = await registerUser();
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const missing = await api().post("/api/auth/refresh");
    const tampered = await refresh(`${user.refreshCookie}x`);
    const expired = await refresh(user.refreshCookie);

    for (const response of [missing, tampered, expired]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_REFRESH_TOKEN");
    }
    expect(expired.headers["set-cookie"]?.[0]).toMatch(/^unigo_refresh=;.*Expires=Thu, 01 Jan 1970/);
  });

  it("refuses a refresh for a banned account", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { accountStatus: "BANNED" } });

    const response = await refresh(user.refreshCookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ACCOUNT_BANNED");
  });
});

describe("POST /api/auth/logout", () => {
  it("ends this session and clears the cookie", async () => {
    const user = await registerUser();

    const response = await api().post("/api/auth/logout").set("Cookie", user.refreshCookie);

    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"]?.[0]).toMatch(/^unigo_refresh=;.*Path=\/api\/auth/);
    expect((await refresh(user.refreshCookie)).status).toBe(401);
  });

  it("succeeds without a cookie or with an invalid one", async () => {
    expect((await api().post("/api/auth/logout")).status).toBe(204);
    expect((await api().post("/api/auth/logout").set("Cookie", "unigo_refresh=junk")).status).toBe(204);
  });
});

describe("POST /api/auth/logout-all", () => {
  it("ends every session: refresh tokens and existing access tokens stop working", async () => {
    const user = await registerUser();
    const otherLogin = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const otherCookie = refreshCookie(otherLogin.headers["set-cookie"]);

    const response = await api().post("/api/auth/logout-all").set(bearer(user.accessToken));

    expect(response.status).toBe(204);
    expect((await refresh(user.refreshCookie)).status).toBe(401);
    expect((await refresh(otherCookie)).status).toBe(401);
    expect((await me(user.accessToken)).status).toBe(401);
    expect((await me(otherLogin.body.accessToken)).status).toBe(401);
  });

  it("does not block a new login made right afterwards", async () => {
    const user = await registerUser();
    await api().post("/api/auth/logout-all").set(bearer(user.accessToken));

    const login = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });

    expect(login.status).toBe(200);
    expect((await me(login.body.accessToken)).status).toBe(200);
  });

  it("needs an access token", async () => {
    const response = await api().post("/api/auth/logout-all");

    expect(response.status).toBe(401);
  });
});
