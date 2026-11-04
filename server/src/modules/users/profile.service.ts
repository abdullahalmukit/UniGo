import { Prisma } from "../../generated/prisma/client.js";
import { deletePrivateFile, putPrivateFile } from "../../lib/private-storage.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { runInBackground } from "../../utils/background.js";
import { getMe, openSession, type SessionMeta } from "../auth/auth.service.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { requestPasswordReset } from "../auth/password-reset.service.js";
import { sendEmailInBackground } from "../email/email.service.js";
import { passwordChangedEmail } from "../email/templates.js";
import { processProfilePhoto } from "./photo.js";
import type { ChangePasswordInput, UpdatePreferencesInput, UpdateProfileInput } from "./users.validation.js";

// The user's own profile and settings (proposal section 5, A7). Every function
// returns the caller's account in the /auth/me shape, so the client can replace
// what it holds.

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const { name, phone, ...fields } = input;
  if (phone) await assertPhoneFree(userId, phone);

  const profileFields = { ...fields, ...(name !== undefined && { fullName: name }) };
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(phone && { phone }),
        ...(Object.keys(profileFields).length > 0 && {
          profile: {
            upsert: {
              create: { fullName: name ?? "", ...fields },
              update: profileFields,
            },
          },
        }),
      },
    });
  } catch (error) {
    // Another account took this phone between the check and the update.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw phoneTaken();
    throw error;
  }
  return getMe(userId);
}

// Stores the re-encoded photo, then removes the previous file.
export async function setProfilePhoto(userId: string, upload: Uint8Array) {
  const photo = await processProfilePhoto(upload);
  const key = await putPrivateFile("profile-photos", photo, "image/jpeg");

  let previous: string | null = null;
  try {
    previous = await prisma.$transaction(async (tx) => {
      const profile = await tx.profile.findUnique({ where: { userId }, select: { photoKey: true } });
      if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found");
      await tx.profile.update({ where: { userId }, data: { photoKey: key } });
      return profile.photoKey;
    });
  } catch (error) {
    await deletePrivateFile(key);
    throw error;
  }

  if (previous) await deletePrivateFile(previous);
  return getMe(userId);
}

export async function removeProfilePhoto(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { photoKey: true } });
  if (profile?.photoKey) {
    await prisma.profile.update({ where: { userId }, data: { photoKey: null } });
    await deletePrivateFile(profile.photoKey);
  }
  return getMe(userId);
}

// Changes the password with the current one (A7 decision 3). Every session ends,
// including this one, and a new session is returned for this device, so the
// other devices are logged out and this one is not.
export async function changePassword(userId: string, input: ChangePasswordInput, meta: SessionMeta) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { passwordHash: true, email: true, language: true, profile: { select: { fullName: true } } },
  });
  // Google-only accounts set a first password through the emailed link instead.
  if (!user.passwordHash) {
    throw new AppError(409, "NO_PASSWORD_SET", "This account has no password yet. Set one through the emailed link");
  }
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, "WRONG_PASSWORD", "The current password is incorrect", {
      fields: { currentPassword: ["The current password is incorrect"] },
    });
  }

  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();
  await prisma.$transaction([
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: now, tokensValidAfter: now },
    }),
  ]);

  // Tokens issued at or before tokensValidAfter are refused, so the new one
  // must carry a later millisecond.
  while (Date.now() <= now.getTime()) await new Promise((resolve) => setTimeout(resolve, 1));
  const session = await openSession(userId, meta);

  sendEmailInBackground("password changed", {
    to: user.email,
    ...passwordChangedEmail(user.language, { name: user.profile?.fullName ?? "" }),
  });
  return session;
}

// A Google-only account's first password: the same single-use emailed link as
// Forgot password (A4), which proves the person owns the email (A7 decision 4).
export async function requestPasswordSetupLink(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, passwordHash: true } });
  if (user.passwordHash) {
    throw new AppError(409, "PASSWORD_ALREADY_SET", "This account already has a password. Use Change password");
  }
  runInBackground("password setup link", () => requestPasswordReset(user.email));
}

export async function updatePreferences(userId: string, input: UpdatePreferencesInput) {
  await prisma.user.update({ where: { id: userId }, data: input });
  return getMe(userId);
}

async function assertPhoneFree(userId: string, phone: string) {
  const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== userId) throw phoneTaken();
}

function phoneTaken() {
  return new AppError(409, "PHONE_TAKEN", "This phone number is already registered", {
    fields: { phone: ["This phone number is already registered"] },
  });
}
