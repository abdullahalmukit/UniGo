import type { Server } from "socket.io";

// The running Socket.IO server, if any (none in most tests), so services can
// reach sockets without importing the whole socket layer.
let current: Server | undefined;

export function setSocketServer(server: Server | undefined) {
  current = server;
}

export const userRoom = (userId: string) => `user:${userId}`;

// Every socket of the user, in every tab (they all join "user:<id>").
export function disconnectUserSockets(userId: string) {
  current?.in(userRoom(userId)).disconnectSockets(true);
}

// B2c: an event to every tab of the user.
export function emitToUser(userId: string, event: string, payload: unknown) {
  current?.to(userRoom(userId)).emit(event, payload);
}

// B2c: true while one of the user's tabs shows this chat and is visible
// ("chat:viewing" from the client). No push and no in-app row then.
export async function isUserViewingChat(userId: string, chatId: string) {
  if (!current) return false;
  const sockets = await current.in(userRoom(userId)).fetchSockets();
  return sockets.some((socket) => (socket.data as { viewingChatId?: string | null }).viewingChatId === chatId);
}
