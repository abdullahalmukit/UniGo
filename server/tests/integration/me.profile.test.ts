import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { api, bearer, files, PASSWORD, refreshCookie, registerUser } from "./helpers.js";

const photoFolder = path.resolve(env.PRIVATE_STORAGE_DIR, "profile-photos");
const storedPhotos = () => (existsSync(photoFolder) ? readdirSync(photoFolder) : []);

// A real JPEG that carries EXIF data, as a phone camera would.
const photoWithExif = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: "#3366cc" } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "secret-camera-owner", Make: "PhoneCam" } } })
    .toBuffer();

const pngPhoto = () => sharp({ create: { width: 300, height: 900, channels: 4, background: "#00000000" } }).png().toBuffer();

const uploadPhoto = (token: string, data: Buffer, contentType: string) =>
  api().put("/api/me/photo").set(bearer(token)).attach("photo", data, { filename: "me", contentType });

describe("PATCH /api/me/profile", () => {
  it("updates the profile fields and the phone, and blank fields become empty", async () => {
    const user = await registerUser();
    await api()
      .patch("/api/me/profile")
      .set(bearer(user.accessToken))
      .send({ department: "CSE", batch: "2022" })
      .expect(200);

    const response = await api()
      .patch("/api/me/profile")
      .set(bearer(user.accessToken))
      .send({ name: "  New Name ", phone: "+880 1812-345678", studentIdNumber: "221-15-123", batch: "  ", location: "Dhanmondi" });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      phone: "+8801812345678",
      profile: { fullName: "New Name", studentIdNumber: "221-15-123", department: "CSE", batch: null, location: "Dhanmondi" },
    });
  });

  it("refuses a phone number another account uses, and keeps its own", async () => {
    const other = await registerUser();
    const user = await registerUser();
    const otherPhone = (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).phone;
    const ownPhone = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phone;

    const taken = await api().patch("/api/me/profile").set(bearer(user.accessToken)).send({ phone: otherPhone });
    expect(taken.status).toBe(409);
    expect(taken.body.error).toMatchObject({ code: "PHONE_TAKEN", fields: { phone: expect.any(Array) } });

    const same = await api().patch("/api/me/profile").set(bearer(user.accessToken)).send({ phone: ownPhone });
    expect(same.status).toBe(200);
  });

  it("never changes email or university, and checks every field", async () => {
    const user = await registerUser();

    const email = await api().patch("/api/me/profile").set(bearer(user.accessToken)).send({ email: "new@example.com" });
    const university = await api()
      .patch("/api/me/profile")
      .set(bearer(user.accessToken))
      .send({ universityId: "0190a7c4-0000-7000-8000-000000000000" });
    const invalid = await api()
      .patch("/api/me/profile")
      .set(bearer(user.accessToken))
      .send({ name: "A", phone: "12345", department: "x".repeat(rules.profile.departmentMaxLength + 1) });
    const empty = await api().patch("/api/me/profile").set(bearer(user.accessToken)).send({});

    for (const response of [email, university, invalid, empty]) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(Object.keys(invalid.body.error.fields)).toEqual(expect.arrayContaining(["name", "phone", "department"]));
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.email).toBe(user.email);
    expect(stored.universityId).toBe(user.universityId);
  });

  it("is open to unverified and restricted users, and needs a login", async () => {
    const restricted = await registerUser({ accountStatus: "RESTRICTED" });
    expect((await api().patch("/api/me/profile").set(bearer(restricted.accessToken)).send({ batch: "21" })).status).toBe(200);
    expect((await api().patch("/api/me/profile").send({ batch: "21" })).status).toBe(401);
  });
});

describe("profile photo", () => {
  it("stores a square JPEG without EXIF data and returns a signed link, never the key", async () => {
    const user = await registerUser();
    const before = storedPhotos().length;

    const response = await uploadPhoto(user.accessToken, await photoWithExif(), "image/jpeg");

    expect(response.status).toBe(200);
    const { photo } = response.body.user;
    expect(photo.url).toMatch(/^\/api\/files\//);
    expect(new Date(photo.expiresAt).getTime()).toBeGreaterThan(Date.now() + rules.profile.photo.signedUrlLifetime - 60_000);
    expect(JSON.stringify(response.body)).not.toContain("profile-photos");
    expect(storedPhotos().length).toBe(before + 1);

    const file = await api().get(photo.url).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    const metadata = await sharp(file.body as Buffer).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: rules.profile.photo.sizePx, height: rules.profile.photo.sizePx });
    expect(metadata.exif).toBeUndefined();
    expect((file.body as Buffer).includes(Buffer.from("secret-camera-owner"))).toBe(false);

    // /auth/me shows the same photo.
    const me = await api().get("/api/auth/me").set(bearer(user.accessToken));
    expect(me.body.user.photo.url).toMatch(/^\/api\/files\//);
    expect(me.body.user.profile).not.toHaveProperty("photoKey");
  });

  it("accepts PNG, replaces the old file and can remove the photo", async () => {
    const user = await registerUser();
    const before = storedPhotos().length;

    await uploadPhoto(user.accessToken, await photoWithExif(), "image/jpeg").expect(200);
    const firstKey = (await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } })).photoKey;
    await uploadPhoto(user.accessToken, await pngPhoto(), "image/png").expect(200);
    const secondKey = (await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } })).photoKey;

    expect(secondKey).not.toBe(firstKey);
    expect(secondKey).toMatch(/^profile-photos\/[0-9a-f-]{36}\.jpg$/);
    expect(storedPhotos().length).toBe(before + 1);

    const removed = await api().delete("/api/me/photo").set(bearer(user.accessToken));
    expect(removed.status).toBe(200);
    expect(removed.body.user.photo).toBeNull();
    expect(storedPhotos().length).toBe(before);
  });

  it("refuses PDFs, files that only claim to be images, broken images and files over 5 MB", async () => {
    const user = await registerUser();

    const pdf = await uploadPhoto(user.accessToken, files.pdf, "application/pdf");
    const spoofed = await uploadPhoto(user.accessToken, files.text, "image/png");
    const broken = await uploadPhoto(user.accessToken, files.jpg, "image/jpeg");
    const big = await uploadPhoto(user.accessToken, Buffer.alloc(rules.uploads.maxFileSizeBytes + 1, 0xff), "image/jpeg");

    expect(pdf.status).toBe(415);
    expect(pdf.body.error.code).toBe("IMAGE_TYPE_NOT_ALLOWED");
    expect(spoofed.status).toBe(415);
    expect(broken.status).toBe(415);
    expect(broken.body.error.code).toBe("IMAGE_UNREADABLE");
    expect(big.status).toBe(413);
    expect((await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } })).photoKey).toBeNull();
  });
});

describe("POST /api/auth/change-password", () => {
  it("changes the password, ends every other session and keeps this device logged in", async () => {
    const user = await registerUser();
    const otherDevice = await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const otherCookie = refreshCookie(otherDevice.headers["set-cookie"]);

    const response = await api()
      .post("/api/auth/change-password")
      .set(bearer(user.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: "brandnew99" });

    expect(response.status).toBe(200);
    const newToken = response.body.accessToken as string;
    const newCookie = refreshCookie(response.headers["set-cookie"]);

    // This device: the new tokens work; the old access token does not.
    expect((await api().get("/api/auth/me").set(bearer(newToken))).status).toBe(200);
    expect((await api().get("/api/auth/me").set(bearer(user.accessToken))).status).toBe(401);
    expect((await api().post("/api/auth/refresh").set("Cookie", newCookie)).status).toBe(200);
    // Every other session has ended.
    expect((await api().post("/api/auth/refresh").set("Cookie", otherCookie)).status).toBe(401);
    expect((await api().post("/api/auth/refresh").set("Cookie", user.refreshCookie)).status).toBe(401);
    // Only the new password logs in.
    expect((await api().post("/api/auth/login").send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await api().post("/api/auth/login").send({ email: user.email, password: "brandnew99" })).status).toBe(200);

    await settleBackgroundTasks();
    expect(sentEmails.map((email) => email.to)).toEqual([user.email]);
    expect(sentEmails[0].text).toContain("Forgot password?");
  });

  it("refuses a wrong current password and a weak new one", async () => {
    const user = await registerUser();

    const wrong = await api()
      .post("/api/auth/change-password")
      .set(bearer(user.accessToken))
      .send({ currentPassword: "not-it-123", newPassword: "brandnew99" });
    const weak = await api()
      .post("/api/auth/change-password")
      .set(bearer(user.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: "short" });

    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: "WRONG_PASSWORD", fields: { currentPassword: expect.any(Array) } });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    expect((await api().get("/api/auth/me").set(bearer(user.accessToken))).status).toBe(200);
  });

  it("is rate limited per account", async () => {
    const user = await registerUser();
    const attempt = () =>
      api()
        .post("/api/auth/change-password")
        .set(bearer(user.accessToken))
        .send({ currentPassword: "not-it-123", newPassword: "brandnew99" });

    for (let i = 0; i < rules.profile.changePasswordPerUser.max; i += 1) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
  });

  it("sends a Google-only account to the emailed link instead", async () => {
    const user = await registerUser();
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null, googleId: "google-123" } });

    const me = await api().get("/api/auth/me").set(bearer(user.accessToken));
    expect(me.body.user).toMatchObject({ hasPassword: false, hasGoogle: true });
    expect(me.body.user).not.toHaveProperty("passwordHash");
    expect(me.body.user).not.toHaveProperty("googleId");

    const change = await api()
      .post("/api/auth/change-password")
      .set(bearer(user.accessToken))
      .send({ currentPassword: "anything1", newPassword: "brandnew99" });
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe("NO_PASSWORD_SET");

    const link = await api().post("/api/me/password-setup-link").set(bearer(user.accessToken));
    expect(link.status).toBe(202);
    await settleBackgroundTasks();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(user.email);
    expect(sentEmails[0].text).toContain("/reset-password#token=");
  });

  it("refuses the setup link for an account that already has a password", async () => {
    const user = await registerUser();
    const response = await api().post("/api/me/password-setup-link").set(bearer(user.accessToken));
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("PASSWORD_ALREADY_SET");
  });
});

describe("PATCH /api/me/preferences", () => {
  it("saves language, theme and the email setting to the account", async () => {
    const user = await registerUser();

    const response = await api()
      .patch("/api/me/preferences")
      .set(bearer(user.accessToken))
      .send({ language: "BN", theme: "DARK", emailNotificationsEnabled: false });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ language: "BN", theme: "DARK", emailNotificationsEnabled: false });
    const me = await api().get("/api/auth/me").set(bearer(user.accessToken));
    expect(me.body.user).toMatchObject({ language: "BN", theme: "DARK", emailNotificationsEnabled: false });
  });

  it("refuses unknown values and fields", async () => {
    const user = await registerUser();
    for (const body of [{ theme: "PINK" }, { pushEnabled: true }, {}]) {
      const response = await api().patch("/api/me/preferences").set(bearer(user.accessToken)).send(body);
      expect(response.status).toBe(400);
    }
  });
});
