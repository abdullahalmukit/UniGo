import { describe, expect, it } from "vitest";
import { rules } from "../../src/config/rules.js";
import { prisma } from "../../src/lib/prisma.js";
import { signPrivateFileUrl } from "../../src/lib/signed-files.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { api, bearer, files, registerUser } from "./helpers.js";

const base = "/api/admin/student-verifications";

// A student whose ID card is waiting for review.
async function pendingStudent(overrides: Parameters<typeof registerUser>[0] = {}) {
  const user = await registerUser(overrides);
  const response = await api()
    .post("/api/verification/student/id-card")
    .set(bearer(user.accessToken))
    .attach("file", files.png, { filename: "card.png", contentType: "image/png" });
  if (response.status !== 201) throw new Error(`Upload failed: ${JSON.stringify(response.body)}`);
  const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId: user.id, method: "ID_CARD" } });
  return { ...user, verificationId: row.id };
}

const admin = () => registerUser({ role: "MODERATOR" });

describe("admin student verifications: access", () => {
  it("is for moderators and super admins only", async () => {
    const student = await pendingStudent();
    const user = await registerUser();
    const superAdmin = await registerUser({ role: "SUPER_ADMIN" });

    const asUser = [
      api().get(base).set(bearer(user.accessToken)),
      api().get(`${base}/${student.verificationId}/file-url`).set(bearer(user.accessToken)),
      api().post(`${base}/${student.verificationId}/approve`).set(bearer(user.accessToken)),
      api().post(`${base}/${student.verificationId}/reject`).set(bearer(user.accessToken)).send({ reason: "Blurry" }),
    ];
    for (const response of await Promise.all(asUser)) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
    expect((await api().get(base)).status).toBe(401);
    expect((await api().get(base).set(bearer(superAdmin.accessToken))).status).toBe(200);
  });
});

describe("admin student verifications: list and file", () => {
  it("lists pending ID cards, oldest first, with the student's details", async () => {
    const moderator = await admin();
    const first = await pendingStudent();
    const second = await pendingStudent();
    await prisma.studentVerification.update({
      where: { id: first.verificationId },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const response = await api().get(base).set(bearer(moderator.accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ page: 1, pageSize: rules.admin.pageSize, total: 2 });
    expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([first.verificationId, second.verificationId]);
    expect(response.body.items[0].user).toMatchObject({ id: first.id, name: "Test Student", email: first.email });
    expect(response.body.items[0].user.university.id).toBe(first.universityId);
    // The file is only reachable through a signed link.
    expect(JSON.stringify(response.body)).not.toContain("student-id-cards");

    const filtered = await api().get(`${base}?status=REJECTED`).set(bearer(moderator.accessToken));
    expect(filtered.body.total).toBe(0);
    expect((await api().get(`${base}?status=NOPE`).set(bearer(moderator.accessToken))).body.error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("opens the card through a 5-minute signed link that needs no login", async () => {
    const moderator = await admin();
    const student = await pendingStudent();

    const link = await api().get(`${base}/${student.verificationId}/file-url`).set(bearer(moderator.accessToken));

    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(/^\/api\/files\/[\w-]+\.[\w-]+\.[\w-]+$/);
    const lifetime = new Date(link.body.expiresAt).getTime() - Date.now();
    expect(lifetime).toBeLessThanOrEqual(rules.privateFiles.signedUrlLifetime);
    expect(lifetime).toBeGreaterThan(rules.privateFiles.signedUrlLifetime - 5000);

    const file = await api().get(link.body.url).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toBe("private, no-store");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(file.body as Buffer, files.png)).toBe(0);
  });

  it("refuses an expired or altered link", async () => {
    const student = await pendingStudent();
    const row = await prisma.studentVerification.findUniqueOrThrow({ where: { id: student.verificationId } });
    const expired = await signPrivateFileUrl(row.idCardFileKey!, Date.now() - rules.privateFiles.signedUrlLifetime - 1000);
    const valid = await signPrivateFileUrl(row.idCardFileKey!);

    for (const url of [expired.url, `${valid.url.slice(0, -2)}xx`, "/api/files/not-a-token"]) {
      const response = await api().get(url);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("FILE_LINK_INVALID");
    }
  });

  it("answers 404 for an unknown verification or an email verification", async () => {
    const moderator = await admin();
    const emailRow = await prisma.studentVerification.create({
      data: { userId: moderator.id, method: "UNIVERSITY_EMAIL", universityEmail: "a@b.edu" },
    });

    for (const id of ["00000000-0000-7000-8000-000000000000", emailRow.id]) {
      const response = await api().get(`${base}/${id}/file-url`).set(bearer(moderator.accessToken));
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("VERIFICATION_NOT_FOUND");
    }
  });
});

describe("admin student verifications: decisions", () => {
  it("approves: the student is VERIFIED, the decision is audited and emailed in the student's language", async () => {
    const moderator = await admin();
    const student = await pendingStudent({ language: "BN" });

    const response = await api()
      .post(`${base}/${student.verificationId}/approve`)
      .set(bearer(moderator.accessToken));
    await settleBackgroundTasks();

    expect(response.status).toBe(204);
    const row = await prisma.studentVerification.findUniqueOrThrow({ where: { id: student.verificationId } });
    expect(row).toMatchObject({ status: "VERIFIED", reviewedById: moderator.id, rejectionReason: null });
    expect(row.reviewedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: student.id } })).studentVerificationStatus).toBe("VERIFIED");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: student.verificationId } });
    expect(audit).toMatchObject({
      adminId: moderator.id,
      action: "STUDENT_VERIFICATION_APPROVED",
      targetType: "student_verification",
      targetUserId: student.id,
      oldValue: { status: "PENDING", userStatus: "PENDING" },
      newValue: { status: "VERIFIED", userStatus: "VERIFIED" },
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(student.email);
    expect(sentEmails[0].subject).toBe("আপনার UniGo শিক্ষার্থী যাচাই অনুমোদিত হয়েছে");

    const status = await api().get("/api/verification/student").set(bearer(student.accessToken));
    expect(status.body).toMatchObject({ status: "VERIFIED", verifiedBy: "ID_CARD" });
  });

  it("rejects with a reason the student sees, audited and emailed; the student can re-submit", async () => {
    const moderator = await admin();
    const student = await pendingStudent();

    const noReason = await api().post(`${base}/${student.verificationId}/reject`).set(bearer(moderator.accessToken)).send({});
    expect(noReason.body.error.code).toBe("VALIDATION_ERROR");

    const response = await api()
      .post(`${base}/${student.verificationId}/reject`)
      .set(bearer(moderator.accessToken))
      .send({ reason: "  The photo is too blurry to read  " });
    await settleBackgroundTasks();

    expect(response.status).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: student.id } })).studentVerificationStatus).toBe("REJECTED");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: student.verificationId } });
    expect(audit).toMatchObject({
      action: "STUDENT_VERIFICATION_REJECTED",
      newValue: { status: "REJECTED", userStatus: "REJECTED", reason: "The photo is too blurry to read" },
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toBe("Your UniGo student verification was not approved");
    expect(sentEmails[0].text).toContain("The photo is too blurry to read");

    const status = await api().get("/api/verification/student").set(bearer(student.accessToken));
    expect(status.body).toMatchObject({
      status: "REJECTED",
      idCard: { status: "REJECTED", rejectionReason: "The photo is too blurry to read" },
    });

    const again = await api()
      .post("/api/verification/student/id-card")
      .set(bearer(student.accessToken))
      .attach("file", files.jpg, { filename: "card.jpg", contentType: "image/jpeg" });
    expect(again.status).toBe(201);
  });

  it("lets only one of two admins deciding at the same moment succeed", async () => {
    const [first, second] = [await admin(), await registerUser({ role: "SUPER_ADMIN" })];
    const student = await pendingStudent();

    const responses = await Promise.all([
      api().post(`${base}/${student.verificationId}/approve`).set(bearer(first.accessToken)),
      api().post(`${base}/${student.verificationId}/reject`).set(bearer(second.accessToken)).send({ reason: "Blurry photo" }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(responses.find((r) => r.status === 409)!.body.error.code).toBe("ALREADY_REVIEWED");
    expect(await prisma.auditLog.count({ where: { targetId: student.verificationId } })).toBe(1);
  });

  it("refuses to decide a card twice", async () => {
    const moderator = await admin();
    const student = await pendingStudent();
    await api().post(`${base}/${student.verificationId}/approve`).set(bearer(moderator.accessToken));

    const again = await api().post(`${base}/${student.verificationId}/approve`).set(bearer(moderator.accessToken));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REVIEWED");
  });

  it("does not let an admin review their own card", async () => {
    const moderator = await pendingStudent({ role: "MODERATOR" });

    const response = await api().post(`${base}/${moderator.verificationId}/approve`).set(bearer(moderator.accessToken));

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("CANNOT_REVIEW_OWN_VERIFICATION");
  });
});
