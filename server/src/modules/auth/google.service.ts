import { jwtVerify } from "jose";
import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { assertCanAccess, effectiveAccountStatus } from "./account-status.js";
import {
  assertEmailAndPhoneFree,
  assertUniversityOpen,
  createAccount,
  invalidCredentials,
  openSession,
  type SessionMeta,
} from "./auth.service.js";
import type { GoogleLinkInput, GoogleRegisterInput } from "./auth.validation.js";
import { googleKeySet } from "./google-keys.js";
import { verifyPassword } from "./password.js";
import { signGoogleStepToken, verifyGoogleStepToken } from "./tokens.js";

type Session = Awaited<ReturnType<typeof openSession>>;

export type GoogleSignInResult =
  | { kind: "session"; session: Session }
  | { kind: "needsRegistration"; signupToken: string; email: string; name: string };

// POST /api/auth/google. Signs in a linked account, asks for the password once
// before linking an existing password account (A4 decision), or hands back a
// signup token when no account uses this email yet.
export async function signInWithGoogle(idToken: string, meta: SessionMeta): Promise<GoogleSignInResult> {
  const google = await verifyGoogleIdToken(idToken);

  const linked = await prisma.user.findUnique({
    where: { googleId: google.googleId },
    select: { id: true, accountStatus: true, suspendedUntil: true },
  });
  if (linked) {
    assertCanAccess(effectiveAccountStatus(linked));
    return { kind: "session", session: await openSession(linked.id, meta, { recordLogin: true }) };
  }

  const sameEmail = await prisma.user.findUnique({
    where: { email: google.email },
    select: { id: true, googleId: true },
  });
  if (sameEmail?.googleId) throw googleAccountConflict();
  if (sameEmail) {
    // Nobody ever proved the email of a password account, so the password is
    // asked once before linking. Without it, use Forgot password.
    const linkToken = await signGoogleStepToken(
      "google-link",
      { googleId: google.googleId, email: google.email, userId: sameEmail.id },
      rules.google.linkTokenLifetime,
    );
    throw new AppError(409, "GOOGLE_LINK_REQUIRES_PASSWORD", "Enter your UniGo password once to link Google sign-in", {
      data: { linkToken, email: google.email },
    });
  }

  const signupToken = await signGoogleStepToken(
    "google-signup",
    { googleId: google.googleId, email: google.email, name: google.name },
    rules.google.signupTokenLifetime,
  );
  return { kind: "needsRegistration", signupToken, email: google.email, name: google.name };
}

// POST /api/auth/google/register: a new account with no password, linked to Google.
export async function registerWithGoogle(input: GoogleRegisterInput, meta: SessionMeta) {
  const google = await verifyGoogleStepToken("google-signup", input.signupToken);
  await assertUniversityOpen(input.universityId);
  await assertEmailAndPhoneFree(google.email, input.phone);
  if (await prisma.user.findUnique({ where: { googleId: google.googleId }, select: { id: true } })) {
    throw googleAccountConflict();
  }

  const userId = await createAccount({
    name: input.name,
    phone: input.phone,
    email: google.email,
    universityId: input.universityId,
    googleId: google.googleId,
    language: input.language,
    theme: input.theme,
  }).catch(rethrowGoogleIdTaken);
  return openSession(userId, meta);
}

// POST /api/auth/google/link: proves the password once, then links Google.
export async function linkGoogle(input: GoogleLinkInput, meta: SessionMeta) {
  const google = await verifyGoogleStepToken("google-link", input.linkToken);
  const user = await prisma.user.findUnique({
    where: { id: google.userId ?? "" },
    select: { id: true, email: true, googleId: true, passwordHash: true, accountStatus: true, suspendedUntil: true },
  });

  if (!user?.passwordHash || user.email !== google.email || !(await verifyPassword(input.password, user.passwordHash))) {
    throw invalidCredentials();
  }
  if (user.googleId && user.googleId !== google.googleId) throw googleAccountConflict();
  assertCanAccess(effectiveAccountStatus(user));

  await prisma.user
    .update({ where: { id: user.id }, data: { googleId: google.googleId } })
    .catch(rethrowGoogleIdTaken);
  return openSession(user.id, meta, { recordLogin: true });
}

// Checks the ID token against Google's keys, our client ID and a verified email.
async function verifyGoogleIdToken(idToken: string) {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleKeySet, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new AppError(401, "INVALID_GOOGLE_TOKEN", "Google sign-in failed. Try again");
  }

  if (!payload.sub || typeof payload.email !== "string") {
    throw new AppError(401, "INVALID_GOOGLE_TOKEN", "Google sign-in failed. Try again");
  }
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw new AppError(403, "GOOGLE_EMAIL_NOT_VERIFIED", "Your Google email address is not verified");
  }

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : "",
  };
}

function googleAccountConflict() {
  return new AppError(409, "GOOGLE_ACCOUNT_CONFLICT", "This account is already linked to a different Google account");
}

// Two requests linked the same Google account at the same moment.
function rethrowGoogleIdTaken(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw googleAccountConflict();
  }
  throw error;
}
