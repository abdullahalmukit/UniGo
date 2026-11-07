import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { passwordResetEmail } from "../email/templates.js";
import { notify, notifyWithDirectEmail } from "../notifications/notify.service.js";
import { removeAllPushSubscriptions } from "../notifications/notifications.service.js";
import { runInBackground } from "../../utils/background.js";
import { hashPassword } from "./password.js";
import { hashToken } from "./tokens.js";

const lifetime = rules.passwordReset.tokenLifetime;

// Proposal section 4. Runs in the background after the caller has already been
// answered, so the response is the same, in content and timing, whether or not
// the email is registered. Works for Google-only accounts too (first password)
// and for any account status (A4 decision).
export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, language: true, profile: { select: { fullName: true } } },
  });
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const [, created] = await prisma.$transaction([
    // Only the newest link works.
    cancelOpenTokens(prisma, user.id, now),
    prisma.passwordResetToken.create({
      select: { id: true },
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + lifetime) },
    }),
  ]);

  // The token goes in the URL fragment, which browsers never send to a server.
  const resetUrl = `${env.CLIENT_URL}/reset-password#token=${token}`;
  // Sent at once and never stored: the link is single-use (B2c decision).
  await notifyWithDirectEmail({
    type: "PASSWORD_RESET_REQUESTED",
    userId: user.id,
    dedupeKey: `PASSWORD_RESET_REQUESTED:${created.id}`,
    email: {
      to: user.email,
      ...passwordResetEmail(user.language, {
        name: user.profile?.fullName ?? "",
        resetUrl,
        minutes: lifetime / 60_000,
      }),
    },
  });
}

// Sets the new password, ends every session and sends "password changed".
// The token is single-use: claiming it is a conditional update, so two
// simultaneous resets with one link cannot both succeed.
export async function resetPassword(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  const user = await prisma.$transaction(async (tx) => {
    const stored = await tx.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true },
    });
    if (!stored) return null;

    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return null;

    await cancelOpenTokens(tx, stored.userId, now);
    await tx.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: now } });

    return tx.user.update({
      where: { id: stored.userId },
      data: { passwordHash, passwordChangedAt: now, tokensValidAfter: now },
      select: { id: true },
    });
  });

  if (!user) {
    throw new AppError(400, "INVALID_RESET_TOKEN", "This reset link is invalid or has expired");
  }

  // Every session ended, so no device keeps receiving pushes (B2c).
  await removeAllPushSubscriptions(user.id);
  sendPasswordChanged(user.id, now);
}

// "Password changed" email, always sent (proposal section 14).
export function sendPasswordChanged(userId: string, at: Date) {
  runInBackground("password changed notification", () =>
    notify({ type: "PASSWORD_CHANGED", userIds: [userId], dedupeKey: `PASSWORD_CHANGED:${userId}:${at.getTime()}` }),
  );
}

function cancelOpenTokens(db: Prisma.TransactionClient, userId: string, now: Date) {
  return db.passwordResetToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
}
