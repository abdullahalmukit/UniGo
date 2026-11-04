import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { assertCanAccess, effectiveAccountStatus } from "../modules/auth/account-status.js";
import { verifyAccessToken } from "../modules/auth/tokens.js";
import { AppError } from "../utils/app-error.js";

const authUserSelect = {
  id: true,
  role: true,
  accountStatus: true,
  suspendedUntil: true,
  studentVerificationStatus: true,
  isVerifiedRider: true,
  riderActive: true,
  tokensValidAfter: true,
} as const;

// Verifies the Bearer access token and loads the user fresh from the database,
// so a ban, suspension or role change applies at once. SUSPENDED and BANNED
// accounts are refused here; every other check is a separate middleware.
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) throw unauthenticated();

  const { userId, issuedAt } = await verifyAccessToken(token);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: authUserSelect });
  if (!user) throw unauthenticated();

  // Logged out from all sessions (or password reset) after this token was issued.
  if (user.tokensValidAfter && issuedAt <= user.tokensValidAfter) {
    throw unauthenticated();
  }

  const accountStatus = effectiveAccountStatus(user);
  assertCanAccess(accountStatus);

  req.user = {
    id: user.id,
    role: user.role,
    accountStatus,
    studentVerificationStatus: user.studentVerificationStatus,
    isVerifiedRider: user.isVerifiedRider,
    riderActive: user.riderActive,
  };
  next();
}

export type AuthUser = NonNullable<Request["user"]>;

// For handlers behind `authenticate`.
export function authUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

function unauthenticated() {
  return new AppError(401, "UNAUTHENTICATED", "Log in to continue");
}
