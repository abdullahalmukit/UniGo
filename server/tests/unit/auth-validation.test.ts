import { describe, expect, it } from "vitest";
import { passwordSchema } from "../../src/modules/auth/auth.validation.js";

describe("password rule: 8-72 characters, at least one letter and one number", () => {
  it.each(["abcdefg1", "Secret123", `a1${"x".repeat(70)}`, "পাসওয়ার্ড১২৩৪"])("accepts %s", (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(true);
  });

  it.each([
    ["7 characters", "abcdef1"],
    ["73 characters", `a1${"x".repeat(71)}`],
    ["no number", "abcdefgh"],
    ["no letter", "12345678"],
    ["only symbols", "!@#$%^&*"],
  ])("rejects %s", (_label, password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });
});
