import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { rules } from "../../src/config/rules.js";
import { sentPushes } from "../../src/modules/notifications/push.transport.js";
import { attachSockets } from "../../src/sockets/index.js";
import { acceptedWithChat } from "./activity-helpers.js";
import { api, bearer } from "./helpers.js";
import { rowsOf, settle, subscribeDevice } from "./notification-helpers.js";

// New chat messages (proposal section 14, B2c decisions): one in-app row per
// unread run, a push per message that alerts only for the first, nothing
// while the chat is open, never the message text.

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
});

afterAll(async () => {
  await sockets.close();
  await new Promise((resolve) => server.close(resolve));
});

async function connected(token: string) {
  const socket = connect(url, { path: rules.socket.path, auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true });
  open.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

const emit = <T = Record<string, unknown>>(socket: Socket, event: string, payload: unknown) =>
  new Promise<T>((resolve) => socket.emit(event, payload, resolve));

async function send(token: string, chatId: string, body: string) {
  const response = await api().post(`/api/chats/${chatId}/messages`).set(bearer(token)).send({ body });
  expect(response.status).toBe(201);
  await settle();
  return response.body.message as { id: string };
}

const chatRows = async (userId: string) => (await rowsOf(userId, "NEW_CHAT_MESSAGE")).filter((row) => row.channel === "IN_APP");

describe("chat message notifications", () => {
  it("keeps one in-app row per unread run and alerts by push only for its first message", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    await settle();
    await subscribeDevice(creator.id);

    await send(accepter.accessToken, chatId, "My phone is 01711111111");
    await send(accepter.accessToken, chatId, "Second");
    let rows = await chatRows(creator.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ readAt: null, data: expect.objectContaining({ chatId, count: 2 }) });

    expect(sentPushes.map((p) => [p.payload.tag, p.payload.renotify])).toEqual([
      [`chat-${chatId}`, true],
      [`chat-${chatId}`, false],
    ]);
    // Never the message text (B2c decision)
    expect(sentPushes[0].payload).toMatchObject({ title: "New message from Test Student", body: "Open the chat to read it.", url: `/inbox/${chatId}` });
    expect(sentPushes[1].payload.body).toBe("2 new messages");
    expect(JSON.stringify(sentPushes)).not.toContain("01711111111");
    expect(JSON.stringify(await rowsOf(creator.id))).not.toContain("01711111111");
    // The sender gets nothing
    expect(await rowsOf(accepter.id, "NEW_CHAT_MESSAGE")).toEqual([]);

    // Reading the chat marks its notification read; the next message starts a new run.
    const read = await api().post(`/api/chats/${chatId}/read`).set(bearer(creator.accessToken)).send({});
    expect(read.status).toBe(200);
    await settle();
    expect((await chatRows(creator.id))[0].readAt).not.toBeNull();

    await send(accepter.accessToken, chatId, "Third");
    rows = await chatRows(creator.id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.readAt === null)).toHaveLength(1);
    expect(sentPushes.at(-1)?.payload.renotify).toBe(true);
  });

  it("makes a collapsed row unread again when a later message arrives after it was marked read", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    await send(accepter.accessToken, chatId, "One");
    await api().post("/api/notifications/read-all").set(bearer(creator.accessToken));
    await send(accepter.accessToken, chatId, "Two");
    const rows = await chatRows(creator.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].readAt).toBeNull();
  });

  it("sends nothing while the receiver has the chat open, and again once the tab is hidden", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    await settle();
    await subscribeDevice(creator.id);
    const socket = await connected(creator.accessToken);
    expect(await emit(socket, "chat:viewing", { chatId, visible: true })).toEqual({ ok: true });

    await send(accepter.accessToken, chatId, "You see this live");
    expect(await rowsOf(creator.id, "NEW_CHAT_MESSAGE")).toEqual([]);
    expect(sentPushes).toEqual([]);

    expect(await emit(socket, "chat:viewing", { chatId, visible: false })).toEqual({ ok: true });
    await send(accepter.accessToken, chatId, "Now you get a push");
    expect(await chatRows(creator.id)).toHaveLength(1);
    expect(sentPushes).toHaveLength(1);
  });

  it("refuses to mark a chat as viewed by a non-participant", async () => {
    const { chatId } = await acceptedWithChat();
    const { accepter: stranger } = await acceptedWithChat();
    const socket = await connected(stranger.accessToken);
    expect(await emit(socket, "chat:viewing", { chatId, visible: true })).toMatchObject({ error: { code: "NOT_PARTICIPANT" } });
  });

  it("pushes new notifications and the unread count to the user's open tabs", async () => {
    const { creator, accepter, chatId } = await acceptedWithChat();
    await settle();
    const socket = await connected(creator.accessToken);
    const received = new Promise<{ notification: { title: string; link: string }; unreadCount: number }>((resolve) =>
      socket.once("notification:new", resolve),
    );
    await send(accepter.accessToken, chatId, "Hello");
    const event = await received;
    expect(event.notification).toMatchObject({ title: "New message from Test Student", link: `/inbox/${chatId}` });
    // The accept notification and this one
    expect(event.unreadCount).toBe(2);
  });
});
