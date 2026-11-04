import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env.js";
import { rules } from "../config/rules.js";

// Short-lived links to private files: documents for authorised admins only,
// profile photos for the owner and admins (A7). The link itself is the
// permission, so it is short-lived and never logged.

const key = new TextEncoder().encode(env.FILE_SIGNING_SECRET);
const ISSUER = "unigo";
const AUDIENCE = "unigo-private-file";

// The url is a path on the API origin, like every other endpoint.
// `lifetime` is longer only for profile photos (rules.profile.photo).
export async function signPrivateFileUrl(fileKey: string, now = Date.now(), lifetime: number = rules.privateFiles.signedUrlLifetime) {
  const expiresAt = new Date(now + lifetime);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(fileKey)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(expiresAt)
    .sign(key);
  return { url: `/api/files/${token}`, expiresAt };
}

// The file key the token was signed for, or null when it is invalid or expired.
export async function verifyPrivateFileToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
