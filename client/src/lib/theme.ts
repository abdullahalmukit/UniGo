// Light / Dark / System, Light by default (A5a polish). The choice is kept in
// localStorage until A7 saves it to the account; the script in index.html
// applies it before the first paint.
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "unigo.theme";
export const DEFAULT_THEME: ThemeChoice = "light";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// The browser bar colour follows the top bar (--color-surface).
const BROWSER_BAR_COLOUR: Record<ResolvedTheme, string> = { light: "#FFFFFF", dark: "#131C2E" };

export function readThemeChoice(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): ThemeChoice {
  const saved = storage?.getItem(THEME_STORAGE_KEY);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : DEFAULT_THEME;
}

export function resolveTheme(choice: ThemeChoice, systemIsDark: boolean): ResolvedTheme {
  if (choice === "system") return systemIsDark ? "dark" : "light";
  return choice;
}

export function systemIsDark() {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

export function applyTheme(choice: ThemeChoice) {
  const resolved = resolveTheme(choice, systemIsDark());
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BROWSER_BAR_COLOUR[resolved]);
}

export function saveThemeChoice(choice: ThemeChoice) {
  safeStorage()?.setItem(THEME_STORAGE_KEY, choice);
  applyTheme(choice);
}

// Calls back when the device switches between light and dark.
export function onSystemThemeChange(callback: () => void) {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function safeStorage() {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
