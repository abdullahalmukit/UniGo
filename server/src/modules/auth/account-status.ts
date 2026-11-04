import type { AccountStatus } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";

// Until the A8 suspension-end job exists, a suspension whose end date has passed
// counts as ACTIVE. The stored status is not changed here, so A8 can still
// notify the user and write the audit record when it ends the suspension.
export function effectiveAccountStatus(
  user: { accountStatus: AccountStatus; suspendedUntil: Date | null },
  now = new Date(),
): AccountStatus {
  if (user.accountStatus === "SUSPENDED" && user.suspendedUntil && user.suspendedUntil <= now) {
    return "ACTIVE";
  }
  return user.accountStatus;
}

// SUSPENDED and BANNED accounts cannot use the app at all.
export function assertCanAccess(status: AccountStatus) {
  if (status === "SUSPENDED") throw new AppError(403, "ACCOUNT_SUSPENDED", "This account is suspended");
  if (status === "BANNED") throw new AppError(403, "ACCOUNT_BANNED", "This account is banned");
}
