import { i18n } from "../../i18n";
import { api, session } from "../../lib/api";
import { readThemeChoice } from "../../lib/theme";

export type University = { id: string; name: string; shortName: string | null };
type SessionBody = { user: { id: string }; accessToken: string; accessTokenExpiresAt: string };
type NeedsRegistration = { needsRegistration: true; signupToken: string; email: string; name: string };

const post = <T>(path: string, body: unknown) => api<T>(path, { method: "POST", body, auth: false });

// The language and theme this browser uses, saved with a new account (A5b
// decision), so a Bangla browser user is not switched to English on login.
function detectedPreferences() {
  return {
    language: i18n.language === "bn" ? ("BN" as const) : ("EN" as const),
    theme: readThemeChoice().toUpperCase() as "LIGHT" | "DARK" | "SYSTEM",
  };
}

// Every call that returns a session hands it to the session manager, which
// shares it with the other open tabs.
async function signIn(request: Promise<SessionBody>) {
  const body = await request;
  session.signIn(body);
  return body;
}

export function login(email: string, password: string) {
  return signIn(post<SessionBody>("/auth/login", { email, password }));
}

export function register(values: { name: string; email: string; phone: string; universityId: string; password: string }) {
  return signIn(post<SessionBody>("/auth/register", { ...values, ...detectedPreferences() }));
}

// A session, or the details a new Google user still has to give. An existing
// password account answers 409 GOOGLE_LINK_REQUIRES_PASSWORD (thrown as ApiError).
export async function googleSignIn(idToken: string) {
  const body = await post<SessionBody | NeedsRegistration>("/auth/google", { idToken });
  if ("needsRegistration" in body) return body;
  session.signIn(body);
  return null;
}

export function googleRegister(values: { signupToken: string; name: string; phone: string; universityId: string }) {
  return signIn(post<SessionBody>("/auth/google/register", { ...values, ...detectedPreferences() }));
}

export function googleLink(linkToken: string, password: string) {
  return signIn(post<SessionBody>("/auth/google/link", { linkToken, password }));
}

export function forgotPassword(email: string) {
  return post<{ message: string }>("/auth/forgot-password", { email });
}

export function resetPassword(token: string, password: string) {
  return post<null>("/auth/reset-password", { token, password });
}

export async function listUniversities() {
  return (await api<{ universities: University[] }>("/universities", { auth: false })).universities;
}
