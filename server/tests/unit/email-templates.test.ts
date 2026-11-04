import { describe, expect, it } from "vitest";
import { passwordChangedEmail, passwordResetEmail } from "../../src/modules/email/templates.js";

const resetData = { name: "Rahim", resetUrl: "http://localhost:5173/reset-password#token=abc", minutes: 15 };

describe("password reset email", () => {
  it("is written in English with the link and the 15-minute expiry", () => {
    const email = passwordResetEmail("EN", resetData);

    expect(email.subject).toBe("Reset your UniGo password");
    expect(email.text).toContain("Hi Rahim,");
    expect(email.text).toContain(resetData.resetUrl);
    expect(email.text).toContain("expires in 15 minutes");
    expect(email.html).toContain(`href="${resetData.resetUrl}"`);
    expect(email.html).toContain('lang="en"');
  });

  it("is written in Bangla with Bangla digits", () => {
    const email = passwordResetEmail("BN", resetData);

    expect(email.subject).toBe("আপনার UniGo পাসওয়ার্ড রিসেট করুন");
    expect(email.text).toContain("১৫ মিনিট");
    expect(email.text).toContain(resetData.resetUrl);
    expect(email.html).toContain('lang="bn"');
  });

  it("escapes the user's name in the HTML version", () => {
    const email = passwordResetEmail("EN", { ...resetData, name: "<script>x</script>" });

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("password changed email", () => {
  it.each([
    ["EN", "Your UniGo password was changed", "logged out on all devices"],
    ["BN", "আপনার UniGo পাসওয়ার্ড পরিবর্তন করা হয়েছে", "সব ডিভাইস থেকে"],
  ] as const)("is written in %s", (language, subject, phrase) => {
    const email = passwordChangedEmail(language, { name: "Rahim" });

    expect(email.subject).toBe(subject);
    expect(email.text).toContain(phrase);
    expect(email.text).not.toContain("token");
  });

  // Must match the link on the login page exactly (A5b decision).
  it.each([
    ["EN", "“Forgot password?”"],
    ["BN", "“পাসওয়ার্ড ভুলে গেছেন?”"],
  ] as const)("names the login page link as %s shows it", (language, label) => {
    expect(passwordChangedEmail(language, { name: "Rahim" }).text).toContain(label);
  });
});
