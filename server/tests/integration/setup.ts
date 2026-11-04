import { afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";

let tables: string[] | undefined;

// Every test starts with an empty database, empty rate-limit counters and an
// empty email outbox, after any background work from the previous test ends.
beforeEach(async () => {
  await settleBackgroundTasks();

  tables ??= (
    await prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name <> '_prisma_migrations'`
  ).map((row) => row.name);

  // One transaction keeps every statement on the same connection.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of tables!) await tx.$executeRawUnsafe(`DELETE FROM \`${table}\``);
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  });

  resetRateLimits();
  sentEmails.length = 0;
});

afterAll(async () => {
  await settleBackgroundTasks();
  await prisma.$disconnect();
});
