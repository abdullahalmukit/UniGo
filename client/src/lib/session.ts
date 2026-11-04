// The logged-in session: the access token lives only in memory. Refreshing is
// coordinated across every open tab (A5a decision):
//
// 1. Inside a tab, callers that need a refresh at the same time share one.
// 2. Across tabs, the Web Lock "unigo-auth-refresh" lets one tab refresh at a time.
// 3. The tab that refreshed bumps a counter in localStorage (a plain number, not a
//    secret) and sends the new session on a BroadcastChannel, before it releases
//    the lock.
// 4. A tab that waited for the lock reuses a session it already received; if the
//    counter moved but the message is late, it waits for the message briefly. Only
//    if neither happens does it refresh itself.
//
// Refreshes never overlap, so the second tab to refresh presents the newest
// cookie and the server sees a normal rotation, never token reuse.

export type SessionUser = {
  id: string;
  language?: "BN" | "EN";
  theme?: "LIGHT" | "DARK" | "SYSTEM";
  [key: string]: unknown;
};

export type Session = {
  accessToken: string;
  // On this device's clock (see expiryFromToken), shared by every tab.
  expiresAt: number;
  user: SessionUser;
};

export type SessionState =
  | { status: "unknown" }
  | { status: "guest" }
  | { status: "authenticated"; session: Session };

type Message = { type: "session"; session: Session } | { type: "session-request" } | { type: "logout" };

export type LockLike = { request<T>(name: string, callback: () => Promise<T>): Promise<T> };
export type ChannelLike = { post(message: Message): void; onMessage(handler: (message: Message) => void): void };
export type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export type SessionDeps = {
  apiBaseUrl: string;
  fetch: typeof fetch;
  locks: LockLike;
  channel: ChannelLike;
  storage: StorageLike;
  now?: () => number;
  timing?: Partial<typeof DEFAULT_TIMING>;
};

const LOCK_NAME = "unigo-auth-refresh";
const GENERATION_KEY = "unigo.auth.refreshGeneration";
const DEFAULT_TIMING = {
  // How long a new tab waits for another tab to share its session.
  shareWaitMs: 150,
  // How long a tab that waited for the lock waits for a late session message.
  broadcastWaitMs: 1000,
  // Refresh this long before the access token expires.
  expiryMarginMs: 30_000,
};

export class SessionManager {
  private state: SessionState = { status: "unknown" };
  private readonly listeners = new Set<() => void>();
  private readonly sessionWaiters = new Set<(session: Session) => void>();
  private refreshing: Promise<Session | null> | null = null;
  private starting: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly timing: typeof DEFAULT_TIMING;

  constructor(private readonly deps: SessionDeps) {
    this.now = deps.now ?? Date.now;
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
    deps.channel.onMessage((message) => this.onMessage(message));
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  // On page load: borrow a session from another open tab, else refresh.
  start() {
    this.starting ??= (async () => {
      const shared = await this.waitForSession(this.timing.shareWaitMs, () => this.post({ type: "session-request" }));
      if (shared) return;
      try {
        await this.refresh();
      } catch {
        // The API could not be reached: carry on as a guest.
        if (this.state.status === "unknown") this.setState({ status: "guest" });
      }
    })();
    return this.starting;
  }

  // A valid access token, refreshed first if it is about to expire; null for guests.
  async getAccessToken() {
    if (this.state.status === "unknown") await this.start();
    const session = this.currentSession();
    if (!session) return null;
    if (this.isFresh(session)) return session.accessToken;
    return (await this.refresh(session.accessToken))?.accessToken ?? null;
  }

  // `staleToken` is the token that failed or is expiring, if any.
  refresh(staleToken?: string) {
    this.refreshing ??= this.refreshAcrossTabs(staleToken).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  // After login or registration (A5b): adopt the session in every tab.
  signIn(body: unknown) {
    const session = toSession(body, this.now());
    this.bumpGeneration();
    this.adopt(session);
    this.post({ type: "session", session });
  }

  // After the user changes their own account (A7): keep the token, replace the
  // account it carries, in every tab.
  updateUser(user: SessionUser) {
    const current = this.currentSession();
    if (!current || current.user.id !== user.id) return;
    const session = { ...current, user };
    this.adopt(session);
    this.post({ type: "session", session });
  }

  async logout() {
    try {
      await this.deps.fetch(`${this.deps.apiBaseUrl}/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      this.becomeGuest({ broadcast: true });
    }
  }

  private refreshAcrossTabs(staleToken: string | undefined) {
    const generationBefore = this.deps.storage.getItem(GENERATION_KEY);

    return this.deps.locks.request(LOCK_NAME, async () => {
      // Another tab refreshed while this one waited, and its message has arrived.
      const current = this.currentSession();
      if (current && current.accessToken !== staleToken && this.isFresh(current)) return current;

      // Another tab refreshed, but its message is still on the way.
      if (this.deps.storage.getItem(GENERATION_KEY) !== generationBefore) {
        const shared = await this.waitForSession(this.timing.broadcastWaitMs);
        if (shared && shared.accessToken !== staleToken) return shared;
      }

      return this.callRefreshEndpoint();
    });
  }

  private async callRefreshEndpoint() {
    const response = await this.deps.fetch(`${this.deps.apiBaseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    // The session is over (or the account is blocked) for every tab: they share the cookie.
    if (response.status === 401 || response.status === 403) {
      this.becomeGuest({ broadcast: true });
      return null;
    }
    if (!response.ok) throw new Error(`Refresh failed with status ${response.status}`);

    const session = toSession(await response.json(), this.now());
    this.bumpGeneration();
    this.adopt(session);
    this.post({ type: "session", session });
    return session;
  }

  private onMessage(message: Message) {
    switch (message.type) {
      case "session": {
        const current = this.currentSession();
        if (!current || message.session.expiresAt >= current.expiresAt) this.adopt(message.session);
        return;
      }
      case "session-request": {
        const current = this.currentSession();
        if (current && this.isFresh(current)) this.post({ type: "session", session: current });
        return;
      }
      case "logout":
        this.becomeGuest({ broadcast: false });
        return;
    }
  }

  private adopt(session: Session) {
    this.setState({ status: "authenticated", session });
    for (const resolve of this.sessionWaiters) resolve(session);
    this.sessionWaiters.clear();
  }

  private becomeGuest({ broadcast }: { broadcast: boolean }) {
    this.setState({ status: "guest" });
    if (broadcast) this.post({ type: "logout" });
  }

  // Resolves with the next session that arrives, or null after `ms`.
  private waitForSession(ms: number, afterSubscribe?: () => void) {
    return new Promise<Session | null>((resolve) => {
      const done = (session: Session | null) => {
        clearTimeout(timer);
        this.sessionWaiters.delete(done);
        resolve(session);
      };
      const timer = setTimeout(() => done(null), ms);
      this.sessionWaiters.add(done);
      afterSubscribe?.();
    });
  }

  private currentSession() {
    return this.state.status === "authenticated" ? this.state.session : null;
  }

  private isFresh(session: Session) {
    return session.expiresAt - this.now() > this.timing.expiryMarginMs;
  }

  private bumpGeneration() {
    const next = Number(this.deps.storage.getItem(GENERATION_KEY) ?? 0) + 1;
    this.deps.storage.setItem(GENERATION_KEY, String(next));
  }

  private post(message: Message) {
    this.deps.channel.post(message);
  }

  private setState(state: SessionState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

// The server's session response: { user, accessToken, accessTokenExpiresAt }.
function toSession(body: unknown, now: number): Session {
  const { user, accessToken, accessTokenExpiresAt } = body as {
    user: SessionUser;
    accessToken: string;
    accessTokenExpiresAt: string;
  };
  return { accessToken, user, expiresAt: expiryFromToken(accessToken, now) ?? Date.parse(accessTokenExpiresAt) };
}

// The token's lifetime (exp - iat, both on the server's clock) added to this
// device's clock, so a wrong device clock cannot cause early or late refreshes.
function expiryFromToken(token: string, now: number) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    return now + (payload.exp - payload.iat) * 1000;
  } catch {
    return null;
  }
}

// Real browser dependencies, with fallbacks where an API is missing.
export function browserSessionDeps(apiBaseUrl: string): SessionDeps {
  return {
    apiBaseUrl,
    fetch: (...args) => fetch(...args),
    locks: webLocks(),
    channel: broadcastChannel("unigo-auth"),
    storage: safeLocalStorage(),
  };
}

function webLocks(): LockLike {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return { request: (name, callback) => navigator.locks.request(name, callback) };
  }
  // Without Web Locks (Safari before 15.4) each tab still refreshes one at a time,
  // but tabs are not coordinated.
  return { request: (_name, callback) => callback() };
}

function broadcastChannel(name: string): ChannelLike {
  if (typeof BroadcastChannel === "undefined") return { post: () => {}, onMessage: () => {} };
  const channel = new BroadcastChannel(name);
  return {
    post: (message) => channel.postMessage(message),
    onMessage: (handler) => {
      channel.onmessage = (event: MessageEvent<Message>) => handler(event.data);
    },
  };
}

function safeLocalStorage(): StorageLike {
  const memory = new Map<string, string>();
  return {
    getItem: (key) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        memory.set(key, value);
      }
    },
  };
}
