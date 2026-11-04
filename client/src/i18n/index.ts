import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bn from "./bn.json";
import en from "./en.json";

export type AppLanguage = "en" | "bn";

export const LANGUAGE_STORAGE_KEY = "unigo.language";

// A language the user picked, else the browser's list (any "bn…" means Bangla),
// else English. A7 saves the choice to the account.
export function detectLanguage(saved: string | null | undefined, browserLanguages: readonly string[]): AppLanguage {
  if (saved === "en" || saved === "bn") return saved;
  return browserLanguages.some((language) => language.toLowerCase().startsWith("bn")) ? "bn" : "en";
}

export function setLanguage(language: AppLanguage) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this tab only.
  }
  void i18n.changeLanguage(language);
}

function savedLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function browserLanguages() {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

i18n.on("languageChanged", (language) => {
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: detectLanguage(savedLanguage(), browserLanguages()),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export { i18n };
