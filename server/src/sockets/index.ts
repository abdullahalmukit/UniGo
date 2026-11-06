import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { env } from "../config/env.js";
import { rules } from "../config/rules.js";
import { userFromAccessToken } from "../middleware/authenticate.js";
import { onChatEvent, type ChatEvent } from "../modules/chat/chat-events.js";
import { assertChatParticipant, markChatRead, messageViewById, sendTextMessage, unreadTotal } from "../modules/chat/chat.service.js";
import { AppError } from "../utils/app-error.js";
import { setSocketServer } from "./registry.js";

// Real-time chat (proposal section 13, B2b decision 5):
// - a socket signs in with the access token (same checks as REST: signature,
//   log-out-all, SUSPENDED/BANNED refused) and joins only its user's room;
// - before the token expires the client sends the new one with
//   "auth:refresh"; a socket whose token expired is disconnected;
// - "chat:join" joins a chat's room only for a participant;
// - "message:send" goes through the same service as REST: account status
//   re-read, read-only and block checks, 10 messages a minute shared with REST;
// - payloads are built by the chat service views: never an email address.

type Ack = (response: unknown) => void;
type SocketData = { userId: string; expiresAt: Date; expiryTimer?: NodeJS.Timeout };

const chatIdSchema = z.string().trim().min(1).max(64);
const sendSchema = z.object({ chatId: chatIdSchema, body: z.string() });
const readSchema = z.object({ chatId: chatIdSchema, upTo: z.string().trim().min(1).max(64).optional() });

function errorPayload(error: unknown) {
  if (error instanceof AppError) return { error: { ...error.data, code: error.code, message: error.message } };
  if (error instanceof z.ZodError) return { error: { code: "VALIDATION_ERROR", message: "Some fields are invalid" } };
  console.error(`Socket handler failed: ${error instanceof Error ? error.message : String(error)}`);
  return { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } };
}

const userRoom = (userId: string) => `user:${userId}`;
const chatRoom = (chatId: string) => `chat:${chatId}`;

function scheduleExpiry(socket: Socket) {
  const data = socket.data as SocketData;
  clearTimeout(data.expiryTimer);
  const delay = Math.max(0, data.expiresAt.getTime() - Date.now() + rules.socket.expiryGrace);
  data.expiryTimer = setTimeout(() => {
    socket.emit("auth:expired");
    socket.disconnect(true);
  }, delay);
}

export function attachSockets(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    path: rules.socket.path,
    serveClient: false,
    cors: { origin: env.CLIENT_URL, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== "string" || token.length === 0) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
      const { user, expiresAt } = await userFromAccessToken(token);
      Object.assign(socket.data as SocketData, { userId: user.id, expiresAt });
      next();
    } catch (error) {
      const code = error instanceof AppError ? error.code : "UNAUTHENTICATED";
      next(Object.assign(new Error(code), { data: { code } }));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    const userId = data.userId;
    void socket.join(userRoom(userId));
    scheduleExpiry(socket);

    socket.on("auth:refresh", async (token: unknown, ack?: Ack) => {
      try {
        if (typeof token !== "string") throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
        const { user, expiresAt } = await userFromAccessToken(token);
        if (user.id !== userId) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
        data.expiresAt = expiresAt;
        scheduleExpiry(socket);
        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
        socket.disconnect(true);
      }
    });

    socket.on("chat:join", async (chatId: unknown, ack?: Ack) => {
      try {
        const id = chatIdSchema.parse(chatId);
        await assertChatParticipant(userId, id);
        await socket.join(chatRoom(id));
        ack?.({ ok: true });
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    socket.on("chat:leave", async (chatId: unknown) => {
      const parsed = chatIdSchema.safeParse(chatId);
      if (parsed.success) await socket.leave(chatRoom(parsed.data));
    });

    socket.on("message:send", async (payload: unknown, ack?: Ack) => {
      try {
        const { chatId, body } = sendSchema.parse(payload);
        ack?.({ message: await sendTextMessage(userId, chatId, body) });
      } catch (error) {
        ack?.(errorPayload(error));
        // A suspended or banned account loses its connection at once.
        if (error instanceof AppError && (error.code === "ACCOUNT_SUSPENDED" || error.code === "ACCOUNT_BANNED")) socket.disconnect(true);
      }
    });

    socket.on("chat:read", async (payload: unknown, ack?: Ack) => {
      try {
        const { chatId, upTo } = readSchema.parse(payload);
        ack?.(await markChatRead(userId, chatId, upTo));
      } catch (error) {
        ack?.(errorPayload(error));
      }
    });

    socket.on("disconnect", () => clearTimeout(data.expiryTimer));
  });

  const stopListening = onChatEvent((event) => void pushChatEvent(io, event));
  setSocketServer(io);

  return {
    io,
    close: async () => {
      stopListening();
      setSocketServer(undefined);
      await io.close();
    },
  };
}

// Pushes a committed chat change: the message to the chat's room, the new
// unread total to each participant's own room (Inbox badge and list).
async function pushChatEvent(io: Server, event: ChatEvent) {
  try {
    if (event.kind === "message") {
      const message = await messageViewById(event.messageId);
      if (message) io.to(chatRoom(event.chatId)).emit("message:new", message);
      for (const userId of event.participantIds) {
        io.to(userRoom(userId)).emit("inbox:update", { chatId: event.chatId, unreadTotal: await unreadTotal(userId) });
      }
    } else if (event.kind === "read") {
      io.to(userRoom(event.userId)).emit("inbox:update", { chatId: event.chatId, unreadTotal: await unreadTotal(event.userId) });
    } else {
      for (const userId of event.participantIds) io.to(userRoom(userId)).emit("chat:changed", { chatId: event.chatId });
    }
  } catch (error) {
    console.error(`Could not push a chat event: ${error instanceof Error ? error.message : String(error)}`);
  }
}
