import { z } from "zod";
import { rules } from "../../config/rules.js";
import type { AccountStatus, ModerationActionType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { accountStatusSelect, effectiveAccountStatus } from "../auth/account-status.js";
import type { AccountEmailKind } from "../email/account-status-templates.js";
import { notify } from "../notifications/notify.service.js";
import { runInBackground } from "../../utils/background.js";
import { afterAccountLocked, onAccountLocked } from "./account-hooks.js";
import { recordAudit } from "./audit-log.js";

// User Account Management actions (proposal section 17.1, A8 decisions). Super
// Admin only. Each action needs a reason, is written to the user's moderation
// history and the Audit Log in one transaction, and is emailed to the user.

export type AccountAction = "warn" | "restrict" | "suspend" | "ban" | "unban" | "reactivate";

const { minLength, maxLength } = rules.admin.reason;
const reason = z
  .string()
  .trim()
  .min(minLength, `Give a reason of at least ${minLength} characters`)
  .max(maxLength, `The reason must be at most ${maxLength} characters`);
const date = z.coerce.date();

export const actionSchemas = {
  warn: z.object({ reason }),
  restrict: z.object({ reason, endsAt: date.nullish() }),
  suspend: z.object({ reason, startsAt: date.nullish(), endsAt: date }),
  ban: z.object({ reason }),
  unban: z.object({ reason }),
  reactivate: z.object({ reason }),
} satisfies Record<AccountAction, z.ZodType>;

export type ActionInput = { reason: string; startsAt?: Date | null; endsAt?: Date | null };

const TYPES: Record<AccountAction, ModerationActionType> = {
  warn: "WARN",
  restrict: "RESTRICT",
  suspend: "SUSPEND",
  ban: "BAN",
  unban: "UNBAN",
  reactivate: "REACTIVATE",
};

// The effective statuses each action can start from.
const ALLOWED_FROM: Record<AccountAction, AccountStatus[]> = {
  warn: ["ACTIVE", "RESTRICTED", "SUSPENDED"],
  restrict: ["ACTIVE", "RESTRICTED"],
  suspend: ["ACTIVE", "RESTRICTED", "SUSPENDED"],
  ban: ["ACTIVE", "RESTRICTED", "SUSPENDED"],
  unban: ["BANNED"],
  reactivate: ["RESTRICTED", "SUSPENDED"],
};

type Period = { suspendedFrom: Date | null; suspendedUntil: Date | null; restrictedUntil: Date | null };
type StoredStatus = Period & { accountStatus: AccountStatus };

export async function applyAccountAction(
  adminId: string,
  userId: string,
  action: AccountAction,
  input: ActionInput,
  ipAddress?: string,
  now = new Date(),
) {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, language: true, profile: { select: { fullName: true } }, ...accountStatusSelect },
    });
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    if (user.id === adminId) throw new AppError(403, "CANNOT_MODERATE_SELF", "You cannot moderate your own account");
    if (user.role === "SUPER_ADMIN") throw new AppError(403, "CANNOT_MODERATE_ADMIN", "Super Admin accounts cannot be moderated");

    const before: StoredStatus = {
      accountStatus: user.accountStatus,
      suspendedFrom: user.suspendedFrom,
      suspendedUntil: user.suspendedUntil,
      restrictedUntil: user.restrictedUntil,
    };
    const current = effectiveAccountStatus(before, now);
    const scheduledSuspension = !!before.suspendedFrom && before.suspendedFrom > now;
    const canReactivateSchedule = action === "reactivate" && scheduledSuspension;
    if (!ALLOWED_FROM[action].includes(current) && !canReactivateSchedule) {
      throw new AppError(409, "INVALID_STATUS_CHANGE", `This action is not possible for a ${current} account`, {
        data: { accountStatus: current },
      });
    }

    const next = nextStatus(action, before, input, now);
    if (next) {
      // Conditional on what was read, so two admins acting at once cannot both apply.
      const updated = await tx.user.updateMany({ where: { id: userId, ...before }, data: next });
      if (updated.count === 0) throw new AppError(409, "STATUS_CHANGED", "This account changed meanwhile. Reload and try again.");
    }
    const after = { ...before, ...next };
    const newStatus = action === "suspend" ? "SUSPENDED" : effectiveAccountStatus(after, now);
    const period = actionPeriod(action, after);

    const moderation = await tx.moderationAction.create({
      select: { id: true },
      data: {
        userId,
        adminId,
        type: TYPES[action],
        reason: input.reason,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        previousStatus: current,
        newStatus,
      },
    });
    await recordAudit(tx, {
      adminId,
      action: `USER_${TYPES[action]}`,
      targetType: "user",
      targetId: userId,
      targetUserId: userId,
      oldValue: snapshot(before, current),
      newValue: { ...snapshot(after, newStatus), reason: input.reason },
      ipAddress,
    });

    // Restrict, ban and a suspension that has started close the user's OPEN posts.
    const locks = action === "restrict" || action === "ban" || (action === "suspend" && effectiveAccountStatus(after, now) === "SUSPENDED");
    const locked = locks ? await onAccountLocked(tx, userId, { type: "ADMIN", id: adminId }, now) : null;

    return { user, period, newStatus, locked, moderationId: moderation.id };
  });

  if (result.locked) await afterAccountLocked(userId, result.locked, result.newStatus);

  // In-app and email, always sent (proposal section 14, B2c)
  runInBackground(`account ${action} notification`, () =>
    notify({
      type: "ACCOUNT_STATUS_CHANGED",
      userIds: [userId],
      dedupeKey: `ACCOUNT_STATUS_CHANGED:${result.moderationId}`,
      data: {
        kind: action.toUpperCase() as AccountEmailKind,
        reason: input.reason,
        startsAt: result.period.startsAt?.toISOString(),
        endsAt: result.period.endsAt?.toISOString(),
      },
    }),
  );

  return { accountStatus: result.newStatus, ...result.period };
}

// The stored columns after the action, or null when nothing changes (warn).
function nextStatus(action: AccountAction, before: StoredStatus, input: ActionInput, now: Date): StoredStatus | null {
  const cleared: Period = { suspendedFrom: null, suspendedUntil: null, restrictedUntil: null };

  switch (action) {
    case "warn":
      return null;
    case "restrict": {
      if (input.endsAt && input.endsAt <= now) throw badDates("The end date must be in the future");
      // A suspension booked for later stays booked.
      const keep = before.suspendedFrom && before.suspendedFrom > now ? { suspendedFrom: before.suspendedFrom, suspendedUntil: before.suspendedUntil } : {};
      return { ...cleared, ...keep, accountStatus: "RESTRICTED", restrictedUntil: input.endsAt ?? null };
    }
    case "suspend": {
      const startsAt = input.startsAt ?? now;
      if (startsAt.getTime() < now.getTime() - rules.admin.suspensionStartTolerance) {
        throw badDates("The start date cannot be in the past");
      }
      const endsAt = input.endsAt!;
      if (endsAt <= startsAt || endsAt <= now) throw badDates("The end date must be after the start date");
      // A suspension that starts later keeps the current status until then
      // (A8 decision 1); the account-status job starts it on time.
      if (startsAt > now) return { ...before, suspendedFrom: startsAt, suspendedUntil: endsAt };
      return { ...cleared, accountStatus: "SUSPENDED", suspendedFrom: startsAt, suspendedUntil: endsAt };
    }
    case "ban":
      return { ...cleared, accountStatus: "BANNED" };
    case "unban":
    case "reactivate":
      return { ...cleared, accountStatus: "ACTIVE" };
  }
}

function actionPeriod(action: AccountAction, after: StoredStatus) {
  if (action === "suspend") return { startsAt: after.suspendedFrom, endsAt: after.suspendedUntil };
  if (action === "restrict") return { startsAt: null, endsAt: after.restrictedUntil };
  return { startsAt: null, endsAt: null };
}

function snapshot(status: StoredStatus, effective: AccountStatus) {
  return {
    accountStatus: effective,
    suspendedFrom: status.suspendedFrom?.toISOString() ?? null,
    suspendedUntil: status.suspendedUntil?.toISOString() ?? null,
    restrictedUntil: status.restrictedUntil?.toISOString() ?? null,
  };
}

const badDates = (message: string) => new AppError(400, "INVALID_DATES", message);
