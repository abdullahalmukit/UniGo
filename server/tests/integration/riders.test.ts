import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { env } from "../../src/config/env.js";
import { rules } from "../../src/config/rules.js";
import { runAccountStatusJob } from "../../src/jobs/account-status.job.js";
import { prisma } from "../../src/lib/prisma.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { sentEmails } from "../../src/modules/email/email.service.js";
import { settleBackgroundTasks } from "../../src/utils/background.js";
import { addYearsToDateString, dateOnly, dhakaDateString } from "../../src/utils/time.js";
import { api, bearer, files, registerUser } from "./helpers.js";

let photo: Buffer;
beforeAll(async () => {
  photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#cc3333" } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: "plate-photo-owner" } } })
    .toBuffer();
});

const inYears = (years: number) => addYearsToDateString(dhakaDateString(), years);
const bike = (registrationNumber = "Dhaka Metro-HA 12-3456") => ({
  type: "BIKE",
  brand: "Honda",
  model: "CB Hornet",
  colour: "Red",
  registrationNumber,
  seatCapacity: 1,
});
const car = (registrationNumber = "Dhaka Metro-GA 11-2233") => ({ ...bike(registrationNumber), type: "CAR", brand: "Toyota", model: "Axio", seatCapacity: 4 });

type Submission = {
  vehicles?: Record<string, unknown>[];
  licenceExpiresOn?: string;
  nid?: boolean;
  carLicence?: boolean;
  motorcycleLicence?: boolean;
  photos?: number;
};

function apply(token: string, submission: Submission = {}) {
  const vehicles = submission.vehicles ?? [bike()];
  const request = api()
    .post("/api/rider/applications")
    .set(bearer(token))
    .field("data", JSON.stringify({ licenceExpiresOn: submission.licenceExpiresOn ?? inYears(2), vehicles }));
  if (submission.nid ?? true) {
    request.attach("nidFront", files.png, { filename: "front.png", contentType: "image/png" });
    request.attach("nidBack", files.pdf, { filename: "back.pdf", contentType: "application/pdf" });
  }
  if (submission.motorcycleLicence ?? true) {
    request.attach("motorcycleLicence", files.jpg, { filename: "lic.jpg", contentType: "image/jpeg" });
  }
  if (submission.carLicence) request.attach("carLicence", files.pdf, { filename: "car.pdf", contentType: "application/pdf" });
  for (let i = 0; i < (submission.photos ?? vehicles.length); i += 1) {
    request.attach("vehiclePhotos", photo, { filename: `v${i}.jpg`, contentType: "image/jpeg" });
  }
  return request;
}

const verifiedStudent = (overrides: Parameters<typeof registerUser>[0] = {}) =>
  registerUser({ studentVerificationStatus: "VERIFIED", ...overrides });
const moderator = () => registerUser({ role: "MODERATOR" });
const superAdmin = () => registerUser({ role: "SUPER_ADMIN" });

async function approvedRider() {
  const user = await verifiedStudent();
  await apply(user.accessToken).expect(201);
  const application = await prisma.riderApplication.findFirstOrThrow({ where: { userId: user.id } });
  const admin = await moderator();
  await api().post(`/api/admin/rider-applications/${application.id}/approve`).set(bearer(admin.accessToken)).expect(204);
  await settleBackgroundTasks();
  sentEmails.length = 0;
  return { user, application, admin };
}

describe("applying to become a rider", () => {
  it("stores the documents and vehicle privately and puts the application under review", async () => {
    const user = await verifiedStudent();

    const response = await apply(user.accessToken, { vehicles: [bike(), car()], carLicence: true });

    expect(response.status).toBe(201);
    expect(response.body.latestApplication).toMatchObject({
      kind: "INITIAL",
      status: "PENDING",
      documents: expect.arrayContaining(["NID_FRONT", "NID_BACK", "CAR_LICENCE", "MOTORCYCLE_LICENCE"]),
      vehicleCount: 2,
    });
    expect(response.body.vehicles).toHaveLength(2);
    // The rider sees their own full number; the photo only through a signed link.
    expect(response.body.vehicles[0]).toMatchObject({ registrationNumber: "Dhaka Metro-HA 12-3456", status: "PENDING" });
    expect(response.body.vehicles[0].photo.url).toMatch(/^\/api\/files\//);
    expect(JSON.stringify(response.body)).not.toMatch(/rider-documents|vehicle-photos/);
    expect(response.body.limits).toMatchObject({ maxActiveVehicles: rules.rider.maxActiveVehicles });

    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { ownerId: user.id, type: "BIKE" } });
    expect(vehicle.registrationNumberNormalized).toBe("DHAKAMETROHA123456");
    // The stored vehicle photo is a re-encoded JPEG without EXIF data.
    const stored = await sharp(path.resolve(env.PRIVATE_STORAGE_DIR, vehicle.photoKey)).metadata();
    expect(stored.format).toBe("jpeg");
    expect(stored.exif).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isVerifiedRider).toBe(false);
  });

  it("is only for verified students on an active account", async () => {
    const unverified = await registerUser();
    const restricted = await verifiedStudent({ accountStatus: "RESTRICTED" });

    const a = await apply(unverified.accessToken);
    const b = await apply(restricted.accessToken);
    expect(a.status).toBe(403);
    expect(a.body.error.code).toBe("NOT_VERIFIED");
    expect(b.status).toBe(403);
    expect(b.body.error.code).toBe("ACCOUNT_RESTRICTED");
    expect(await prisma.riderApplication.count()).toBe(0);
  });

  it("needs the NID, a licence that matches each vehicle and one photo per vehicle", async () => {
    const user = await verifiedStudent();
    const folder = path.resolve(env.PRIVATE_STORAGE_DIR, "rider-documents");
    const before = existsSync(folder) ? readdirSync(folder).length : 0;

    const noNid = await apply(user.accessToken, { nid: false });
    const noPhoto = await apply(user.accessToken, { photos: 0 });
    const carWithoutCarLicence = await apply(user.accessToken, { vehicles: [car()] });
    const noVehicles = await apply(user.accessToken, { vehicles: [] });

    expect(noNid.status).toBe(400);
    expect(Object.keys(noNid.body.error.fields)).toEqual(expect.arrayContaining(["nidFront", "nidBack"]));
    expect(noPhoto.body.error.fields).toHaveProperty("vehicles.0.photo");
    expect(carWithoutCarLicence.body.error.code).toBe("LICENCE_DOES_NOT_MATCH");
    expect(noVehicles.body.error.fields).toHaveProperty("vehicles");
    expect(await prisma.riderApplication.count()).toBe(0);
    // Nothing was left behind in storage.
    expect(existsSync(folder) ? readdirSync(folder).length : 0).toBe(before);
  });

  it("checks seats, licence expiry and file types", async () => {
    const user = await verifiedStudent();

    const seats = await apply(user.accessToken, { vehicles: [{ ...bike(), seatCapacity: 2 }] });
    const expired = await apply(user.accessToken, { licenceExpiresOn: dhakaDateString() });
    const tooFar = await apply(user.accessToken, { licenceExpiresOn: inYears(rules.rider.licenceMaxYearsAhead + 1) });
    const pdfPhoto = await api()
      .post("/api/rider/applications")
      .set(bearer(user.accessToken))
      .field("data", JSON.stringify({ licenceExpiresOn: inYears(2), vehicles: [bike()] }))
      .attach("vehiclePhotos", files.pdf, { filename: "v.pdf", contentType: "application/pdf" });

    expect(seats.status).toBe(400);
    expect(seats.body.error.fields).toHaveProperty("vehicles.0.seatCapacity");
    expect(expired.body.error.fields).toHaveProperty("licenceExpiresOn");
    expect(tooFar.body.error.fields).toHaveProperty("licenceExpiresOn");
    expect(pdfPhoto.status).toBe(415);
  });

  it("allows one application under review at a time, also when two arrive together", async () => {
    const user = await verifiedStudent();
    const [a, b] = await Promise.all([apply(user.accessToken), apply(user.accessToken, { vehicles: [bike("Dhaka Metro-HA 99-0001")] })]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe("APPLICATION_PENDING");
    expect(await prisma.riderApplication.count({ where: { userId: user.id } })).toBe(1);
  });

  it("refuses a registration number another rider has pending or approved, however it is typed", async () => {
    const first = await verifiedStudent();
    const second = await verifiedStudent();
    await apply(first.accessToken).expect(201);

    const response = await apply(second.accessToken, { vehicles: [bike("dhaka metro ha ১২৩৪৫৬")] });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("REGISTRATION_TAKEN");
    expect(response.body.error.fields).toHaveProperty("vehicles.0.registrationNumber");
    expect(await prisma.vehicle.count()).toBe(1);
  });

  it("is limited per account", async () => {
    const user = await registerUser();
    for (let i = 0; i < rules.rider.applicationsPerUser.max; i += 1) await apply(user.accessToken);
    expect((await apply(user.accessToken)).status).toBe(429);
  });
});

describe("admin review", () => {
  it("lists pending applications and opens each document through a short signed link", async () => {
    const user = await verifiedStudent();
    await apply(user.accessToken).expect(201);
    const admin = await moderator();

    const list = await api().get("/api/admin/rider-applications").set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({ kind: "INITIAL", status: "PENDING", vehicleCount: 1 })]);
    expect(list.body.items[0].user).toMatchObject({ id: user.id, isVerifiedRider: false });

    const detail = await api().get(`/api/admin/rider-applications/${list.body.items[0].id}`).set(bearer(admin.accessToken));
    const { application } = detail.body;
    expect(application.documents.map((d: { type: string }) => d.type).sort()).toEqual(["MOTORCYCLE_LICENCE", "NID_BACK", "NID_FRONT"]);
    // Admins see the full number.
    expect(application.vehicles[0]).toMatchObject({ registrationNumber: "Dhaka Metro-HA 12-3456" });
    expect(application.vehicles[0].photo.url).toMatch(/^\/api\/files\//);
    expect(JSON.stringify(application)).not.toMatch(/rider-documents\//);

    const nid = application.documents.find((d: { type: string }) => d.type === "NID_BACK");
    const link = await api()
      .get(`/api/admin/rider-applications/${application.id}/documents/${nid.id}/file-url`)
      .set(bearer(admin.accessToken));
    expect(link.body).toMatchObject({ mimeType: "application/pdf" });
    const file = await api().get(link.body.url);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");

    // Students cannot use the admin endpoints.
    expect((await api().get("/api/admin/rider-applications").set(bearer(user.accessToken))).status).toBe(403);
  });

  it("approves the whole application: rider badge, vehicles approved, audit log and email", async () => {
    const { user, application, admin } = await (async () => {
      const user = await verifiedStudent();
      await apply(user.accessToken, { vehicles: [bike(), car()], carLicence: true }).expect(201);
      const application = await prisma.riderApplication.findFirstOrThrow({ where: { userId: user.id } });
      return { user, application, admin: await moderator() };
    })();

    const response = await api().post(`/api/admin/rider-applications/${application.id}/approve`).set(bearer(admin.accessToken));

    expect(response.status).toBe(204);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isVerifiedRider).toBe(true);
    expect(await prisma.vehicle.count({ where: { ownerId: user.id, status: "APPROVED" } })).toBe(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "RIDER_APPLICATION_APPROVED" } });
    expect(audit).toMatchObject({ adminId: admin.id, targetUserId: user.id, targetId: application.id });
    await settleBackgroundTasks();
    expect(sentEmails.map((e) => e.to)).toEqual([user.email]);
    expect(sentEmails[0].subject).toBe("You are now a UniGo rider");

    const overview = await api().get("/api/rider").set(bearer(user.accessToken));
    expect(overview.body).toMatchObject({ isVerifiedRider: true, riderActive: false, licenceExpired: false, activeBlocker: null });
  });

  it("rejects with a reason; the rider fixes and re-applies, updating the same vehicle row", async () => {
    const user = await verifiedStudent();
    await apply(user.accessToken).expect(201);
    const application = await prisma.riderApplication.findFirstOrThrow({ where: { userId: user.id } });
    const vehicleBefore = await prisma.vehicle.findFirstOrThrow({ where: { ownerId: user.id } });
    const admin = await moderator();

    const short = await api().post(`/api/admin/rider-applications/${application.id}/reject`).set(bearer(admin.accessToken)).send({ reason: "x" });
    expect(short.status).toBe(400);
    await api()
      .post(`/api/admin/rider-applications/${application.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: "The vehicle photo is blurry" })
      .expect(204);

    const overview = await api().get("/api/rider").set(bearer(user.accessToken));
    expect(overview.body.latestApplication).toMatchObject({ status: "REJECTED", rejectionReason: "The vehicle photo is blurry" });
    expect(overview.body.vehicles[0]).toMatchObject({ status: "REJECTED" });
    await settleBackgroundTasks();
    expect(sentEmails.at(-1)!.text).toContain("The vehicle photo is blurry");

    await apply(user.accessToken, { vehicles: [{ ...bike(), colour: "Black" }] }).expect(201);
    const vehicles = await prisma.vehicle.findMany({ where: { ownerId: user.id } });
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ id: vehicleBefore.id, colour: "Black", status: "PENDING", rejectionReason: null });
    expect(vehicles[0].applicationId).not.toBe(application.id);
    // The replaced photo file was removed.
    expect(existsSync(path.resolve(env.PRIVATE_STORAGE_DIR, vehicleBefore.photoKey))).toBe(false);
  });

  it("lets another user register a plate from a rejected application", async () => {
    const first = await verifiedStudent();
    await apply(first.accessToken).expect(201);
    const application = await prisma.riderApplication.findFirstOrThrow({ where: { userId: first.id } });
    const admin = await moderator();
    await api()
      .post(`/api/admin/rider-applications/${application.id}/reject`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Not your vehicle" })
      .expect(204);

    const second = await verifiedStudent();
    await apply(second.accessToken).expect(201);
    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { registrationNumberNormalized: "DHAKAMETROHA123456" } });
    expect(vehicle.ownerId).toBe(second.id);
    expect(vehicle.status).toBe("PENDING");
  });

  it("lets only one of two admins decide, and never one's own application", async () => {
    const user = await verifiedStudent({ role: "MODERATOR" });
    await apply(user.accessToken).expect(201);
    const application = await prisma.riderApplication.findFirstOrThrow({ where: { userId: user.id } });
    const [a, b] = [await moderator(), await superAdmin()];

    const own = await api().post(`/api/admin/rider-applications/${application.id}/approve`).set(bearer(user.accessToken));
    expect(own.status).toBe(403);

    const results = await Promise.all([
      api().post(`/api/admin/rider-applications/${application.id}/approve`).set(bearer(a.accessToken)),
      api().post(`/api/admin/rider-applications/${application.id}/reject`).set(bearer(b.accessToken)).send({ reason: "Documents unclear" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "RIDER_APPLICATION_" } } })).toBe(1);
  });
});

describe("Active switch and re-verification", () => {
  it("lets an approved rider switch Active and Inactive", async () => {
    const { user } = await approvedRider();

    const on = await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true });
    expect(on.status).toBe(200);
    expect(on.body.riderActive).toBe(true);
    const off = await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: false });
    expect(off.body.riderActive).toBe(false);

    const student = await verifiedStudent();
    const refused = await api().patch("/api/rider/active").set(bearer(student.accessToken)).send({ active: true });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("NOT_A_RIDER");
  });

  it("sets the rider Inactive when the licence expires, until a re-verification is approved", async () => {
    const { user, application, admin } = await approvedRider();
    await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true }).expect(200);

    // The licence expired yesterday (Asia/Dhaka).
    const yesterday = addYearsToDateString(dhakaDateString(new Date(Date.now() - 24 * 60 * 60 * 1000)), 0);
    await prisma.riderApplication.update({ where: { id: application.id }, data: { licenceExpiresOn: dateOnly(yesterday) } });
    const result = await runAccountStatusJob();
    expect(result.ridersDeactivated).toBe(1);
    expect((await runAccountStatusJob()).ridersDeactivated).toBe(0);

    const overview = await api().get("/api/rider").set(bearer(user.accessToken));
    expect(overview.body).toMatchObject({ riderActive: false, licenceExpired: true, activeBlocker: "LICENCE_EXPIRED" });
    const blocked = await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true });
    expect(blocked.body.error.code).toBe("LICENCE_EXPIRED");

    // Re-verification: the renewed licence (no NID) and a later date.
    const renewed = await apply(user.accessToken, { nid: false, vehicles: [] });
    expect(renewed.status).toBe(201);
    expect(renewed.body.latestApplication).toMatchObject({ kind: "REVERIFICATION", status: "PENDING", documents: ["MOTORCYCLE_LICENCE"] });
    await api().post(`/api/admin/rider-applications/${renewed.body.latestApplication.id}/approve`).set(bearer(admin.accessToken)).expect(204);
    await settleBackgroundTasks();
    expect(sentEmails.at(-1)!.subject).toBe("Your UniGo rider re-verification is approved");

    const back = await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ riderActive: true, licenceExpired: false });
  });

  it("re-verification must cover every vehicle, bring a later expiry and respect the vehicle limit", async () => {
    const { user } = await approvedRider();

    // Adding a car needs the car licence too.
    const carWithoutLicence = await apply(user.accessToken, { nid: false, vehicles: [car()] });
    expect(carWithoutLicence.body.error.code).toBe("LICENCE_DOES_NOT_MATCH");
    // Dropping the motorcycle licence would leave the approved bike uncovered.
    const onlyCar = await apply(user.accessToken, { nid: false, vehicles: [car()], carLicence: true, motorcycleLicence: false });
    expect(onlyCar.body.error.code).toBe("LICENCE_DOES_NOT_MATCH");
    const sameDate = await apply(user.accessToken, { nid: false, vehicles: [], licenceExpiresOn: inYears(1) });
    expect(sameDate.body.error.code).toBe("LICENCE_EXPIRY_NOT_LATER");
    const already = await apply(user.accessToken, { nid: false, vehicles: [bike()], licenceExpiresOn: inYears(3) });
    expect(already.body.error.code).toBe("VEHICLE_ALREADY_REGISTERED");

    resetRateLimits();
    const many = Array.from({ length: rules.rider.maxActiveVehicles }, (_, i) => bike(`Dhaka Metro-HA 55-00${i}0`));
    const tooMany = await apply(user.accessToken, { nid: false, vehicles: many, licenceExpiresOn: inYears(3) });
    expect(tooMany.body.error.code).toBe("VEHICLE_LIMIT_REACHED");

    const addCar = await apply(user.accessToken, { nid: false, vehicles: [car()], carLicence: true, licenceExpiresOn: inYears(3) });
    expect(addCar.status).toBe(201);
  });
});

describe("rider suspension", () => {
  it("is Super Admin only, sets the rider Inactive, and is lifted by reinstating", async () => {
    const { user, admin: mod } = await approvedRider();
    await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true }).expect(200);
    const admin = await superAdmin();

    const byModerator = await api().post(`/api/admin/riders/${user.id}/suspend`).set(bearer(mod.accessToken)).send({ reason: "Late often" });
    expect(byModerator.status).toBe(403);

    const suspended = await api().post(`/api/admin/riders/${user.id}/suspend`).set(bearer(admin.accessToken)).send({ reason: "Unsafe driving" });
    expect(suspended.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ riderSuspended: true, riderActive: false, isVerifiedRider: true });
    expect((await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true })).body.error.code).toBe("RIDER_SUSPENDED");
    expect(await prisma.moderationAction.findFirst({ where: { userId: user.id, type: "RIDER_SUSPEND" } })).toMatchObject({ reason: "Unsafe driving" });
    expect(await prisma.auditLog.count({ where: { action: "RIDER_SUSPEND", targetUserId: user.id } })).toBe(1);

    const again = await api().post(`/api/admin/riders/${user.id}/suspend`).set(bearer(admin.accessToken)).send({ reason: "Twice" });
    expect(again.status).toBe(409);

    const list = await api().get("/api/admin/riders?status=SUSPENDED").set(bearer(mod.accessToken));
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([user.id]);

    await api().post(`/api/admin/riders/${user.id}/reinstate`).set(bearer(admin.accessToken)).send({ reason: "Appeal accepted" }).expect(200);
    expect((await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true })).status).toBe(200);
    await settleBackgroundTasks();
    expect(sentEmails.map((e) => e.subject)).toEqual(["Your UniGo rider access is suspended", "Your UniGo rider access is back"]);
  });

  it("ends a suspension with an end date through the job", async () => {
    const { user } = await approvedRider();
    const admin = await superAdmin();
    await api()
      .post(`/api/admin/riders/${user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Cooling off", endsAt: new Date(Date.now() + 60_000).toISOString() })
      .expect(200);

    expect((await runAccountStatusJob()).riderSuspensionsEnded).toBe(0);
    expect((await runAccountStatusJob(new Date(Date.now() + 2 * 60_000))).riderSuspensionsEnded).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).riderSuspended).toBe(false);
  });

  it("sets a rider Inactive when the account is restricted", async () => {
    const { user } = await approvedRider();
    await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true }).expect(200);
    const admin = await superAdmin();

    await api().post(`/api/admin/users/${user.id}/restrict`).set(bearer(admin.accessToken)).send({ reason: "Spam posts" }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).riderActive).toBe(false);
    const refused = await api().patch("/api/rider/active").set(bearer(user.accessToken)).send({ active: true });
    expect(refused.body.error.code).toBe("ACCOUNT_RESTRICTED");
  });
});

describe("rider dashboard", () => {
  it("shows zero counters until rides exist, for riders only", async () => {
    const { user } = await approvedRider();
    const dashboard = await api().get("/api/rider/dashboard").set(bearer(user.accessToken));
    expect(dashboard.body).toMatchObject({ totalRides: 0, completed: 0, completionRate: null, earnings: 0 });

    const student = await verifiedStudent();
    expect((await api().get("/api/rider/dashboard").set(bearer(student.accessToken))).status).toBe(403);
  });
});
