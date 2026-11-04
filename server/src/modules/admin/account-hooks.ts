import type { Prisma } from "../../generated/prisma/client.js";

// Runs when a user is restricted, suspended or banned (proposal section 17.1):
// their OPEN posts are closed and the other participants of their accepted
// activities are notified. Activities arrive in B2/B3, which fill this in;
// until then there is nothing to close.
export async function onAccountLocked(_db: Prisma.TransactionClient, _userId: string) {}
