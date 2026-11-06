import { createServer } from "node:http";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { startJobs } from "./jobs/worker.js";
import { prisma } from "./lib/prisma.js";
import { attachSockets } from "./sockets/index.js";

const server = createServer(app);

// Real-time chat (B2b) on the same port, under /api/socket.
const sockets = attachSockets(server);

server.listen(env.PORT, () => {
  console.log(`UniGo API listening on http://localhost:${env.PORT}`);
});

// BullMQ background jobs (B2a): activity timers, the sweeper and the account
// status job. Needs Redis at REDIS_URL.
const stopJobs = startJobs();

async function shutDown(signal: string) {
  console.log(`${signal} received, shutting down`);
  await stopJobs();
  await sockets.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));
