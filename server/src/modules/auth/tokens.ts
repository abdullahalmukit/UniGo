import { createHash, randomUUID } from "node:crypto";
import { errors, jwtVerify, SignJWT } from "jose";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/app-error.js";

const ISSUER = "unigo";
const ACCESS_AUDIENCE = "unigo-api";
const REFRESH_AUDIENCE = "unigo-refresh";

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

// Access token: proves who the caller is for 15 minutes. Holds only the user id;
// role and status are read from the database on every request. `iat` keeps
// milliseconds (allowed by RFC 7519) so users.tokensValidAfter can cut off
// tokens precisely, without refusing a login made in the same second.
export async function signAccessToken(userId: string) {
  const now = Date.now();
  const expiresAt = new Date(now + env.JWT_ACCESS_EXPIRES_IN);
  const token = await new SignJWT({ iat: now / 1000 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(ACCESS_AUDIENCE)
    .setExpirationTime(expiresAt)
    .sign(accessKey);

  return { token, expiresAt };
}

// Returns the user id and the issue time as a Date (millisecond precision).
export async function verifyAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.iat !== "number") throw new Error("Missing claims");
    return { userId: payload.sub, issuedAt: new Date(Math.round(payload.iat * 1000)) };
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new AppError(401, "TOKEN_EXPIRED", "Your session has expired");
    }
    throw new AppError(401, "UNAUTHENTICATED", "Log in to continue");
  }
}

// Refresh token: one per session row in refresh_tokens, which stores only its hash.
// `fam` is the session family that every rotation keeps.
export async function signRefreshToken(userId: string, familyId: string) {
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_IN);
  const token = await new SignJWT({ fam: familyId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuer(ISSUER)
    .setAudience(REFRESH_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(refreshKey);

  return { token, tokenHash: hashToken(token), expiresAt };
}

export async function verifyRefreshToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, refreshKey, {
      issuer: ISSUER,
      audience: REFRESH_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.fam !== "string") throw new Error("Missing claims");
    return { userId: payload.sub, familyId: payload.fam };
  } catch {
    throw invalidRefreshToken();
  }
}

// Short-lived tokens that carry a verified Google identity from POST /google to
// the next step. Each purpose has its own audience, so neither works as an
// access token or as the other.
type GoogleStep = "google-signup" | "google-link";
export type GoogleStepClaims = { googleId: string; email: string; name?: string; userId?: string };

export async function signGoogleStepToken(step: GoogleStep, claims: GoogleStepClaims, lifetime: number) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(`unigo-${step}`)
    .setIssuedAt()
    .setExpirationTime(new Date(Date.now() + lifetime))
    .sign(accessKey);
}

export async function verifyGoogleStepToken(step: GoogleStep, token: string): Promise<GoogleStepClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: ISSUER,
      audience: `unigo-${step}`,
      algorithms: ["HS256"],
    });
    if (typeof payload.googleId !== "string" || typeof payload.email !== "string") throw new Error("Missing claims");
    return {
      googleId: payload.googleId,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      userId: typeof payload.userId === "string" ? payload.userId : undefined,
    };
  } catch {
    throw new AppError(401, "INVALID_GOOGLE_STEP_TOKEN", "Start Google sign-in again");
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function invalidRefreshToken() {
  return new AppError(401, "INVALID_REFRESH_TOKEN", "Log in again");
}
