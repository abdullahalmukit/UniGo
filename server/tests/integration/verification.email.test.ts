import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { api, bearer, createUniversity, files, registerUser } from "./helpers.js";

const { otpLifetime, otpResendAfter, maxOtpAttempts } = rules.studentVerification;

// A student at a university whose only allowed domain is `domain`.
async function student(domain = "uni.edu.bd", overrides: Parameters<typeof registerUser>[0] = {}) {
  const university = await createUniversity();
  await prisma.universityDomain.create({ data: { universityId: university.id, domain: `${university.id.slice(-8)}.${domain}` } });
  const user = await registerUser({ universityId: university.id, ...overrides });
  return { ...user, domain: `${university.id.slice(-8)}.${domain}` };
}

const send = (token: string, email: string) =>
  api().post("/api/verification/student/email/send").set(bearer(token)).send({ email });
const confirm = (token: string, code: string) =>
  api().post("/api/verification/student/email/confirm").set(bearer(token)).send({ code });

function lastCode() {
  const match = sentEmails.at(-1)?.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error("No code was emailed");
  return match[1];
}

// Moves the current code's send time back, so the resend wait has passed.
async function pretendCodeWasSentEarlier(userId: string, ms: number) {
  const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId, method: "UNIVERSITY_EMAIL" } });
  await prisma.studentVerification.update({
    where: { id: row.id },
    data: { otpExpiresAt: new Date(row.otpExpiresAt!.getTime() - ms) },
  });
}

describe("university email verification", () => {
  it("emails a 6-digit code to the university email, in the user's language, valid for 10 minutes", async () => {
    const user = await student("uni.edu.bd", { language: "BN" });
    const email = `rahim@${user.domain}`;

    const response = await send(user.accessToken, email.toUpperCase());

    expect(response.status).toBe(200);
    expect(response.body.email).toBe(email);
    const expiresIn = new Date(response.body.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(otpLifetime - 5000);
    expect(expiresIn).toBeLessThanOrEqual(otpLifetime);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(email);
    expect(sentEmails[0].text).toContain("১০ মিনিট");
    expect(lastCode()).toMatch(/^\d{6}$/);

    // Only a hash of the code is stored.
    const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.otpHash).not.toContain(lastCode());
    expect(row.status).toBe("PENDING");

    // Sending a code does not change the account's status.
    const status = await api().get("/api/verification/student").set(bearer(user.accessToken));
    expect(status.body).toMatchObject({ status: "UNVERIFIED", emailCode: { email, attemptsLeft: maxOtpAttempts } });
  });

  it("needs a domain that exactly matches one of the user's own university domains", async () => {
    const user = await student();
    const other = await student("other.edu.bd");

    for (const email of [`a@${other.domain}`, `a@mail.${user.domain}`, "a@gmail.com"]) {
      const response = await send(user.accessToken, email);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
    }
    expect(sentEmails).toHaveLength(0);
  });

  it("verifies the account with the right code, once", async () => {
    const user = await student();
    const email = `rahim@${user.domain}`;
    await send(user.accessToken, email);

    const response = await confirm(user.accessToken, lastCode());

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "VERIFIED", verifiedBy: "UNIVERSITY_EMAIL", universityEmail: email });
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(account.studentVerificationStatus).toBe("VERIFIED");
    expect(account.verifiedUniversityEmail).toBe(email);

    const me = await api().get("/api/auth/me").set(bearer(user.accessToken));
    expect(me.body.user.studentVerificationStatus).toBe("VERIFIED");

    const again = await confirm(user.accessToken, lastCode());
    expect(again.body.error.code).toBe("ALREADY_VERIFIED");
    expect((await send(user.accessToken, email)).body.error.code).toBe("ALREADY_VERIFIED");
  });

  it("refuses wrong codes and blocks the code after 5 wrong tries", async () => {
    const user = await student();
    await send(user.accessToken, `rahim@${user.domain}`);
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    const first = await confirm(user.accessToken, wrong);
    expect(first.status).toBe(400);
    expect(first.body.error).toMatchObject({ code: "OTP_INVALID", attemptsLeft: maxOtpAttempts - 1 });

    for (let i = 2; i < maxOtpAttempts; i += 1) await confirm(user.accessToken, wrong);
    const last = await confirm(user.accessToken, wrong);
    expect(last.body.error.code).toBe("OTP_TOO_MANY_ATTEMPTS");

    // Even the right code no longer works.
    const right = await confirm(user.accessToken, code);
    expect(right.body.error.code).toBe("OTP_TOO_MANY_ATTEMPTS");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).studentVerificationStatus).toBe("UNVERIFIED");
  });

  it("refuses an expired code", async () => {
    const user = await student();
    await send(user.accessToken, `rahim@${user.domain}`);
    await pretendCodeWasSentEarlier(user.id, otpLifetime + 1000);

    const response = await confirm(user.accessToken, lastCode());

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OTP_EXPIRED");
  });

  it("refuses a code in the wrong format", async () => {
    const user = await student();
    const response = await confirm(user.accessToken, "12ab");
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("makes the user wait a minute before a new code, which replaces the old one", async () => {
    const user = await student();
    await send(user.accessToken, `rahim@${user.domain}`);
    const oldCode = lastCode();

    const tooSoon = await send(user.accessToken, `rahim@${user.domain}`);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe("OTP_RESEND_TOO_SOON");
    expect(tooSoon.body.error.resendAvailableAt).toBeDefined();

    await pretendCodeWasSentEarlier(user.id, otpResendAfter + 1000);
    expect((await send(user.accessToken, `rahim@${user.domain}`)).status).toBe(200);
    const newCode = lastCode();

    if (oldCode !== newCode) {
      expect((await confirm(user.accessToken, oldCode)).body.error.code).toBe("OTP_INVALID");
    }
    expect((await confirm(user.accessToken, newCode)).status).toBe(200);
  });

  it("lets one university email verify only one account", async () => {
    const first = await student();
    const email = `rahim@${first.domain}`;
    await send(first.accessToken, email);
    await confirm(first.accessToken, lastCode());

    const second = await registerUser({ universityId: first.universityId });
    const response = await send(second.accessToken, email);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("UNIVERSITY_EMAIL_TAKEN");
  });

  it("lets only one of two accounts confirming the same email at the same moment succeed", async () => {
    const first = await student();
    const second = await registerUser({ universityId: first.universityId });
    const email = `rahim@${first.domain}`;
    await send(first.accessToken, email);
    const firstCode = lastCode();
    await send(second.accessToken, email);
    const secondCode = lastCode();

    const responses = await Promise.all([confirm(first.accessToken, firstCode), confirm(second.accessToken, secondCode)]);

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.status === 409)!.body.error.code).toBe("UNIVERSITY_EMAIL_TAKEN");
    expect(await prisma.user.count({ where: { verifiedUniversityEmail: email } })).toBe(1);
  });

  it("closes a pending ID card without an email when the university email is verified", async () => {
    const user = await student();
    await api()
      .post("/api/verification/student/id-card")
      .set(bearer(user.accessToken))
      .attach("file", files.png, { filename: "card.png", contentType: "image/png" });
    await send(user.accessToken, `rahim@${user.domain}`);
    const code = lastCode();
    sentEmails.length = 0;

    expect((await confirm(user.accessToken, code)).status).toBe(200);

    const card = await prisma.studentVerification.findFirstOrThrow({ where: { userId: user.id, method: "ID_CARD" } });
    expect(card).toMatchObject({
      status: "REJECTED",
      rejectionReason: rules.studentVerification.closedByEmailReason,
      reviewedById: null,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).studentVerificationStatus).toBe("VERIFIED");
    expect(sentEmails).toHaveLength(0);
  });

  it("limits code requests per account and code checks per account", async () => {
    const user = await student();
    const { sendOtpPerUser, checkOtpPerUser } = rules.studentVerification.rateLimits;

    for (let i = 0; i < sendOtpPerUser.max; i += 1) await send(user.accessToken, `rahim@${user.domain}`);
    const sendLimited = await send(user.accessToken, `rahim@${user.domain}`);
    expect(sendLimited.status).toBe(429);
    expect(sendLimited.body.error.code).toBe("RATE_LIMITED");

    for (let i = 0; i < checkOtpPerUser.max; i += 1) await confirm(user.accessToken, "123456");
    const checkLimited = await confirm(user.accessToken, "123456");
    expect(checkLimited.status).toBe(429);
    expect(checkLimited.body.error.code).toBe("RATE_LIMITED");
  });

  it("needs a login", async () => {
    expect((await api().get("/api/verification/student")).status).toBe(401);
    expect((await api().post("/api/verification/student/email/send").send({ email: "a@b.cd" })).status).toBe(401);
  });
});
