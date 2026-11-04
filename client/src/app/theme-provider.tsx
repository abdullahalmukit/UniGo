import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyTheme,
  onSystemThemeChange,
  readThemeChoice,
  resolveTheme,
  saveThemeChoice,
  systemIsDark,
  type ResolvedTheme,
  type ThemeChoice,
} from "../lib/theme";

type ThemeContextValue = {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readThemeChoice());
  const [dark, setDark] = useState(() => systemIsDark());

  useEffect(() => {
    applyTheme(choice);
  }, [choice, dark]);

  // System follows the device live.
  useEffect(() => onSystemThemeChange(() => setDark(systemIsDark())), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      resolved: resolveTheme(choice, dark),
      setChoice: (next) => {
        saveThemeChoice(next);
        setChoiceState(next);
      },
    }),
    [choice, dark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
