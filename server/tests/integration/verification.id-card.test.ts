import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { api, bearer, files, registerUser } from "./helpers.js";

const folder = path.resolve(env.PRIVATE_STORAGE_DIR, "student-id-cards");
const storedFiles = () => (existsSync(folder) ? readdirSync(folder) : []);

const upload = (token: string, data: Buffer, contentType: string, filename = "card") =>
  api()
    .post("/api/verification/student/id-card")
    .set(bearer(token))
    .attach("file", data, { filename, contentType });

describe("student ID card verification", () => {
  it("stores the card privately and puts the account in PENDING", async () => {
    const user = await registerUser();
    const before = storedFiles().length;

    const response = await upload(user.accessToken, files.png, "image/png", "my card.png");

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "PENDING", idCard: { status: "PENDING", rejectionReason: null } });
    const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId: user.id } });
    // A random name; the original filename is never kept.
    expect(row.idCardFileKey).toMatch(/^student-id-cards\/[0-9a-f-]{36}\.png$/);
    expect(row.idCardFileKey).not.toContain("my card");
    expect(storedFiles().length).toBe(before + 1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).studentVerificationStatus).toBe("PENDING");
    // The student's status response never contains the file location.
    expect(JSON.stringify(response.body)).not.toContain("student-id-cards");
    expect(sentEmails).toHaveLength(0);
  });

  it("accepts JPG and PDF too", async () => {
    const jpgUser = await registerUser();
    const pdfUser = await registerUser();
    expect((await upload(jpgUser.accessToken, files.jpg, "image/jpeg")).status).toBe(201);
    expect((await upload(pdfUser.accessToken, files.pdf, "application/pdf")).status).toBe(201);
  });

  it("refuses other file types, including a file that only claims to be an image", async () => {
    const user = await registerUser();

    const text = await upload(user.accessToken, files.text, "text/plain");
    const spoofed = await upload(user.accessToken, files.text, "image/png");
    const mismatched = await upload(user.accessToken, files.pdf, "image/png");

    for (const response of [text, spoofed, mismatched]) {
      expect(response.status).toBe(415);
      expect(response.body.error.code).toBe("FILE_TYPE_NOT_ALLOWED");
    }
    expect(await prisma.studentVerification.count()).toBe(0);
  });

  it("refuses a file over 5 MB", async () => {
    const user = await registerUser();
    const big = Buffer.concat([files.png, Buffer.alloc(rules.uploads.maxFileSizeBytes)]);

    const response = await upload(user.accessToken, big, "image/png");

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("FILE_TOO_LARGE");
  });

  it("needs a file", async () => {
    const user = await registerUser();
    const response = await api().post("/api/verification/student/id-card").set(bearer(user.accessToken)).send({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("FILE_REQUIRED");
  });

  it("allows one card under review at a time and keeps no file from a refused upload", async () => {
    const user = await registerUser();
    await upload(user.accessToken, files.png, "image/png");
    const before = storedFiles().length;

    const again = await upload(user.accessToken, files.png, "image/png");

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("VERIFICATION_PENDING");
    expect(storedFiles().length).toBe(before);
  });

  it("lets only one of two uploads at the same moment through", async () => {
    const user = await registerUser();

    const responses = await Promise.all([
      upload(user.accessToken, files.png, "image/png"),
      upload(user.accessToken, files.jpg, "image/jpeg"),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.studentVerification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("lets a rejected student upload again, and refuses verified students", async () => {
    const rejected = await registerUser({ studentVerificationStatus: "REJECTED" });
    const verified = await registerUser({ studentVerificationStatus: "VERIFIED" });

    expect((await upload(rejected.accessToken, files.png, "image/png")).status).toBe(201);
    const response = await upload(verified.accessToken, files.png, "image/png");
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_VERIFIED");
  });

  it("limits uploads per account", async () => {
    const user = await registerUser();
    const { max } = rules.studentVerification.rateLimits.idCardUploadPerUser;

    for (let i = 0; i < max; i += 1) await upload(user.accessToken, files.text, "text/plain");
    const response = await upload(user.accessToken, files.png, "image/png");

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
  });
});
