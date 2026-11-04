import { createRemoteJWKSet } from "jose";

// Google's public keys for ID tokens, fetched and cached by jose.
// Kept in its own module so tests can swap in a local key set.
export const googleKeySet = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
