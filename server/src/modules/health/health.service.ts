import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";

// Answers within DATABASE_CONNECT_TIMEOUT_MS, whatever the driver does.
export async function isDatabaseUp() {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), env.DATABASE_CONNECT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([pingDatabase(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function pingDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
