import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { rules } from "../../src/config/rules.js";
import { signAccessToken } from "../../src/modules/auth/tokens.js";
import { attachSockets } from "../../src/sockets/index.js";
import { acceptedWithChat, verifiedUser } from "./activity-helpers.js";
import { api, bearer, registerUser } from "./helpers.js";

let server: HttpServer;
let sockets: ReturnType<typeof attachSockets>;
let url: string;
const open: Socket[] = [];

beforeAll(async () => {
  server = createServer(app);
  sockets = attachSockets(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  for (const socket of open.splice(0)) socket.disconnect();
  vi.useRealTimers();
});

afterAll(async () => {
  await sockets.close();
  await new Promise((resolve) => server.close(resolve));
});

function client(token: string | undefined) {
  const socket = connect(url, { path: rules.socket.path, auth: token ? { token } : {}, transports: ["websocket"], reconnection: false, forceNew: true });
  open.push(socket);
  return socket;
}

async function connected(token: string) {
  const socket = client(token);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function connectError(token: string | undefined) {
  const socket = client(token);
  return new Promise<{ code?: string }>((resolve) => socket.once("connect_error", (error: Error & { data?: { code?: string } }) => resolve(error.data ?? {})));
}

const emit = <T = Record<string, unknown>>(socket: Socket, event: string, payload: unknown) =>
  new Promise<T>((resolve) => socket.emit(event, payload, resolve));

const next = <T = Record<string, unknown>>(socket: Socket, event: string) => new Promise<T>((resolve) => socket.once(event, resolve));

// Every payload a socket receives, to check that no email ever appears.
function record(socket: Socket) {
  const seen: unknown[] = [];
  socket.onAny((_event, ...args) => seen.push(args));
  return seen;
}

describe("socket sign-in", () => {
  it("refuses a missing or invalid token and a suspended account", async () => {
    expect((await connectError(undefined)).code).toBe("UNAUTHENTICATED");
    expect((await connectError("not-a-token")).code).toBe("UNAUTHENTICATED");
    const suspended = await registerUser({ accountStatus: "SUSPENDED", suspendedUntil: new Date(Date.now() + 3600_000) });
    expect((await connectError(suspended.accessToken)).code).toBe("ACCOUNT_SUSPENDED");
  });

  it("disconnects a socket whose token expired without a refresh, and keeps one that refreshed", async () => {
    const user = await verifiedUser();
    const grace = rules.socket.expiryGrace;
    (rules.socket as { expiryGrace: number }).expiryGrace = 0;
    try {
      // A token that expires about 1.5 s from now
      vi.useFakeTimers({ now: Date.now() - 15 * 60 * 1000 + 1500, toFake: ["Date"] });
      const { token: shortToken } = await signAccessToken(user.id);
      vi.useRealTimers();

      const expiring = await connected(shortToken);
      const refreshed = await connected(shortToken);
      expect(await emit(refreshed, "auth:refresh", user.accessToken)).toEqual({ ok: true });

      await next(expiring, "disconnect");
      expect(expiring.connected).toBe(false);
      expect(refreshed.connected).toBe(true);
    } finally {
      (rules.socket as { expiryGrace: number }).expiryGrace = grace;
    }
  });

  it("disconnects on a refresh with another user's token", async () => {
    const [user, other] = await Promise.all([verifiedUser(), verifiedUser()]);
    const socket = await connected(user.accessToken);
    const gone = next(socket, "disconnect");
    expect(await emit(socket, "auth:refresh", other.accessToken)).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
    await gone;
  });
});

describe("chat over the socket", () => {
  it("joins only the user's own chats", async () => {
    const { chatId } = await acceptedWithChat();
    const stranger = await verifiedUser();
    const socket = await connected(stranger.accessToken);
    expect(await emit(socket, "chat:join", chatId)).toMatchObject({ error: { code: "NOT_PARTICIPANT" } });
    expect(await emit(socket, "message:send", { chatId, body: "hi" })).toMatchObject({ error: { code: "NOT_PARTICIPANT" } });
  });

  it("delivers a message to the chat room and updates the other user's unread total, without any email", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    const sender = await connected(accepter.accessToken);
    const receiver = await connected(creator.accessToken);
    const seen = [...[record(sender)], ...[record(receiver)]];
    expect(await emit(receiver, "chat:join", chatId)).toEqual({ ok: true });

    const arrived = next<{ body: string; senderId: string }>(receiver, "message:new");
    const badge = next<{ chatId: string; unreadTotal: number }>(receiver, "inbox:update");
    const ack = await emit<{ message: { body: string } }>(sender, "message:send", { chatId, body: "  Outside the gate  " });

    expect(ack.message.body).toBe("Outside the gate");
    expect(await arrived).toMatchObject({ body: "Outside the gate", senderId: accepter.id });
    // The ACCEPTED system message and this one
    expect(await badge).toEqual({ chatId, unreadTotal: 2 });

    const read = await emit<{ unreadTotal: number }>(receiver, "chat:read", { chatId });
    expect(read.unreadTotal).toBe(0);

    const json = JSON.stringify(seen);
    expect(json).not.toContain(creator.email);
    expect(json).not.toContain(accepter.email);
    expect(json).not.toMatch(/"email"/i);
  });

  it("shares the 10-a-minute limit with REST", async () => {
    const { creator, chatId } = await acceptedWithChat();
    for (let i = 0; i < 6; i += 1) {
      expect((await api().post(`/api/chats/${chatId}/messages`).set(bearer(creator.accessToken)).send({ body: `rest ${i}` })).status).toBe(201);
    }
    const socket = await connected(creator.accessToken);
    for (let i = 0; i < 4; i += 1) expect(await emit(socket, "message:send", { chatId, body: `socket ${i}` })).toHaveProperty("message");
    expect(await emit(socket, "message:send", { chatId, body: "too many" })).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("refuses sending when read-only or blocked", async () => {
    const { creator, accepter, activity, chatId } = await acceptedWithChat();
    const socket = await connected(creator.accessToken);
    await api().post("/api/me/blocks").set(bearer(accepter.accessToken)).send({ userId: creator.id });
    expect(await emit(socket, "message:send", { chatId, body: "hi" })).toMatchObject({ error: { code: expect.stringMatching(/CHAT_BLOCKED|CHAT_READ_ONLY/) } });
    expect(activity.id).toBeTruthy();
  });
});

describe("account lock", () => {
  it("disconnects every socket of a user an admin suspends, and refuses them on reconnect", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const user = await verifiedUser();
    const first = await connected(user.accessToken);
    const second = await connected(user.accessToken);
    const gone = Promise.all([next(first, "disconnect"), next(second, "disconnect")]);

    const response = await api()
      .post(`/api/admin/users/${user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Abuse in chat", endsAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
    expect(response.status).toBe(200);

    await gone;
    expect((await connectError(user.accessToken)).code).toBe("ACCOUNT_SUSPENDED");
  });

  it("keeps a restricted user connected", async () => {
    const admin = await registerUser({ role: "SUPER_ADMIN" });
    const user = await verifiedUser();
    const socket = await connected(user.accessToken);
    await api().post(`/api/admin/users/${user.id}/restrict`).set(bearer(admin.accessToken)).send({ reason: "Spam posts" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(socket.connected).toBe(true);
  });
});
