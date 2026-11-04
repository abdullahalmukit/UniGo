import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

// Stands in for Google's signing keys, so tests never call Google.
const trusted = await generateKeyPair("RS256");
const untrusted = await generateKeyPair("RS256");

export const testGoogleKeySet = createLocalJWKSet({
  keys: [{ ...(await exportJWK(trusted.publicKey)), kid: "test-key", alg: "RS256", use: "sig" }],
});

export const TEST_GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";

type Claims = { sub: string; email: string; email_verified?: boolean | string; name?: string };

export function googleIdToken(
  claims: Claims,
  options: { audience?: string; issuer?: string; expiresAt?: Date; untrustedKey?: boolean } = {},
) {
  return new SignJWT({ email_verified: true, name: "Google User", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer ?? "https://accounts.google.com")
    .setAudience(options.audience ?? TEST_GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000))
    .sign(options.untrustedKey ? untrusted.privateKey : trusted.privateKey);
}
