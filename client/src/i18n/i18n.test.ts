import { describe, expect, it } from "vitest";
import bn from "./bn.json";
import en from "./en.json";
import { detectLanguage, i18n, setLanguage } from "./index";

describe("detectLanguage", () => {
  it("uses the language the user picked", () => {
    expect(detectLanguage("bn", ["en-US"])).toBe("bn");
    expect(detectLanguage("en", ["bn-BD"])).toBe("en");
  });

  it.each([["bn"], ["bn-BD"], ["BN-in"]])("picks Bangla for a browser that prefers %s", (language) => {
    expect(detectLanguage(null, ["en-US", language])).toBe("bn");
  });

  it("falls back to English", () => {
    expect(detectLanguage(null, ["fr-FR", "en-GB"])).toBe("en");
    expect(detectLanguage("de", [])).toBe("en");
  });
});

describe("translations", () => {
  it("has the same keys in Bangla and English", () => {
    const keys = (value: object, prefix = ""): string[] =>
      Object.entries(value).flatMap(([key, child]) =>
        typeof child === "object" ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
      );

    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });

  // অ + ্ + য + া is the correct spelling (অ্যাকাউন্ট); আ + ্ + য + া is a
  // common typing mistake that renders almost the same.
  it("never spells অ্যা as আ্যা", () => {
    const text = JSON.stringify(bn);

    expect(text).not.toContain("আ্যা");
    expect(text).toContain("অ্যা");
  });

  it("switches language, remembers it and updates <html lang>", async () => {
    setLanguage("bn");
    await i18n.changeLanguage("bn");

    expect(i18n.t("nav.home")).toBe("হোম");
    expect(document.documentElement.lang).toBe("bn");
    expect(localStorage.getItem("unigo.language")).toBe("bn");

    setLanguage("en");
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.home")).toBe("Home");
  });
});
