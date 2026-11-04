import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { hashToken } from "../../src/modules/auth/tokens.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { api, bearer, PASSWORD, registerUser } from "./helpers.js";

const NEW_PASSWORD = "brandnew42";

const forgot = (email: string) => api().post("/api/auth/forgot-password").send({ email });
const reset = (token: string, password = NEW_PASSWORD) =>
  api().post("/api/auth/reset-password").send({ token, password });
const login = (email: string, password: string) => api().post("/api/auth/login").send({ email, password });

// Asks for a reset link and returns the token from the email.
async function requestResetToken(email: string) {
  await forgot(email);
  await settleBackgroundTasks();
  const match = sentEmails.at(-1)?.text.match(/reset-password#token=([\w-]+)/);
  if (!match) throw new Error("No reset email was sent");
  return match[1];
}

describe("POST /api/auth/forgot-password", () => {
  it("answers the same for a registered and an unknown email, and emails only the registered one", async () => {
    const user = await registerUser();

    const known = await forgot(user.email);
    const unknown = await forgot("nobody@example.com");
    await settleBackgroundTasks();

    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(known.body).toEqual({ message: "If this email is registered, a reset link has been sent" });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(user.email);
  });

  it("sends a single-use link in the URL fragment and stores only the token's hash, for 15 minutes", async () => {
    const user = await registerUser();

    const token = await requestResetToken(user.email);

    expect(sentEmails[0].text).toContain(`http://localhost:5173/reset-password#token=${token}`);
    expect(sentEmails[0].html).toContain(`/reset-password#token=${token}`);
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeCloseTo(rules.passwordReset.tokenLifetime, -3);
  });

  it("writes the email in the user's language", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { language: "BN" } });

    await requestResetToken(user.email);

    expect(sentEmails[0].subject).toBe("আপনার UniGo পাসওয়ার্ড রিসেট করুন");
    expect(sentEmails[0].text).toContain("১৫ মিনিট");
  });

  it("cancels the previous link when a new one is requested", async () => {
    const user = await registerUser();
    const first = await requestResetToken(user.email);
    const second = await requestResetToken(user.email);

    expect((await reset(first)).body.error.code).toBe("INVALID_RESET_TOKEN");
    expect((await reset(second)).status).toBe(204);
  });

  it("also sends a link to a banned account, which still cannot log in afterwards", async () => {
    const user = await registerUser({ accountStatus: "BANNED" });

    const token = await requestResetToken(user.email);

    expect((await reset(token)).status).toBe(204);
    expect((await login(user.email, NEW_PASSWORD)).body.error.code).toBe("ACCOUNT_BANNED");
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password, ends every session and sends a 'password changed' email", async () => {
    const user = await registerUser();
    const token = await requestResetToken(user.email);

    const response = await reset(token);
    await settleBackgroundTasks();

    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await login(user.email, PASSWORD)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
    // Sessions from before the reset are gone.
    expect((await api().get("/api/auth/me").set(bearer(user.accessToken))).status).toBe(401);
    expect((await api().post("/api/auth/refresh").set("Cookie", user.refreshCookie)).status).toBe(401);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordChangedAt).not.toBeNull();
    expect(stored.tokensValidAfter).toEqual(stored.passwordChangedAt);
    expect(sentEmails.at(-1)).toMatchObject({ to: user.email, subject: "Your UniGo password was changed" });
  });

  it("works only once", async () => {
    const user = await registerUser();
    const token = await requestResetToken(user.email);
    await reset(token);

    const again = await reset(token, "another99");

    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("INVALID_RESET_TOKEN");
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("refuses a link after 15 minutes", async () => {
    const user = await registerUser();
    const token = await requestResetToken(user.email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await reset(token);

    expect(response.body.error.code).toBe("INVALID_RESET_TOKEN");
    expect((await login(user.email, PASSWORD)).status).toBe(200);
  });

  it("lets only one of two simultaneous resets with the same link succeed", async () => {
    const user = await registerUser();
    const token = await requestResetToken(user.email);

    const results = await Promise.all([reset(token, "firstpass1"), reset(token, "secondpass2")]);

    expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
  });

  it("lets a Google-only account set its first password", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null, googleId: "google-123" } });
    const token = await requestResetToken(user.email);

    await reset(token);

    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200);
  });

  it("checks the new password against the password rule, and refuses an unknown token", async () => {
    const user = await registerUser();
    const token = await requestResetToken(user.email);

    const weak = await reset(token, "noNumbers");
    const unknown = await reset("not-a-real-token");

    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    expect(weak.body.error.fields).toHaveProperty("password");
    expect(unknown.body.error.code).toBe("INVALID_RESET_TOKEN");
    // The weak attempt did not use up the link.
    expect((await reset(token)).status).toBe(204);
  });
});

describe("password reset rate limits", () => {
  const perEmail = rules.passwordReset.maxRequestsPerHour;

  it(`allows ${perEmail} requests per hour for an email, registered or not, with the same 429`, async () => {
    const user = await registerUser();
    for (let i = 0; i < perEmail; i++) {
      expect((await forgot(user.email)).status).toBe(202);
      expect((await forgot("nobody@example.com")).status).toBe(202);
    }

    const known = await forgot(user.email.toUpperCase());
    const unknown = await forgot("nobody@example.com");
    await settleBackgroundTasks();

    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(known.body).toEqual(unknown.body);
    expect(sentEmails).toHaveLength(perEmail);
  });

  it(`also allows at most ${rules.auth.rateLimits.forgotPasswordPerIp.max} requests per hour from one IP`, async () => {
    const { max } = rules.auth.rateLimits.forgotPasswordPerIp;
    for (let i = 0; i < max; i++) {
      expect((await forgot(`person${i}@example.com`)).status).toBe(202);
    }

    expect((await forgot("one.more@example.com")).status).toBe(429);
  });

  it(`allows ${rules.auth.rateLimits.resetPassword.max} reset attempts per 15 minutes from one IP`, async () => {
    for (let i = 0; i < rules.auth.rateLimits.resetPassword.max; i++) {
      expect((await reset(`guess-${i}`)).status).toBe(400);
    }

    expect((await reset("guess-last")).status).toBe(429);
  });
});
