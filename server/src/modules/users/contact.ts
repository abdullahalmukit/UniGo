import type { ActivityStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { blockedUserIds } from "./blocks.service.js";

// Phone numbers between participants (proposal sections 13 and 15.6, B2b
// decision 9, B3b-1): only after acceptance, only while the activity runs
// (ACCEPTED, IN_PROGRESS, DISPUTED), never when either user has blocked the
// other. An email address is never shared.

export const PHONE_STATUSES: readonly ActivityStatus[] = ["ACCEPTED", "IN_PROGRESS", "DISPUTED"];

type Db = Prisma.TransactionClient | typeof prisma;

export type PhoneQuery = { otherId: string | null | undefined; status: ActivityStatus };

// The other participant's phone for each query (same order), or null.
export async function participantPhones(viewerId: string, queries: readonly PhoneQuery[], db: Db = prisma): Promise<(string | null)[]> {
  const wanted = [...new Set(queries.filter((q) => q.otherId && PHONE_STATUSES.includes(q.status)).map((q) => q.otherId!))];
  if (wanted.length === 0) return queries.map(() => null);
  const [blocked, users] = await Promise.all([
    blockedUserIds(db, viewerId),
    db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, phone: true } }),
  ]);
  const phones = new Map(users.map((user) => [user.id, user.phone]));
  return queries.map((q) => (q.otherId && PHONE_STATUSES.includes(q.status) && !blocked.includes(q.otherId) ? (phones.get(q.otherId) ?? null) : null));
}

export async function participantPhone(viewerId: string, otherId: string | null | undefined, status: ActivityStatus, db: Db = prisma) {
  return (await participantPhones(viewerId, [{ otherId, status }], db))[0]!;
}
