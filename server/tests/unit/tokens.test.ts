import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../../src/modules/auth/tokens.js";

const USER_ID = "0190a6b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b";

afterEach(() => {
  vi.useRealTimers();
});

describe("access tokens", () => {
  it("carries the user id and a millisecond issue time, and lasts 15 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T10:00:00.123Z"), toFake: ["Date"] });

    const { token, expiresAt } = await signAccessToken(USER_ID);
    const claims = await verifyAccessToken(token);

    expect(claims).toEqual({ userId: USER_ID, issuedAt: new Date("2026-11-03T10:00:00.123Z") });
    expect(expiresAt).toEqual(new Date("2026-11-03T10:15:00.123Z"));
  });

  it("answers TOKEN_EXPIRED after 15 minutes", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T10:00:00Z"), toFake: ["Date"] });
    const { token } = await signAccessToken(USER_ID);
    vi.setSystemTime(new Date("2026-11-03T10:15:01Z"));

    await expect(verifyAccessToken(token)).rejects.toMatchObject({ status: 401, code: "TOKEN_EXPIRED" });
  });

  it("refuses a tampered token", async () => {
    const { token } = await signAccessToken(USER_ID);
    const [header, , signature] = token.split(".");
    const payload = Buffer.from(JSON.stringify({ sub: "someone-else", iat: Date.now() / 1000 })).toString("base64url");

    await expect(verifyAccessToken(`${header}.${payload}.${signature}`)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("refuses a refresh token", async () => {
    const { token } = await signRefreshToken(USER_ID, "family-1");

    await expect(verifyAccessToken(token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("refresh tokens", () => {
  it("carries the user id and session family and lasts 30 days", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T10:00:00Z"), toFake: ["Date"] });

    const { token, tokenHash, expiresAt } = await signRefreshToken(USER_ID, "family-1");

    expect(await verifyRefreshToken(token)).toEqual({ userId: USER_ID, familyId: "family-1" });
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(expiresAt).toEqual(new Date("2026-12-03T10:00:00Z"));
  });

  it("gives every token a different value, even for the same family", async () => {
    const first = await signRefreshToken(USER_ID, "family-1");
    const second = await signRefreshToken(USER_ID, "family-1");

    expect(first.token).not.toBe(second.token);
  });

  it("refuses an access token and an expired token", async () => {
    const { token: accessToken } = await signAccessToken(USER_ID);
    vi.useFakeTimers({ now: new Date("2026-11-03T10:00:00Z"), toFake: ["Date"] });
    const { token } = await signRefreshToken(USER_ID, "family-1");
    vi.setSystemTime(new Date("2026-12-03T10:00:01Z"));

    await expect(verifyRefreshToken(accessToken)).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    await expect(verifyRefreshToken(token)).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
  });
});
