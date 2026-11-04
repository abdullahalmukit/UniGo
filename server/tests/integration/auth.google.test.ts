import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { googleIdToken } from "./google-test-keys.js";
import { api, createUniversity, PASSWORD, refreshCookie, registerUser } from "./helpers.js";

vi.mock("../../src/modules/auth/google-keys.js", async () => ({
  googleKeySet: (await import("./google-test-keys.js")).testGoogleKeySet,
}));

const googleSignIn = async (claims: Parameters<typeof googleIdToken>[0], options?: Parameters<typeof googleIdToken>[1]) =>
  api()
    .post("/api/auth/google")
    .send({ idToken: await googleIdToken(claims, options) });

describe("Google sign-in for a new user", () => {
  it("asks for the missing details, then creates a password-less account linked to Google", async () => {
    const university = await createUniversity();

    const first = await googleSignIn({ sub: "g-new", email: "New.Person@Gmail.com", name: "New Person" });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ needsRegistration: true, email: "new.person@gmail.com", name: "New Person" });
    expect(first.body.signupToken).toEqual(expect.any(String));
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(await prisma.user.count()).toBe(0);

    const registered = await api().post("/api/auth/google/register").send({
      signupToken: first.body.signupToken,
      name: "New Person",
      phone: "01912345678",
      universityId: university.id,
      language: "BN",
      theme: "SYSTEM",
    });

    expect(registered.status).toBe(201);
    expect(registered.body.user).toMatchObject({
      email: "new.person@gmail.com",
      phone: "+8801912345678",
      language: "BN",
      theme: "SYSTEM",
    });
    expect(refreshCookie(registered.headers["set-cookie"])).toMatch(/^unigo_refresh=/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new.person@gmail.com" } });
    expect(user.googleId).toBe("g-new");
    expect(user.passwordHash).toBeNull();

    // Next time Google signs straight in.
    const again = await googleSignIn({ sub: "g-new", email: "new.person@gmail.com" });
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(user.id);
    expect(again.body.accessToken).toEqual(expect.any(String));
  });

  it("refuses a phone number that is taken, and an email registered in the meantime", async () => {
    const university = await createUniversity();
    const existing = await registerUser();
    const existingPhone = (await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).phone;

    const phoneTaken = await googleSignIn({ sub: "g-1", email: "one@gmail.com" });
    const emailLater = await googleSignIn({ sub: "g-2", email: "two@gmail.com" });
    await api()
      .post("/api/auth/register")
      .send({ name: "Two", phone: "01812340000", email: "two@gmail.com", universityId: university.id, password: PASSWORD });

    const phoneResponse = await api()
      .post("/api/auth/google/register")
      .send({ signupToken: phoneTaken.body.signupToken, name: "One", phone: existingPhone, universityId: university.id });
    const emailResponse = await api()
      .post("/api/auth/google/register")
      .send({ signupToken: emailLater.body.signupToken, name: "Two", phone: "01812349999", universityId: university.id });

    expect(phoneResponse.body.error.code).toBe("PHONE_TAKEN");
    expect(emailResponse.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("refuses a missing, tampered or wrong-purpose signup token", async () => {
    const university = await createUniversity();
    const user = await registerUser();
    const linkNeeded = await googleSignIn({ sub: "g-3", email: user.email });
    const body = { name: "Some One", phone: "01712349999", universityId: university.id };

    const tampered = await api().post("/api/auth/google/register").send({ ...body, signupToken: "abc.def.ghi" });
    const linkToken = await api()
      .post("/api/auth/google/register")
      .send({ ...body, signupToken: linkNeeded.body.error.linkToken });
    const accessToken = await api().post("/api/auth/google/register").send({ ...body, signupToken: user.accessToken });

    for (const response of [tampered, linkToken, accessToken]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("INVALID_GOOGLE_STEP_TOKEN");
    }
  });
});

describe("Google sign-in for an existing password account", () => {
  it("asks for the password once, then links the account", async () => {
    const user = await registerUser();

    const first = await googleSignIn({ sub: "g-link", email: user.email.toUpperCase() });

    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "GOOGLE_LINK_REQUIRES_PASSWORD", email: user.email });
    expect(first.body.error.linkToken).toEqual(expect.any(String));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleId).toBeNull();

    const wrong = await api()
      .post("/api/auth/google/link")
      .send({ linkToken: first.body.error.linkToken, password: "wrong1234" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleId).toBeNull();

    const linked = await api()
      .post("/api/auth/google/link")
      .send({ linkToken: first.body.error.linkToken, password: PASSWORD });
    expect(linked.status).toBe(200);
    expect(linked.body.user.id).toBe(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).googleId).toBe("g-link");

    // The password still works, and Google now signs straight in.
    expect((await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(200);
    expect((await googleSignIn({ sub: "g-link", email: user.email })).body.user.id).toBe(user.id);
  });

  it("refuses a Google account when the email is already linked to another Google account", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { googleId: "g-original" } });

    const response = await googleSignIn({ sub: "g-other", email: user.email });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("GOOGLE_ACCOUNT_CONFLICT");
  });

  it("applies the account status checks", async () => {
    const banned = await registerUser({ accountStatus: "BANNED" });
    await prisma.user.update({ where: { id: banned.id }, data: { googleId: "g-banned" } });
    const suspended = await registerUser({
      accountStatus: "SUSPENDED",
      suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
    });
    const linkStep = await googleSignIn({ sub: "g-suspended", email: suspended.email });

    const bannedSignIn = await googleSignIn({ sub: "g-banned", email: banned.email });
    const suspendedLink = await api()
      .post("/api/auth/google/link")
      .send({ linkToken: linkStep.body.error.linkToken, password: PASSWORD });

    expect(bannedSignIn.body.error.code).toBe("ACCOUNT_BANNED");
    expect(suspendedLink.body.error.code).toBe("ACCOUNT_SUSPENDED");
  });
});

describe("Google ID token checks", () => {
  it.each([
    ["another app's audience", { audience: "someone-else.apps.googleusercontent.com" }],
    ["another issuer", { issuer: "https://evil.example.com" }],
    ["an expired token", { expiresAt: new Date(Date.now() - 1000) }],
    ["a key Google does not use", { untrustedKey: true }],
  ])("refuses %s", async (_label, options) => {
    const response = await googleSignIn({ sub: "g-x", email: "x@gmail.com" }, options);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_GOOGLE_TOKEN");
  });

  it("refuses a Google email that is not verified", async () => {
    const response = await googleSignIn({ sub: "g-x", email: "x@gmail.com", email_verified: false });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
  });

  it("accepts the older string form of email_verified and the short issuer", async () => {
    const response = await googleSignIn(
      { sub: "g-x", email: "x@gmail.com", email_verified: "true" },
      { issuer: "accounts.google.com" },
    );

    expect(response.body.needsRegistration).toBe(true);
  });
});
