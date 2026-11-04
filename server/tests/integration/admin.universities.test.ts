import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { api, bearer, createUniversity, registerUser } from "./helpers.js";

const base = "/api/admin/universities";
const superAdmin = () => registerUser({ role: "SUPER_ADMIN" });

describe("admin universities", () => {
  it("is for super admins only", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    const user = await registerUser();

    for (const token of [moderator.accessToken, user.accessToken]) {
      const response = await api().post(base).set(bearer(token)).send({ name: "New University" });
      expect(response.status).toBe(403);
    }
    expect(await prisma.university.count({ where: { name: "New University" } })).toBe(0);
  });

  it("creates a university with normalised domains and audits it", async () => {
    const admin = await superAdmin();

    const response = await api()
      .post(base)
      .set(bearer(admin.accessToken))
      .send({ name: "  Dhaka Tech University ", shortName: "DTU", domains: ["@DTU.edu.bd", "student.dtu.edu.bd", "dtu.edu.bd"] });

    expect(response.status).toBe(201);
    expect(response.body.university).toMatchObject({ name: "Dhaka Tech University", shortName: "DTU", isActive: true, userCount: 0 });
    expect(response.body.university.domains.map((d: { domain: string }) => d.domain)).toEqual([
      "dtu.edu.bd",
      "student.dtu.edu.bd",
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: response.body.university.id } });
    expect(audit).toMatchObject({
      adminId: admin.id,
      action: "UNIVERSITY_CREATED",
      targetType: "university",
      newValue: { name: "Dhaka Tech University", shortName: "DTU", domains: ["dtu.edu.bd", "student.dtu.edu.bd"] },
    });

    const list = await api().get(base).set(bearer(admin.accessToken));
    expect(list.body.universities.some((u: { id: string }) => u.id === response.body.university.id)).toBe(true);
  });

  it("refuses a duplicate name, a domain another university has and an invalid domain", async () => {
    const admin = await superAdmin();
    await api().post(base).set(bearer(admin.accessToken)).send({ name: "Alpha University", domains: ["alpha.edu"] });

    const name = await api().post(base).set(bearer(admin.accessToken)).send({ name: "Alpha University" });
    const domain = await api().post(base).set(bearer(admin.accessToken)).send({ name: "Beta University", domains: ["alpha.edu"] });
    const invalid = await api().post(base).set(bearer(admin.accessToken)).send({ name: "Gamma University", domains: ["not a domain"] });

    expect(name.body.error.code).toBe("UNIVERSITY_NAME_TAKEN");
    expect(domain.body.error.code).toBe("DOMAIN_TAKEN");
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("updates and deactivates a university; the public list hides inactive ones", async () => {
    const admin = await superAdmin();
    const university = await createUniversity();

    const response = await api()
      .patch(`${base}/${university.id}`)
      .set(bearer(admin.accessToken))
      .send({ shortName: "U1", isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.university).toMatchObject({ shortName: "U1", isActive: false });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: university.id, action: "UNIVERSITY_UPDATED" } });
    expect(audit.oldValue).toEqual({ shortName: null, isActive: true });
    expect(audit.newValue).toEqual({ shortName: "U1", isActive: false });

    const publicList = await api().get("/api/universities");
    expect(publicList.body.universities.some((u: { id: string }) => u.id === university.id)).toBe(false);

    const empty = await api().patch(`${base}/${university.id}`).set(bearer(admin.accessToken)).send({});
    expect(empty.body.error.code).toBe("VALIDATION_ERROR");
    const missing = await api()
      .patch(`${base}/00000000-0000-7000-8000-000000000000`)
      .set(bearer(admin.accessToken))
      .send({ isActive: true });
    expect(missing.body.error.code).toBe("UNIVERSITY_NOT_FOUND");
  });

  it("deletes only a university without users", async () => {
    const admin = await superAdmin();
    const empty = await createUniversity();

    const withUsers = await api().delete(`${base}/${admin.universityId}`).set(bearer(admin.accessToken));
    expect(withUsers.status).toBe(409);
    expect(withUsers.body.error.code).toBe("UNIVERSITY_HAS_USERS");

    const response = await api().delete(`${base}/${empty.id}`).set(bearer(admin.accessToken));
    expect(response.status).toBe(204);
    expect(await prisma.university.findUnique({ where: { id: empty.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { targetId: empty.id, action: "UNIVERSITY_DELETED" } })).toBe(1);
  });

  it("adds and removes domains, which email verification uses at once", async () => {
    const admin = await superAdmin();
    const student = await registerUser();

    const added = await api()
      .post(`${base}/${student.universityId}/domains`)
      .set(bearer(admin.accessToken))
      .send({ domain: "Mail.Example.edu" });
    expect(added.status).toBe(201);
    expect(added.body.domain.domain).toBe("mail.example.edu");

    const send = () =>
      api().post("/api/verification/student/email/send").set(bearer(student.accessToken)).send({ email: "s@mail.example.edu" });
    expect((await send()).status).toBe(200);
    expect(sentEmails).toHaveLength(1);

    const removed = await api()
      .delete(`${base}/${student.universityId}/domains/${added.body.domain.id}`)
      .set(bearer(admin.accessToken));
    expect(removed.status).toBe(204);
    expect(
      await prisma.auditLog.count({
        where: { targetId: student.universityId, action: { in: ["UNIVERSITY_DOMAIN_ADDED", "UNIVERSITY_DOMAIN_REMOVED"] } },
      }),
    ).toBe(2);

    // A code sent before the domain was removed no longer verifies.
    const code = sentEmails[0].text.match(/\b(\d{6})\b/)![1];
    const confirm = await api()
      .post("/api/verification/student/email/confirm")
      .set(bearer(student.accessToken))
      .send({ code });
    expect(confirm.body.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");

    const missing = await api()
      .delete(`${base}/${student.universityId}/domains/${added.body.domain.id}`)
      .set(bearer(admin.accessToken));
    expect(missing.body.error.code).toBe("DOMAIN_NOT_FOUND");
  });
});
