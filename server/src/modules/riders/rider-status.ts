import type { Prisma } from "../../generated/prisma/client.js";
import { dateOnly, dateOnlyString, dhakaDateString } from "../../utils/time.js";

// Shared rules about a rider's state (B1 decisions 6-8).

// The current licence expiry: the latest expiry among the rider's approved
// applications (a re-verification must bring a later one). Null if none.
export async function currentLicenceExpiry(db: Prisma.TransactionClient, userId: string) {
  const row = await db.riderApplication.findFirst({
    where: { userId, status: "APPROVED" },
    orderBy: { licenceExpiresOn: "desc" },
    select: { licenceExpiresOn: true },
  });
  return row ? dateOnlyString(row.licenceExpiresOn) : null;
}

// A licence is valid through the whole of its expiry day in Asia/Dhaka.
export const licenceExpired = (expiresOn: string | null, now = new Date()) => !expiresOn || expiresOn < dhakaDateString(now);

// Approved applications whose licence is still valid today, for queries.
export const validLicenceFilter = (now = new Date()) =>
  ({ status: "APPROVED", licenceExpiresOn: { gte: dateOnly(dhakaDateString(now)) } }) satisfies Prisma.RiderApplicationWhereInput;

// A rider suspension with no end date lasts until a Super Admin reinstates.
export const riderSuspensionInForce = (
  user: { riderSuspended: boolean; riderSuspendedUntil: Date | null },
  now = new Date(),
) => user.riderSuspended && (!user.riderSuspendedUntil || user.riderSuspendedUntil > now);

export type ActiveBlocker =
  | "NOT_A_RIDER"
  | "NOT_VERIFIED"
  | "ACCOUNT_RESTRICTED"
  | "RIDER_SUSPENDED"
  | "LICENCE_EXPIRED";

// Why the rider cannot switch Active now, or null when they can.
export function activeBlocker(
  user: {
    isVerifiedRider: boolean;
    studentVerificationStatus: string;
    accountStatus: string;
    riderSuspended: boolean;
    riderSuspendedUntil: Date | null;
  },
  licenceExpiresOn: string | null,
  now = new Date(),
): ActiveBlocker | null {
  if (!user.isVerifiedRider) return "NOT_A_RIDER";
  if (user.studentVerificationStatus !== "VERIFIED") return "NOT_VERIFIED";
  if (user.accountStatus !== "ACTIVE") return "ACCOUNT_RESTRICTED";
  if (riderSuspensionInForce(user, now)) return "RIDER_SUSPENDED";
  if (licenceExpired(licenceExpiresOn, now)) return "LICENCE_EXPIRED";
  return null;
}
