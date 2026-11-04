import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { hashToken } from "../../src/modules/auth/tokens.js";
import { api, createUniversity, PASSWORD, refreshCookie, registrationBody } from "./helpers.js";

describe("POST /api/auth/register", () => {
  it("creates the account and profile and starts a session", async () => {
    const university = await createUniversity();
    const body = registrationBody(university.id, {
      name: "  Rahim Uddin ",
      email: "  Rahim@Example.COM ",
      phone: "+880 1712-345678",
    });

    const response = await api().post("/api/auth/register").send(body);

    expect(response.status).toBe(201);
    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({
      email: "rahim@example.com",
      phone: "+8801712345678",
      role: "USER",
      accountStatus: "ACTIVE",
      studentVerificationStatus: "UNVERIFIED",
      isVerifiedRider: false,
      university: { id: university.id },
      profile: { fullName: "Rahim Uddin" },
    });
    expect(response.body.user).not.toHaveProperty("passwordHash");
    expect(response.body.user).not.toHaveProperty("googleId");
    expect(response.body).not.toHaveProperty("refreshToken");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: response.body.user.id } });
    expect(user.passwordHash).not.toBe(PASSWORD);
    // Cost 4 under NODE_ENV=test; 12 everywhere else (rules.auth).
    expect(user.passwordHash).toMatch(/^\$2[aby]\$04\$/);

    const token = refreshCookie(response.headers["set-cookie"]).split("=")[1];
    const session = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    expect(session.userId).toBe(user.id);
  });

  it("sets the refresh cookie as httpOnly, SameSite=Lax, path /api/auth and not Secure outside production", async () => {
    const university = await createUniversity();

    const response = await api().post("/api/auth/register").send(registrationBody(university.id));

    const cookie = (response.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("unigo_refresh="));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("Expires=");
    expect(cookie).not.toContain("Secure");
  });

  it("refuses an email that is already registered, in any letter case", async () => {
    const university = await createUniversity();
    await api().post("/api/auth/register").send(registrationBody(university.id, { email: "taken@example.com" }));

    const response = await api()
      .post("/api/auth/register")
      .send(registrationBody(university.id, { email: "TAKEN@example.com" }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("refuses a phone number that is already registered, in any format", async () => {
    const university = await createUniversity();
    await api().post("/api/auth/register").send(registrationBody(university.id, { phone: "01812345678" }));

    const response = await api()
      .post("/api/auth/register")
      .send(registrationBody(university.id, { phone: "+8801812345678" }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PHONE_TAKEN");
  });

  it("refuses an unknown or inactive university", async () => {
    const inactive = await createUniversity(false);

    const unknown = await api()
      .post("/api/auth/register")
      .send(registrationBody("0190a6b2-7c3d-7e4f-8a5b-6c7d8e9f0a1b"));
    const closed = await api().post("/api/auth/register").send(registrationBody(inactive.id));

    expect(unknown.status).toBe(400);
    expect(unknown.body.error.code).toBe("UNIVERSITY_NOT_FOUND");
    expect(closed.status).toBe(400);
    expect(closed.body.error.code).toBe("UNIVERSITY_NOT_FOUND");
  });

  it.each([
    ["password without a number", { password: "onlyletters" }, "password"],
    ["password without a letter", { password: "12345678" }, "password"],
    ["password under 8 characters", { password: "abc1234" }, "password"],
    ["password over 72 characters", { password: `a1${"x".repeat(71)}` }, "password"],
    ["a non-Bangladesh phone number", { phone: "+14155550100" }, "phone"],
    ["a landline number", { phone: "029876543" }, "phone"],
    ["an invalid email", { email: "not-an-email" }, "email"],
    ["a missing name", { name: " " }, "name"],
  ])("rejects %s with VALIDATION_ERROR", async (_label, override, field) => {
    const university = await createUniversity();

    const response = await api().post("/api/auth/register").send(registrationBody(university.id, override));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.fields).toHaveProperty(field);
    expect(await prisma.user.count()).toBe(0);
  });

  it("saves the language and theme the browser detected", async () => {
    const university = await createUniversity();

    const response = await api()
      .post("/api/auth/register")
      .send(registrationBody(university.id, { language: "BN", theme: "DARK" }));

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ language: "BN", theme: "DARK" });
  });

  it("defaults to English and the Light theme when the browser sends none", async () => {
    const university = await createUniversity();

    const response = await api().post("/api/auth/register").send(registrationBody(university.id));

    expect(response.body.user).toMatchObject({ language: "EN", theme: "LIGHT" });
  });

  it("refuses an unknown language or theme", async () => {
    const university = await createUniversity();

    const response = await api()
      .post("/api/auth/register")
      .send(registrationBody(university.id, { language: "FR", theme: "PINK" }));

    expect(response.status).toBe(400);
    expect(Object.keys(response.body.error.fields).sort()).toEqual(["language", "theme"]);
  });

  it("accepts a password of exactly 8 and exactly 72 characters", async () => {
    const university = await createUniversity();

    const short = await api().post("/api/auth/register").send(registrationBody(university.id, { password: "abcdefg1" }));
    const long = await api()
      .post("/api/auth/register")
      .send(registrationBody(university.id, { password: `a1${"x".repeat(70)}` }));

    expect(short.status).toBe(201);
    expect(long.status).toBe(201);
  });
});
