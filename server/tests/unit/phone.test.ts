import { describe, expect, it } from "vitest";
import { normalizeBdMobile } from "../../src/utils/phone.js";

describe("normalizeBdMobile", () => {
  it.each(["01712345678", "8801712345678", "+8801712345678", "+880 1712-345678", " 017 1234 5678 "])(
    "stores %s as +8801712345678",
    (input) => {
      expect(normalizeBdMobile(input)).toBe("+8801712345678");
    },
  );

  it.each(["013", "019"])("accepts operator prefix %s", (prefix) => {
    expect(normalizeBdMobile(`${prefix}12345678`)).toBe(`+88${prefix}12345678`);
  });

  it.each([
    ["an unused prefix", "01212345678"],
    ["too few digits", "0171234567"],
    ["too many digits", "017123456789"],
    ["a landline", "029876543"],
    ["a foreign number", "+14155550100"],
    ["letters", "0171234567a"],
    ["an empty value", ""],
  ])("rejects %s", (_label, input) => {
    expect(normalizeBdMobile(input)).toBeNull();
  });
});
