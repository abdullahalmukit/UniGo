import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { signPrivateFileUrl, verifyPrivateFileToken } from "../../src/lib/signed-files.js";
import {
  studentVerificationApprovedEmail,
  studentVerificationOtpEmail,
  studentVerificationRejectedEmail,
} from "../../src/modules/email/templates.js";
import { domainSchema } from "../../src/modules/universities/universities.admin.service.js";
import { emailDomain, generateOtp, hashOtp, otpMatches } from "../../src/modules/verification/otp.js";
import { confirmOtpSchema, rejectSchema } from "../../src/modules/verification/verification.validation.js";
import { detectFileType } from "../../src/utils/file-type.js";

describe("OTP", () => {
  it("is always 6 digits", () => {
    for (let i = 0; i < 200; i += 1) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it("is stored as a keyed hash tied to its verification row", () => {
    const hash = hashOtp("row-1", "123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(hashOtp("row-2", "123456"));
    expect(otpMatches("row-1", "123456", hash)).toBe(true);
    expect(otpMatches("row-1", "123457", hash)).toBe(false);
    expect(otpMatches("row-2", "123456", hash)).toBe(false);
  });

  it("must be exactly 6 digits when entered", () => {
    expect(confirmOtpSchema.safeParse({ code: " 012345 " }).data?.code).toBe("012345");
    for (const code of ["12345", "1234567", "12a456", ""]) expect(confirmOtpSchema.safeParse({ code }).success).toBe(false);
  });

  it("uses the rules: 10 minutes, 5 tries", () => {
    expect(rules.studentVerification.otpLifetime).toBe(10 * 60 * 1000);
    expect(rules.studentVerification.maxOtpAttempts).toBe(5);
  });
});

describe("email domains", () => {
  it("takes the whole domain after the @, so a subdomain is its own domain", () => {
    expect(emailDomain("rahim@student.diu.edu.bd")).toBe("student.diu.edu.bd");
    expect(emailDomain("RAHIM@DIU.EDU.BD")).toBe("diu.edu.bd");
  });

  it("normalises admin-entered domains and refuses anything else", () => {
    expect(domainSchema.parse(" @Mail.DIU.edu.bd ")).toBe("mail.diu.edu.bd");
    for (const value of ["diu", "diu..edu", "http://diu.edu.bd", "diu.edu.bd/", "a b.edu", "-x.edu"]) {
      expect(domainSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("rejection reason", () => {
  it("is required and trimmed", () => {
    expect(rejectSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(rejectSchema.parse({ reason: " Blurry photo " }).reason).toBe("Blurry photo");
  });
});

describe("file type detection", () => {
  it("recognises JPG, PNG and PDF by their first bytes only", () => {
    expect(detectFileType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectFileType(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(detectFileType(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
  });
});

describe("signed file links", () => {
  it("carry the file key and expire after 5 minutes", async () => {
    const now = Date.now();
    const { url, expiresAt } = await signPrivateFileUrl("student-id-cards/x.png", now);
    const token = url.replace("/api/files/", "");

    expect(expiresAt.getTime()).toBe(now + rules.privateFiles.signedUrlLifetime);
    expect(await verifyPrivateFileToken(token)).toBe("student-id-cards/x.png");

    const old = await signPrivateFileUrl("student-id-cards/x.png", now - rules.privateFiles.signedUrlLifetime - 1000);
    expect(await verifyPrivateFileToken(old.url.replace("/api/files/", ""))).toBeNull();
    expect(await verifyPrivateFileToken(`${token}x`)).toBeNull();
  });
});

describe("student verification emails", () => {
  it("send the code with its expiry in English and Bangla", () => {
    const en = studentVerificationOtpEmail("EN", { name: "Rahim", code: "042137", minutes: 10 });
    expect(en.subject).toBe("042137 is your UniGo verification code");
    expect(en.text).toContain("expires in 10 minutes");
    expect(en.html).toContain("042137");

    const bn = studentVerificationOtpEmail("BN", { name: "Rahim", code: "042137", minutes: 10 });
    expect(bn.text).toContain("১০ মিনিট");
    expect(bn.html).toContain('lang="bn"');
  });

  it("tell the result, with the reason on rejection, escaped in HTML", () => {
    expect(studentVerificationApprovedEmail("EN", { name: "Rahim" }).subject).toBe(
      "Your UniGo student verification is approved",
    );
    const rejected = studentVerificationRejectedEmail("BN", { name: "Rahim", reason: "<b>Blurry</b>" });
    expect(rejected.subject).toBe("আপনার UniGo শিক্ষার্থী যাচাই অনুমোদিত হয়নি");
    expect(rejected.text).toContain("<b>Blurry</b>");
    expect(rejected.html).toContain("&lt;b&gt;Blurry&lt;/b&gt;");
    expect(rejected.html).not.toContain("<b>Blurry");
  });
});
