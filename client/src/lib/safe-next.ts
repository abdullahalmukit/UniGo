// Where to go after logging in. Only paths on this site are followed, so a link
// such as /login?next=https://evil.example cannot send people elsewhere, and
// never back to an auth page.
const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

export function safeNext(raw: string | null | undefined, fallback = "/") {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (AUTH_PATHS.some((path) => raw === path || raw.startsWith(`${path}/`) || raw.startsWith(`${path}?`))) {
    return fallback;
  }
  return raw;
}
