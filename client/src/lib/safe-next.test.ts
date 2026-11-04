import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each(["/activity", "/activity?filter=food", "/services", "/inbox#top"])("follows %s", (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    ["another site", "https://evil.example/steal"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["a relative path", "activity"],
    ["nothing", null],
    ["an empty value", ""],
  ])("refuses %s and goes Home", (_label, value) => {
    expect(safeNext(value)).toBe("/");
  });

  it.each(["/login", "/login?next=/x", "/register", "/register/google", "/forgot-password", "/reset-password"])(
    "never sends the user back to %s",
    (path) => {
      expect(safeNext(path)).toBe("/");
    },
  );
});
