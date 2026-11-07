import { rules } from "../../config/rules.js";
import type { ApprovalStatus, Prisma } from "../../generated/prisma/client.js";
import { mimeTypeForKey } from "../../lib/private-storage.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import { dateOnlyString } from "../../utils/time.js";
import { recordAudit } from "../admin/audit-log.js";
import { runInBackground } from "../../utils/background.js";
import { notify } from "../notifications/notify.service.js";
import { currentLicenceExpiry, licenceExpired, riderSuspensionInForce } from "./rider-status.js";

// Rider Requests in the admin panel (proposal sections 6 and 17, B1 decisions).
// Moderators and Super Admins review applications; only Super Admins suspend or
// reinstate riders. Every decision is audited and emailed.

const applicantSelect = {
  id: true,
  email: true,
  phone: true,
  language: true,
  studentVerificationStatus: true,
  isVerifiedRider: true,
  riderActive: true,
  riderSuspended: true,
  riderSuspendedUntil: true,
  university: { select: { id: true, name: true, shortName: true } },
  profile: { select: { fullName: true } },
} satisfies Prisma.UserSelect;

type Applicant = Prisma.UserGetPayload<{ select: typeof applicantSelect }>;

const toApplicant = ({ profile, language: _language, riderSuspended, riderSuspendedUntil, ...user }: Applicant) => ({
  ...user,
  name: profile?.fullName ?? null,
  riderSuspended: riderSuspensionInForce({ riderSuspended, riderSuspendedUntil }),
  riderSuspendedUntil,
});

export async function listApplications(status: ApprovalStatus, page: number) {
  const pageSize = rules.admin.pageSize;
  const where = { status };
  const [total, rows] = await Promise.all([
    prisma.riderApplication.count({ where }),
    prisma.riderApplication.findMany({
      where,
      // The longest-waiting first; decided ones newest first.
      orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        kind: true,
        status: true,
        licenceExpiresOn: true,
        createdAt: true,
        reviewedAt: true,
        rejectionReason: true,
        user: { select: applicantSelect },
        _count: { select: { vehicles: true } },
      },
    }),
  ]);

  return {
    items: rows.map(({ licenceExpiresOn, createdAt, user, _count, ...row }) => ({
      ...row,
      licenceExpiresOn: dateOnlyString(licenceExpiresOn),
      submittedAt: createdAt,
      vehicleCount: _count.vehicles,
      user: toApplicant(user),
    })),
    page,
    pageSize,
    total,
  };
}

const vehicleSelect = {
  id: true,
  type: true,
  brand: true,
  model: true,
  colour: true,
  registrationNumber: true,
  seatCapacity: true,
  status: true,
  rejectionReason: true,
  photoKey: true,
} satisfies Prisma.VehicleSelect;

type VehicleRow = Prisma.VehicleGetPayload<{ select: typeof vehicleSelect }>;

// Admins see the full registration number and the photo through a short link.
const toAdminVehicle = async ({ photoKey, ...vehicle }: VehicleRow) => ({
  ...vehicle,
  photo: await signPrivateFileUrl(photoKey),
});

// One application with everything needed to decide it: documents (opened one
// by one through signed links), vehicles, documents already on file from the
// rider's approved application (for a re-verification), and the history.
export async function getApplication(applicationId: string) {
  const row = await prisma.riderApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      kind: true,
      status: true,
      licenceExpiresOn: true,
      createdAt: true,
      reviewedAt: true,
      rejectionReason: true,
      reviewedBy: { select: { id: true, profile: { select: { fullName: true } } } },
      user: { select: applicantSelect },
      documents: { select: { id: true, type: true, mimeType: true, sizeBytes: true }, orderBy: { type: "asc" } },
      vehicles: { select: vehicleSelect, orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) throw notFound();
  const userId = row.user.id;

  const [onFile, approvedVehicles, history, licence] = await Promise.all([
    prisma.riderDocument.findMany({
      where: { application: { userId, status: "APPROVED", id: { not: row.id } } },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, mimeType: true, sizeBytes: true, applicationId: true },
    }),
    prisma.vehicle.findMany({
      where: { ownerId: userId, status: "APPROVED", isActive: true, applicationId: { not: row.id } },
      select: vehicleSelect,
    }),
    prisma.riderApplication.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, kind: true, status: true, createdAt: true, reviewedAt: true, rejectionReason: true, licenceExpiresOn: true },
    }),
    currentLicenceExpiry(prisma, userId),
  ]);

  const { licenceExpiresOn, createdAt, reviewedBy, user, vehicles, ...rest } = row;
  // The newest file of each type already on file
  const latestOnFile = [...new Map(onFile.map((d) => [d.type, d])).values()];

  return {
    ...rest,
    licenceExpiresOn: dateOnlyString(licenceExpiresOn),
    submittedAt: createdAt,
    reviewedBy: reviewedBy && { id: reviewedBy.id, name: reviewedBy.profile?.fullName ?? null },
    user: { ...toApplicant(user), licenceExpiresOn: licence, licenceExpired: licence !== null && licenceExpired(licence) },
    vehicles: await Promise.all(vehicles.map(toAdminVehicle)),
    documentsOnFile: latestOnFile.map(({ applicationId: _a, ...d }) => d),
    approvedVehicles: await Promise.all(approvedVehicles.map(toAdminVehicle)),
    history: history.map(({ licenceExpiresOn: date, createdAt: submittedAt, ...h }) => ({
      ...h,
      submittedAt,
      licenceExpiresOn: dateOnlyString(date),
    })),
  };
}

// A 5-minute link to one document of the applicant (this application or one
// already on file). Never stored or logged.
export async function documentFileUrl(applicationId: string, documentId: string) {
  const application = await prisma.riderApplication.findUnique({ where: { id: applicationId }, select: { userId: true } });
  if (!application) throw notFound();
  const document = await prisma.riderDocument.findFirst({
    where: { id: documentId, application: { userId: application.userId } },
    select: { fileKey: true },
  });
  if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
  return { ...(await signPrivateFileUrl(document.fileKey)), mimeType: mimeTypeForKey(document.fileKey) };
}

export function approveApplication(adminId: string, applicationId: string, ipAddress?: string) {
  return decide(adminId, applicationId, { status: "APPROVED" }, ipAddress);
}

export function rejectApplication(adminId: string, applicationId: string, reason: string, ipAddress?: string) {
  return decide(adminId, applicationId, { status: "REJECTED", reason }, ipAddress);
}

// The whole application is approved or rejected, with all its vehicles (B1 decision 2).
async function decide(
  adminId: string,
  applicationId: string,
  decision: { status: "APPROVED" } | { status: "REJECTED"; reason: string },
  ipAddress?: string,
) {
  const now = new Date();
  const reason = decision.status === "REJECTED" ? decision.reason : null;

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.riderApplication.findUnique({
      where: { id: applicationId },
      select: { userId: true, kind: true, licenceExpiresOn: true, user: { select: applicantSelect } },
    });
    if (!row) throw notFound();
    if (row.userId === adminId) {
      throw new AppError(403, "CANNOT_REVIEW_OWN_VERIFICATION", "Another admin must review your own application");
    }

    // Conditional, so two admins deciding at once cannot both succeed.
    const claimed = await tx.riderApplication.updateMany({
      where: { id: applicationId, status: "PENDING" },
      data: { status: decision.status, reviewedById: adminId, reviewedAt: now, rejectionReason: reason },
    });
    if (claimed.count === 0) throw new AppError(409, "ALREADY_REVIEWED", "This application has already been reviewed");

    const vehicles = await tx.vehicle.updateMany({
      where: { applicationId, status: "PENDING" },
      data: { status: decision.status, reviewedById: adminId, reviewedAt: now, rejectionReason: reason },
    });
    if (decision.status === "APPROVED") {
      await tx.user.update({ where: { id: row.userId }, data: { isVerifiedRider: true } });
    }

    await recordAudit(tx, {
      adminId,
      action: decision.status === "APPROVED" ? "RIDER_APPLICATION_APPROVED" : "RIDER_APPLICATION_REJECTED",
      targetType: "rider_application",
      targetId: applicationId,
      targetUserId: row.userId,
      oldValue: { status: "PENDING", isVerifiedRider: row.user.isVerifiedRider },
      newValue: {
        status: decision.status,
        kind: row.kind,
        vehicles: vehicles.count,
        licenceExpiresOn: dateOnlyString(row.licenceExpiresOn),
        isVerifiedRider: decision.status === "APPROVED" || row.user.isVerifiedRider,
        ...(reason && { reason }),
      },
      ipAddress,
    });
    return row;
  });

  runInBackground("rider application notification", () =>
    notify({
      type: "RIDER_VERIFICATION_RESULT",
      userIds: [result.userId],
      dedupeKey: `RIDER_VERIFICATION_RESULT:${applicationId}`,
      data: { kind: decision.status, ...(reason && { reason }), reverification: result.kind === "REVERIFICATION" },
    }),
  );
}

export type RiderFilters = { q?: string; status?: "ACTIVE" | "INACTIVE" | "SUSPENDED"; page: number };

// Approved riders with their state and current licence expiry.
export async function listRiders({ q, status, page }: RiderFilters, now = new Date()) {
  const pageSize = rules.admin.pageSize;
  const suspended = { riderSuspended: true, OR: [{ riderSuspendedUntil: null }, { riderSuspendedUntil: { gt: now } }] };
  const where: Prisma.UserWhereInput = {
    isVerifiedRider: true,
    ...(q && { OR: [{ email: { contains: q } }, { phone: { contains: q } }, { profile: { fullName: { contains: q } } }] }),
    ...(status === "ACTIVE" && { riderActive: true }),
    ...(status === "INACTIVE" && { riderActive: false, NOT: suspended }),
    ...(status === "SUSPENDED" && suspended),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...applicantSelect,
        riderApplications: {
          where: { status: "APPROVED" },
          orderBy: { licenceExpiresOn: "desc" },
          take: 1,
          select: { licenceExpiresOn: true },
        },
        _count: { select: { vehicles: { where: { status: "APPROVED", isActive: true } } } },
      },
    }),
  ]);

  return {
    items: rows.map(({ riderApplications, _count, ...user }) => {
      const licence = riderApplications[0] ? dateOnlyString(riderApplications[0].licenceExpiresOn) : null;
      return {
        ...toApplicant(user),
        licenceExpiresOn: licence,
        licenceExpired: licenceExpired(licence, now),
        vehicleCount: _count.vehicles,
      };
    }),
    page,
    pageSize,
    total,
  };
}

// Super Admin only (B1 decision 8). A suspension has an optional end date; the
// account-status job lifts it then. The rider is set Inactive at once.
export async function suspendRider(
  adminId: string,
  userId: string,
  input: { reason: string; endsAt?: Date | null },
  ipAddress?: string,
  now = new Date(),
) {
  if (input.endsAt && input.endsAt <= now) throw new AppError(400, "INVALID_DATES", "The end date must be in the future");
  return changeRiderAccess(adminId, userId, "RIDER_SUSPEND", input.reason, input.endsAt ?? null, ipAddress, now);
}

export function reinstateRider(adminId: string, userId: string, reason: string, ipAddress?: string, now = new Date()) {
  return changeRiderAccess(adminId, userId, "RIDER_REINSTATE", reason, null, ipAddress, now);
}

async function changeRiderAccess(
  adminId: string,
  userId: string,
  type: "RIDER_SUSPEND" | "RIDER_REINSTATE",
  reason: string,
  endsAt: Date | null,
  ipAddress: string | undefined,
  now: Date,
) {
  if (userId === adminId) throw new AppError(403, "CANNOT_MODERATE_SELF", "You cannot moderate your own account");
  const suspend = type === "RIDER_SUSPEND";

  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: applicantSelect });
    if (!user || !user.isVerifiedRider) throw new AppError(404, "RIDER_NOT_FOUND", "Rider not found");
    const inForce = riderSuspensionInForce(user, now);
    if (suspend === inForce) {
      throw new AppError(409, "INVALID_STATUS_CHANGE", suspend ? "This rider is already suspended" : "This rider is not suspended");
    }

    // Conditional on what was read, so two admins at once cannot both apply.
    const updated = await tx.user.updateMany({
      where: { id: userId, riderSuspended: user.riderSuspended, riderSuspendedUntil: user.riderSuspendedUntil },
      data: suspend
        ? { riderSuspended: true, riderSuspendedUntil: endsAt, riderActive: false }
        : { riderSuspended: false, riderSuspendedUntil: null },
    });
    if (updated.count === 0) throw new AppError(409, "STATUS_CHANGED", "This rider changed meanwhile. Reload and try again.");

    const moderation = await tx.moderationAction.create({
      select: { id: true },
      data: { userId, adminId, type, reason, startsAt: suspend ? now : null, endsAt },
    });
    await recordAudit(tx, {
      adminId,
      action: type,
      targetType: "user",
      targetId: userId,
      targetUserId: userId,
      oldValue: { riderSuspended: inForce, riderActive: user.riderActive },
      newValue: {
        riderSuspended: suspend,
        riderSuspendedUntil: endsAt?.toISOString() ?? null,
        riderActive: suspend ? false : user.riderActive,
        reason,
      },
      ipAddress,
    });
    return { ...user, moderationId: moderation.id };
  });

  runInBackground(suspend ? "rider suspended notification" : "rider reinstated notification", () =>
    notify({
      type: "RIDER_ACCESS_CHANGED",
      userIds: [userId],
      dedupeKey: `RIDER_ACCESS_CHANGED:${user.moderationId}`,
      data: { kind: suspend ? "SUSPENDED" : "REINSTATED", reason, endsAt: endsAt?.toISOString() },
    }),
  );
  return { riderSuspended: suspend, riderSuspendedUntil: endsAt };
}

const notFound = () => new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
