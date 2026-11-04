import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { api, bearer, files, registerUser } from "./helpers.js";

const superAdmin = () => registerUser({ role: "SUPER_ADMIN" });

describe("admin dashboard", () => {
  it("counts users, verified students and pending verifications; unbuilt features are 0", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    await registerUser({ studentVerificationStatus: "VERIFIED" });
    await registerUser({ accountStatus: "BANNED" });
    const pending = await registerUser();
    await api()
      .post("/api/verification/student/id-card")
      .set(bearer(pending.accessToken))
      .attach("file", files.png, { filename: "card.png", contentType: "image/png" });

    const response = await api().get("/api/admin/dashboard").set(bearer(moderator.accessToken));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalUsers: 4,
      activeUsers: 3,
      verifiedStudents: 1,
      verifiedRiders: 0,
      pendingStudentVerifications: 1,
      pendingRiderApplications: 0,
      openDisputes: 0,
      openReports: 0,
      openNoShowReports: 0,
      newRequestsToday: { ride: 0, carpool: 0, food: 0, service: 0 },
    });
  });
});

describe("admin sub-areas", () => {
  it("is Super Admin only", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    expect((await api().post("/api/admin/sub-areas").set(bearer(moderator.accessToken)).send({ name: "Dhanmondi" })).status).toBe(403);
  });

  it("adds, renames and deactivates sub-areas, with unique names and audit rows", async () => {
    const admin = await superAdmin();
    const created = await api().post("/api/admin/sub-areas").set(bearer(admin.accessToken)).send({ name: " Dhanmondi " });
    expect(created.status).toBe(201);
    expect(created.body.subArea).toMatchObject({ name: "Dhanmondi", isActive: true, userCount: 0, activityCount: 0 });
    const id = created.body.subArea.id;

    const duplicate = await api().post("/api/admin/sub-areas").set(bearer(admin.accessToken)).send({ name: "Dhanmondi" });
    expect(duplicate.body.error.code).toBe("SUB_AREA_NAME_TAKEN");

    const renamed = await api()
      .patch(`/api/admin/sub-areas/${id}`)
      .set(bearer(admin.accessToken))
      .send({ name: "Dhanmondi 27", isActive: false });
    expect(renamed.body.subArea).toMatchObject({ name: "Dhanmondi 27", isActive: false });

    const list = await api().get("/api/admin/sub-areas").set(bearer(admin.accessToken));
    expect(list.body.subAreas.map((s: { name: string }) => s.name)).toEqual(["Dhanmondi 27"]);
    expect(
      (await prisma.auditLog.findMany({ where: { targetId: id }, orderBy: { createdAt: "asc" } })).map((row) => row.action),
    ).toEqual(["SUB_AREA_CREATED", "SUB_AREA_UPDATED"]);
  });

  it("deletes an unused sub-area together with users' selections", async () => {
    const admin = await superAdmin();
    const user = await registerUser();
    const subArea = await prisma.subArea.create({ data: { name: "Mirpur" } });
    await prisma.userSubArea.create({ data: { userId: user.id, subAreaId: subArea.id } });

    const response = await api().delete(`/api/admin/sub-areas/${subArea.id}`).set(bearer(admin.accessToken));

    expect(response.body).toEqual({ deleted: true });
    expect(await prisma.subArea.count()).toBe(0);
    expect(await prisma.userSubArea.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { targetId: subArea.id, action: "SUB_AREA_DELETED" } })).toBe(1);
    expect((await api().delete(`/api/admin/sub-areas/${subArea.id}`).set(bearer(admin.accessToken))).body.error.code).toBe(
      "SUB_AREA_NOT_FOUND",
    );
  });

  it("deactivates a sub-area that an activity uses instead of deleting it", async () => {
    const admin = await superAdmin();
    const user = await registerUser({ studentVerificationStatus: "VERIFIED" });
    const subArea = await prisma.subArea.create({ data: { name: "Uttara" } });
    const startTime = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await prisma.foodRequest.create({
      data: {
        subArea: { connect: { id: subArea.id } },
        activity: { create: { type: "FOOD", status: "OPEN", startTime, creator: { connect: { id: user.id } } } },
        restaurantName: "Cafe",
        restaurantAddress: "Road 1",
        restaurantLat: 23.75,
        restaurantLng: 90.37,
        items: "Rice",
        details: "One plate",
        quantity: 1,
        estimatedBudget: 200,
        pickupAddress: "Road 1",
        pickupLat: 23.75,
        pickupLng: 90.37,
        deliveryAddress: "Hall 2",
        deliveryLat: 23.73,
        deliveryLng: 90.39,
      },
    });

    const response = await api().delete(`/api/admin/sub-areas/${subArea.id}`).set(bearer(admin.accessToken));

    expect(response.body).toEqual({ deleted: false });
    expect((await prisma.subArea.findUniqueOrThrow({ where: { id: subArea.id } })).isActive).toBe(false);
  });
});

describe("admin audit log", () => {
  it("is Super Admin only and filters by action, admin, user and date", async () => {
    const admin = await superAdmin();
    const moderator = await registerUser({ role: "MODERATOR" });
    const target = await registerUser();
    await api().post(`/api/admin/users/${target.id}/warn`).set(bearer(admin.accessToken)).send({ reason: "Spam" });
    await api().post("/api/admin/sub-areas").set(bearer(admin.accessToken)).send({ name: "Banani" });

    expect((await api().get("/api/admin/audit-logs").set(bearer(moderator.accessToken))).status).toBe(403);

    const get = async (query = "") => (await api().get(`/api/admin/audit-logs${query}`).set(bearer(admin.accessToken))).body;
    const all = await get();
    expect(all.total).toBe(2);
    expect(all.items[0].action).toBe("SUB_AREA_CREATED");
    expect(all.items[0].admin).toMatchObject({ id: admin.id, email: admin.email });
    expect(all.actions).toEqual(["SUB_AREA_CREATED", "USER_WARN"]);

    expect((await get("?action=USER_WARN")).items[0].targetUser.id).toBe(target.id);
    expect((await get(`?targetUserId=${target.id}`)).total).toBe(1);
    expect((await get(`?adminId=${moderator.id}`)).total).toBe(0);
    expect((await get(`?from=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`)).total).toBe(0);
    expect((await get("?from=yesterday-ish")).error.code).toBe("VALIDATION_ERROR");
  });

  it("is read-only", async () => {
    const admin = await superAdmin();
    for (const method of ["post", "patch", "delete"] as const) {
      expect((await api()[method]("/api/admin/audit-logs").set(bearer(admin.accessToken))).status).toBe(404);
    }
  });
});

describe("admin ID card file link", () => {
  it("tells the panel the file type", async () => {
    const moderator = await registerUser({ role: "MODERATOR" });
    const student = await registerUser();
    await api()
      .post("/api/verification/student/id-card")
      .set(bearer(student.accessToken))
      .attach("file", files.pdf, { filename: "card.pdf", contentType: "application/pdf" });
    const row = await prisma.studentVerification.findFirstOrThrow({ where: { userId: student.id } });

    const response = await api().get(`/api/admin/student-verifications/${row.id}/file-url`).set(bearer(moderator.accessToken));

    expect(response.body.mimeType).toBe("application/pdf");
  });
});
