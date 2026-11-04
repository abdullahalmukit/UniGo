import { app } from "./app.js";
import { env } from "./config/env.js";
import { startAccountStatusJob } from "./jobs/account-status.job.js";
import { prisma } from "./lib/prisma.js";

const server = app.listen(env.PORT, () => {
  console.log(`UniGo API listening on http://localhost:${env.PORT}`);
});

// Ends suspensions and restrictions on time (A8). Moves to BullMQ in B2.
const stopAccountStatusJob = startAccountStatusJob();

async function shutDown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopAccountStatusJob();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));
