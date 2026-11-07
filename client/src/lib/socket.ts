import { io, type Socket } from "socket.io-client";
import { apiBaseUrl, session } from "./api";

// One Socket.IO connection for the logged-in user (B2b decision 5):
// - signs in with the access token; every (re)connect asks the session for a
//   fresh one;
// - when the session gets a new token (any tab refreshed), sends it with
//   "auth:refresh"; before the token runs out it asks the session to refresh,
//   so an idle chat stays connected;
// - the server disconnects an expired socket ("auth:expired"): reconnect with
//   a new token; a suspended or banned account is not retried;
// - rooms of open chats are joined again after a reconnect;
// - B2c: tells the server which chat this tab shows while the tab is visible
//   ("chat:viewing"), so no push or notification arrives for that chat.

export const SOCKET_PATH = "/api/socket";
const REFRESH_MARGIN_MS = 60_000;
const LOCKED = new Set(["ACCOUNT_SUSPENDED", "ACCOUNT_BANNED"]);

type Handler = (...args: never[]) => void;
export type AckError = { error: { code: string; message?: string } };

class ChatSocket {
  private socket: Socket | null = null;
  private token: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Map<string, Set<Handler>>();
  private readonly chats = new Map<string, number>();
  private started = false;
  private viewing: string | null = null;

  start() {
    if (this.started) return;
    this.started = true;
    session.subscribe(() => this.sync());
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => this.sendViewing());
    this.sync();
  }

  // The chat this tab shows (null when it shows none).
  setViewingChat(chatId: string | null) {
    this.viewing = chatId;
    this.sendViewing();
  }

  private sendViewing() {
    if (!this.socket?.connected) return;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    this.socket.emit("chat:viewing", { chatId: this.viewing, visible });
  }

  get connected() {
    return this.socket?.connected ?? false;
  }

  on<T extends Handler>(event: string, handler: T) {
    const set = this.listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  // Joins a chat's room while a chat screen shows it; returns the leave function.
  joinChat(chatId: string) {
    this.chats.set(chatId, (this.chats.get(chatId) ?? 0) + 1);
    if (this.socket?.connected) this.socket.emit("chat:join", chatId);
    return () => {
      const count = (this.chats.get(chatId) ?? 1) - 1;
      if (count > 0) {
        this.chats.set(chatId, count);
        return;
      }
      this.chats.delete(chatId);
      this.socket?.emit("chat:leave", chatId);
    };
  }

  emitWithAck<T>(event: string, payload: unknown, timeoutMs = 8000) {
    return new Promise<T | AckError>((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(new Error("not connected"));
        return;
      }
      this.socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: T | AckError) => {
        if (error) reject(error);
        else resolve(response);
      });
    });
  }

  private sync() {
    const state = session.getState();
    if (state.status !== "authenticated") {
      this.stop();
      return;
    }
    const { accessToken, expiresAt } = state.session;
    if (!this.socket) this.connect();
    else if (accessToken !== this.token && this.socket.connected) this.socket.emit("auth:refresh", accessToken);
    this.token = accessToken;
    this.scheduleRefresh(expiresAt);
  }

  private scheduleRefresh(expiresAt: number) {
    clearTimeout(this.refreshTimer);
    const delay = Math.max(1000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
    // getAccessToken refreshes a token that is about to expire; the session
    // change then reaches sync(), which sends it to the server.
    this.refreshTimer = setTimeout(() => void session.getAccessToken(), delay);
  }

  private connect() {
    const origin = /^https?:/.test(apiBaseUrl) ? new URL(apiBaseUrl).origin : window.location.origin;
    const socket = io(origin, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      auth: (callback) => {
        void session.getAccessToken().then((token) => callback({ token }));
      },
    });
    socket.on("connect", () => {
      for (const chatId of this.chats.keys()) socket.emit("chat:join", chatId);
      this.sendViewing();
      this.dispatch("connect");
    });
    socket.on("auth:expired", () => {
      void session.getAccessToken().then((token) => {
        if (token) socket.connect();
      });
    });
    socket.on("disconnect", (reason) => {
      this.dispatch("disconnect");
      // The server ends the connection when the token expired; reconnect with a fresh one.
      if (reason === "io server disconnect" && session.getState().status === "authenticated") {
        setTimeout(() => socket.connect(), 1000);
      }
    });
    socket.on("connect_error", (error: Error & { data?: { code?: string } }) => {
      if (error.data?.code && LOCKED.has(error.data.code)) socket.disconnect();
    });
    socket.onAny((event: string, ...args: unknown[]) => this.dispatch(event, ...args));
    this.socket = socket;
  }

  private dispatch(event: string, ...args: unknown[]) {
    for (const handler of this.listeners.get(event) ?? []) (handler as (...a: unknown[]) => void)(...args);
  }

  private stop() {
    clearTimeout(this.refreshTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.token = null;
  }
}

export const chatSocket = new ChatSocket();
