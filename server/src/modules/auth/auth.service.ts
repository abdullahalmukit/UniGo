import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { accountStatusSelect, assertCanAccess, effectiveAccountStatus } from "./account-status.js";
import type { LoginInput, RegisterInput } from "./auth.validation.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "./password.js";
import { photoLink } from "../users/photo.js";
import { hashToken, invalidRefreshToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "./tokens.js";

export type SessionMeta = { userAgent?: string; ipAddress?: string };

// The caller's own account. passwordHash, googleId and the photo key are read
// only to answer hasPassword, hasGoogle and photo; they are never returned.
const meSelect = {
  passwordHash: true,
  googleId: true,
  id: true,
  email: true,
  phone: true,
  role: true,
  ...accountStatusSelect,
  studentVerificationStatus: true,
  isVerifiedRider: true,
  riderActive: true,
  language: true,
  theme: true,
  pushEnabled: true,
  emailNotificationsEnabled: true,
  createdAt: true,
  university: { select: { id: true, name: true, shortName: true } },
  profile: {
    select: { fullName: true, photoKey: true, studentIdNumber: true, department: true, batch: true, location: true },
  },
} satisfies Prisma.UserSelect;

export async function register(input: RegisterInput, meta: SessionMeta) {
  const { password, ...account } = input;
  await assertUniversityOpen(account.universityId);
  await assertEmailAndPhoneFree(account.email, account.phone);

  const userId = await createAccount({ ...account, passwordHash: await hashPassword(password) });
  return openSession(userId, meta);
}

// Creates the user and profile. Password accounts pass passwordHash; Google
// accounts pass googleId instead.
export async function createAccount(account: {
  name: string;
  phone: string;
  email: string;
  universityId: string;
  passwordHash?: string;
  googleId?: string;
  language?: "BN" | "EN";
  theme?: "LIGHT" | "DARK" | "SYSTEM";
}) {
  try {
    const user = await prisma.user.create({
      data: {
        email: account.email,
        phone: account.phone,
        passwordHash: account.passwordHash,
        googleId: account.googleId,
        universityId: account.universityId,
        language: account.language,
        theme: account.theme,
        profile: { create: { fullName: account.name } },
      },
      select: { id: true },
    });
    return user.id;
  } catch (error) {
    // Someone registered the same email or phone between the check and the insert.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await assertEmailAndPhoneFree(account.email, account.phone);
    }
    throw error;
  }
}

export async function assertUniversityOpen(universityId: string) {
  const university = await prisma.university.findUnique({ where: { id: universityId }, select: { isActive: true } });
  if (!university?.isActive) {
    throw new AppError(400, "UNIVERSITY_NOT_FOUND", "Choose a university from the list");
  }
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, ...accountStatusSelect },
  });

  // Unknown email, Google-only account and wrong password all look the same.
  if (!user?.passwordHash) {
    await burnPasswordCheck(input.password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw invalidCredentials();
  }

  // Checked after the password, so the status is never shown to a stranger.
  assertCanAccess(effectiveAccountStatus(user));

  return openSession(user.id, meta, { recordLogin: true });
}

// Starts a new session family and returns it with the caller's account.
export async function openSession(userId: string, meta: SessionMeta, options: { recordLogin?: boolean } = {}) {
  if (options.recordLogin) {
    await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  }
  const session = await startSession(prisma, userId, meta);
  return { ...session, user: await getMe(userId) };
}

// Rotates the refresh token. Presenting a token that was already rotated or
// revoked is treated as theft: the whole session family is revoked.
export async function refresh(token: string, meta: SessionMeta) {
  const claims = await verifyRefreshToken(token);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
  const now = new Date();

  if (!stored || stored.userId !== claims.userId || stored.familyId !== claims.familyId) {
    throw invalidRefreshToken();
  }
  if (stored.revokedAt) {
    await revokeFamily(stored.familyId);
    throw invalidRefreshToken();
  }
  if (stored.expiresAt <= now) throw invalidRefreshToken();

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: { ...accountStatusSelect },
  });
  if (!user) throw invalidRefreshToken();
  assertCanAccess(effectiveAccountStatus(user));

  const session = await prisma.$transaction(async (tx) => {
    // Only one request can rotate a given token.
    const rotated = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (rotated.count === 0) return null;
    return startSession(tx, stored.userId, meta, stored.familyId);
  });

  if (!session) {
    await revokeFamily(stored.familyId);
    throw invalidRefreshToken();
  }
  return { ...session, user: await getMe(stored.userId) };
}

// Ends this session. Never fails: an unknown or expired token has nothing to end.
export async function logout(token: string | undefined) {
  if (!token) return;
  try {
    await verifyRefreshToken(token);
  } catch {
    return;
  }
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// Ends every session: refresh tokens are revoked and access tokens issued
// up to now stop working at once (users.tokensValidAfter).
export async function logoutAll(userId: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.user.update({ where: { id: userId }, data: { tokensValidAfter: now } }),
  ]);
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });
  if (!user) throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
  const { passwordHash, googleId, profile, ...rest } = user;
  const { photoKey, ...profileFields } = profile ?? { photoKey: null };
  return {
    ...rest,
    accountStatus: effectiveAccountStatus(user),
    // Google-only accounts set a first password through an emailed link (A7).
    hasPassword: passwordHash !== null,
    hasGoogle: googleId !== null,
    profile: profile ? profileFields : null,
    photo: await photoLink(photoKey),
  };
}

async function startSession(
  db: Prisma.TransactionClient,
  userId: string,
  meta: SessionMeta,
  familyId: string = randomUUID(),
) {
  const refreshToken = await signRefreshToken(userId, familyId);
  await db.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: refreshToken.tokenHash,
      expiresAt: refreshToken.expiresAt,
      userAgent: meta.userAgent?.slice(0, 255),
      ipAddress: meta.ipAddress?.slice(0, 45),
    },
  });
  const accessToken = await signAccessToken(userId);

  return {
    accessToken: accessToken.token,
    accessTokenExpiresAt: accessToken.expiresAt,
    refreshToken: refreshToken.token,
    refreshTokenExpiresAt: refreshToken.expiresAt,
  };
}

async function revokeFamily(familyId: string) {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function assertEmailAndPhoneFree(email: string, phone: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { phone }] },
    select: { email: true, phone: true },
  });
  if (existing?.email === email) throw new AppError(409, "EMAIL_TAKEN", "This email is already registered");
  if (existing) throw new AppError(409, "PHONE_TAKEN", "This phone number is already registered");
}

export function invalidCredentials() {
  return new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
}
