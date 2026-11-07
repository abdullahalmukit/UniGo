import { afterAll, beforeEach } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { scheduledJobs } from "../../src/jobs/scheduler.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { setOutboundFetchForTests } from "../../src/lib/outbound.js";
import { resetGeoForTests } from "../../src/modules/geo/geo.service.js";
import { useDeliveryQueueForTests } from "../../src/modules/notifications/notify.service.js";
import { resetFareCacheForTests } from "../../src/modules/ride/fare.service.js";
import { failingPushEndpoints, sentPushes } from "../../src/modules/notifications/push.transport.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";

let tables: string[] | undefined;

// Every test starts with an empty database, empty rate-limit counters, an
// empty email outbox and no scheduled jobs, after any background work from the previous test ends.
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
  scheduledJobs.clear();
  // B2c: pushes "sent", failing endpoints, delivery straight away (not by job)
  sentPushes.length = 0;
  failingPushEndpoints.clear();
  useDeliveryQueueForTests(false);
  // B3a: no outside calls unless a test fakes them; empty caches
  setOutboundFetchForTests(null);
  resetGeoForTests();
  resetFareCacheForTests();
});

afterAll(async () => {
  await settleBackgroundTasks();
  await prisma.$disconnect();
});
