import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import type { SessionManager } from "./session";

function fakeManager(tokens: string[]) {
  let current = tokens[0];
  return {
    getAccessToken: vi.fn(async () => current),
    refresh: vi.fn(async () => {
      current = tokens[1];
      return current ? { accessToken: current } : null;
    }),
  } as unknown as SessionManager & { refresh: ReturnType<typeof vi.fn> };
}

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("sends the access token and cookies, and returns the JSON body", async () => {
    const fetch = vi.fn(async () => respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);

    const result = await api("/auth/me", {}, fakeManager(["token-1"]));

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
      }),
    );
  });

  it("refreshes once and retries once when the token is rejected", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(respond(401, { error: { code: "TOKEN_EXPIRED", message: "Expired" } }))
      .mockResolvedValueOnce(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    const manager = fakeManager(["old", "new"]);

    await api("/auth/me", {}, manager);

    expect(manager.refresh).toHaveBeenCalledWith("old");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new");
  });

  it("does not loop: a second 401 after the retry is returned as an error", async () => {
    const fetch = vi.fn(async () => respond(401, { error: { code: "UNAUTHENTICATED", message: "No" } }));
    vi.stubGlobal("fetch", fetch);
    const manager = fakeManager(["old", "new"]);

    await expect(api("/auth/me", {}, manager)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(manager.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the server's error code, field errors and extra values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(409, { error: { code: "GOOGLE_LINK_REQUIRES_PASSWORD", message: "Enter your password", linkToken: "abc" } }),
      ),
    );

    const error = await api("/auth/google", { method: "POST", body: {}, auth: false }, fakeManager([])).catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "GOOGLE_LINK_REQUIRES_PASSWORD", data: { linkToken: "abc" } });
  });
});
