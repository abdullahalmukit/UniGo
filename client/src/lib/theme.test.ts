import { describe, expect, it } from "vitest";
import { media } from "../test/setup";
import { applyTheme, readThemeChoice, resolveTheme, saveThemeChoice } from "./theme";

describe("theme", () => {
  it("defaults to Light, even on a dark device", () => {
    media.prefersDark = true;

    expect(readThemeChoice()).toBe("light");
    applyTheme(readThemeChoice());
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows the device for System and ignores it otherwise", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("saves the choice and applies it to <html data-theme> and the browser bar colour", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
    media.prefersDark = true;

    saveThemeChoice("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(meta.content).toBe("#131C2E");

    saveThemeChoice("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(meta.content).toBe("#FFFFFF");
    expect(readThemeChoice()).toBe("light");
    meta.remove();
  });

  it("ignores an unknown saved value", () => {
    localStorage.setItem("unigo.theme", "purple");
    expect(readThemeChoice()).toBe("light");
  });
});
