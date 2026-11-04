import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager, type ChannelLike, type LockLike, type StorageLike } from "./session";

// --- Fakes for the browser APIs that tabs share --------------------------------

// One Web Lock for the whole "browser": callbacks run strictly one after another.
class FakeLocks implements LockLike {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, callback: () => Promise<T>) {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => {});
    return run;
  }
}

// A BroadcastChannel bus: messages reach every other tab after `delayMs`.
class FakeBus {
  private handlers = new Map<number, (message: never) => void>();
  private next = 0;
  delayMs = 0;

  channel(): ChannelLike {
    const id = this.next++;
    return {
      post: (message) => {
        for (const [other, handler] of this.handlers) {
          if (other !== id) setTimeout(() => handler(structuredClone(message) as never), this.delayMs);
        }
      },
      onMessage: (handler) => this.handlers.set(id, handler as (message: never) => void),
    };
  }
}

class FakeStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => void this.values.set(key, value);
}

// A server whose refresh endpoint hands out a new 15-minute token each call.
function fakeServer() {
  let issued = 0;
  const refreshCalls: number[] = [];
  let refreshWorks = true;

  const fetch = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/auth/refresh")) {
      refreshCalls.push(Date.now());
      if (!refreshWorks) return new Response(JSON.stringify({ error: { code: "INVALID_REFRESH_TOKEN" } }), { status: 401 });
      issued += 1;
      // Let the request take a moment, as a real one would.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json(sessionBody(`token-${issued}`));
    }
    if (path.endsWith("/auth/logout")) return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });

  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    refreshCalls,
    breakRefresh: () => {
      refreshWorks = false;
    },
  };
}

function sessionBody(name: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({ sub: "user-1", iat: now, exp: now + 15 * 60, name }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return {
    user: { id: "user-1", language: "EN", theme: "SYSTEM" },
    accessToken: `header.${payload}.signature`,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

const tokenName = (token: string | null | undefined) =>
  token ? JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).name : null;

// Several tabs of one browser: shared lock, channel bus, storage and server.
function browser({ broadcastDelayMs = 0 } = {}) {
  const locks = new FakeLocks();
  const bus = new FakeBus();
  bus.delayMs = broadcastDelayMs;
  const storage = new FakeStorage();
  const server = fakeServer();

  const openTab = () =>
    new SessionManager({
      apiBaseUrl: "/api",
      fetch: server.fetch,
      locks,
      channel: bus.channel(),
      storage,
      timing: { shareWaitMs: 50, broadcastWaitMs: 300 },
    });

  return { openTab, server, bus };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// -------------------------------------------------------------------------------

describe("session start", () => {
  it("refreshes when no other tab is open", async () => {
    const { openTab, server } = browser();
    const tab = openTab();

    await tab.start();

    expect(tab.getState().status).toBe("authenticated");
    expect(server.refreshCalls).toHaveLength(1);
  });

  it("borrows the session from an open tab instead of refreshing", async () => {
    const { openTab, server } = browser();
    const first = openTab();
    await first.start();

    const second = openTab();
    await second.start();

    expect(server.refreshCalls).toHaveLength(1);
    expect(second.getState()).toEqual(first.getState());
  });

  it("becomes a guest when the refresh cookie is no longer valid", async () => {
    const { openTab, server } = browser();
    server.breakRefresh();
    const tab = openTab();

    await tab.start();

    expect(tab.getState().status).toBe("guest");
  });
});

describe("refresh across tabs", () => {
  it("sends ONE refresh when two tabs need one at the same time, and both use the new token", async () => {
    const { openTab, server } = browser();
    const a = openTab();
    await a.start();
    const b = openTab();
    await b.start();
    const oldToken = await a.getAccessToken();
    expect(await b.getAccessToken()).toBe(oldToken);

    // Both tabs get a 401 for the same old token at once.
    const [fromA, fromB] = await Promise.all([a.refresh(oldToken!), b.refresh(oldToken!)]);

    expect(server.refreshCalls).toHaveLength(2); // the start, plus exactly one now
    expect(fromA?.accessToken).toBe(fromB?.accessToken);
    expect(tokenName(fromA?.accessToken)).toBe("token-2");
    expect(await a.getAccessToken()).toBe(await b.getAccessToken());
  });

  it("shares one refresh between callers inside one tab", async () => {
    const { openTab, server } = browser();
    const tab = openTab();
    await tab.start();
    const token = await tab.getAccessToken();

    await Promise.all([tab.refresh(token!), tab.refresh(token!), tab.refresh(token!)]);

    expect(server.refreshCalls).toHaveLength(2);
  });

  it("waits for a late message instead of refreshing again", async () => {
    const { openTab, server, bus } = browser();
    const a = openTab();
    await a.start();
    const b = openTab();
    await b.start();
    const oldToken = await a.getAccessToken();
    // From now on messages take 100 ms, longer than the refresh itself, so the
    // waiting tab gets the lock before the new token has reached it.
    bus.delayMs = 100;

    const [fromA, fromB] = await Promise.all([a.refresh(oldToken!), b.refresh(oldToken!)]);

    expect(server.refreshCalls).toHaveLength(2);
    expect(fromB?.accessToken).toBe(fromA?.accessToken);
  });

  it("refreshes itself, one after the other, if the message never arrives", async () => {
    // Messages are lost (longer than broadcastWaitMs): the second tab refreshes
    // after the first, never at the same time, so the server sees a normal rotation.
    const { openTab, server } = browser({ broadcastDelayMs: 10_000 });
    const a = openTab();
    const b = openTab();
    await Promise.all([a.start(), b.start()]);

    expect(server.refreshCalls).toHaveLength(2);
    expect(server.refreshCalls[1] - server.refreshCalls[0]).toBeGreaterThanOrEqual(20);
  });

  it("refreshes before the token expires", async () => {
    const { openTab, server } = browser();
    const tab = openTab();
    await tab.start();
    const first = await tab.getAccessToken();

    vi.advanceTimersByTime(14 * 60 * 1000 + 31 * 1000); // inside the 30-second margin
    const second = await tab.getAccessToken();

    expect(second).not.toBe(first);
    expect(server.refreshCalls).toHaveLength(2);
  });
});

describe("sign-in and logout reach every tab", () => {
  it("shares a sign-in with the other tabs", async () => {
    const { openTab, server } = browser();
    server.breakRefresh();
    const a = openTab();
    const b = openTab();
    await Promise.all([a.start(), b.start()]);

    a.signIn(sessionBody("login"));
    await vi.waitFor(() => expect(b.getState().status).toBe("authenticated"));

    expect(tokenName(await b.getAccessToken())).toBe("login");
  });

  it("logs every tab out", async () => {
    const { openTab } = browser();
    const a = openTab();
    await a.start();
    const b = openTab();
    await b.start();

    await a.logout();
    await vi.waitFor(() => expect(b.getState().status).toBe("guest"));

    expect(a.getState().status).toBe("guest");
  });

  it("logs every tab out when a refresh shows the session has ended", async () => {
    const { openTab, server } = browser();
    const a = openTab();
    await a.start();
    const b = openTab();
    await b.start();
    server.breakRefresh();

    await a.refresh(await a.getAccessToken() ?? undefined);
    await vi.waitFor(() => expect(b.getState().status).toBe("guest"));
  });
});
