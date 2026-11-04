import type { Prisma } from "../../generated/prisma/client.js";

// Runs when a user is restricted, suspended or banned (proposal section 17.1).
// The rider is set Inactive (B1 decision 7), so they leave matching at once.
// Closing their OPEN posts and notifying the other participants of their
// accepted activities is added in B2/B3, when activities exist.
export async function onAccountLocked(db: Prisma.TransactionClient, userId: string) {
  await db.user.updateMany({ where: { id: userId, riderActive: true }, data: { riderActive: false } });
}
