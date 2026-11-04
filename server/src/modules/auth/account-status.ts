import type { AccountStatus } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";

// The user columns the effective status is worked out from. Spread into every
// select that calls effectiveAccountStatus.
export const accountStatusSelect = {
  accountStatus: true,
  suspendedFrom: true,
  suspendedUntil: true,
  restrictedUntil: true,
} as const;

export type AccountStatusFields = {
  accountStatus: AccountStatus;
  suspendedUntil: Date | null;
  suspendedFrom?: Date | null;
  restrictedUntil?: Date | null;
};

// The status that applies right now. The account-status job (A8) writes the
// same result to the database within a minute; until then these dates decide:
// - a suspension whose end has passed counts as ACTIVE (A3 decision 7);
// - a suspension that starts later applies from its start date (A8 decision 1);
// - a restriction whose end date has passed counts as ACTIVE (A8 decision 2).
export function effectiveAccountStatus(user: AccountStatusFields, now = new Date()): AccountStatus {
  const { accountStatus, suspendedFrom, suspendedUntil, restrictedUntil } = user;

  if (accountStatus === "BANNED") return "BANNED";
  if (accountStatus === "SUSPENDED") {
    return !suspendedUntil || suspendedUntil > now ? "SUSPENDED" : "ACTIVE";
  }
  // A suspension booked for later that has started.
  if (suspendedFrom && suspendedFrom <= now && suspendedUntil && suspendedUntil > now) return "SUSPENDED";
  if (accountStatus === "RESTRICTED") {
    return restrictedUntil && restrictedUntil <= now ? "ACTIVE" : "RESTRICTED";
  }
  return "ACTIVE";
}

// SUSPENDED and BANNED accounts cannot use the app at all.
export function assertCanAccess(status: AccountStatus) {
  if (status === "SUSPENDED") throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is suspended");
  if (status === "BANNED") throw new AppError(403, "ACCOUNT_BANNED", "This account is banned");
}
