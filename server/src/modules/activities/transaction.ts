import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

export type Tx = Prisma.TransactionClient;

// Runs an accept, booking or creation transaction (B2a decision 5):
// - READ COMMITTED, so every query sees rows committed by transactions this
//   one waited for. Under MySQL's default REPEATABLE READ a conflict query
//   could read an older snapshot and miss an accept committed while this
//   transaction waited for its user locks.
// - Retried after a deadlock or lock wait timeout, up to
//   rules.activity.transactionAttempts in total.
export async function runActivityTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (error) {
      if (attempt < rules.activity.transactionAttempts && isRetryable(error)) continue;
      throw error;
    }
  }
}

function isRetryable(error: unknown) {
  if (error instanceof AppError) return false;
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "P2034") return true;
  const message = "message" in error ? String(error.message) : "";
  return /deadlock|lock wait timeout|\b1213\b|\b1205\b/i.test(message);
}

// Locks the users' rows until the transaction ends. Every accept, booking and
// creation locks its participants first, always in id order so two
// transactions can never wait for each other (no deadlock). Two transactions
// that share a user therefore run one after the other, which makes the
// conflict check and the limits safe.
export async function lockUsers(tx: Tx, userIds: readonly string[]) {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}
