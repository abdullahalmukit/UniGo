import type { Server } from "socket.io";

// The running Socket.IO server, if any (none in most tests), so services can
// reach sockets without importing the whole socket layer.
let current: Server | undefined;

export function setSocketServer(server: Server | undefined) {
  current = server;
}

// Every socket of the user, in every tab (they all join "user:<id>").
export function disconnectUserSockets(userId: string) {
  current?.in(`user:${userId}`).disconnectSockets(true);
}
