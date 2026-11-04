import { useEffect, useRef, useSyncExternalStore } from "react";
import { session } from "../lib/api";
import { setLanguage } from "../i18n";
import type { SessionManager } from "../lib/session";

export function useSession(manager: SessionManager = session) {
  return useSyncExternalStore(manager.subscribe, manager.getState);
}

// When a session starts, the account's saved language and theme win (A5a
// decision). Applied once per user, so a change made afterwards in this tab stays.
export function useAccountPreferences(onThemeChange: (theme: "light" | "dark" | "system") => void) {
  const state = useSession();
  const appliedFor = useRef<string | null>(null);

  useEffect(() => {
    if (state.status !== "authenticated") {
      appliedFor.current = null;
      return;
    }
    const { user } = state.session;
    if (appliedFor.current === user.id) return;
    appliedFor.current = user.id;

    if (user.language) setLanguage(user.language === "BN" ? "bn" : "en");
    if (user.theme) onThemeChange(user.theme.toLowerCase() as "light" | "dark" | "system");
  }, [state, onThemeChange]);
}
