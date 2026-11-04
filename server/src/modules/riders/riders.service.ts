import { rules } from "../../config/rules.js";
import { Prisma, type RiderDocumentType, type VehicleType } from "../../generated/prisma/client.js";
import { deletePrivateFile, putPrivateFile } from "../../lib/private-storage.js";
import { prisma } from "../../lib/prisma.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { AppError } from "../../utils/app-error.js";
import type { AllowedMimeType } from "../../utils/file-type.js";
import { normalizeRegistrationNumber } from "../../utils/registration-number.js";
import { dateOnly, dateOnlyString } from "../../utils/time.js";
import { accountStatusSelect, effectiveAccountStatus } from "../auth/account-status.js";
import { processVehiclePhoto } from "../vehicles/vehicles.js";
import { activeBlocker, currentLicenceExpiry, licenceExpired, riderSuspensionInForce } from "./rider-status.js";
import type { ApplicationData } from "./riders.validation.js";

// Drive with UniGo (proposal section 6, B1 decisions): the rider application,
// re-verification, the Active switch and the Rider Dashboard.

export type UploadedFile = { buffer: Buffer; mimetype: string };
export type ApplicationFiles = {
  nidFront?: UploadedFile;
  nidBack?: UploadedFile;
  carLicence?: UploadedFile;
  motorcycleLicence?: UploadedFile;
  vehiclePhotos: UploadedFile[];
};

const { rider } = rules;
// Which licence each vehicle type needs (B1 decision: BIKE -> motorcycle, CAR -> car).
const LICENCE_FOR: Record<VehicleType, "carLicence" | "motorcycleLicence"> = { BIKE: "motorcycleLicence", CAR: "carLicence" };

const userSelect = {
  id: true,
  studentVerificationStatus: true,
  isVerifiedRider: true,
  riderActive: true,
  riderSuspended: true,
  riderSuspendedUntil: true,
  ...accountStatusSelect,
} satisfies Prisma.UserSelect;

export async function submitApplication(userId: string, data: ApplicationData, files: ApplicationFiles) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
  if (user.studentVerificationStatus !== "VERIFIED") {
    throw new AppError(403, "NOT_VERIFIED", "Verify your student status first");
  }
  if (effectiveAccountStatus(user) !== "ACTIVE") {
    throw new AppError(403, "ACCOUNT_RESTRICTED", "Your account cannot apply right now");
  }

  // An approved rider's next application is a re-verification (B1 decision 5).
  const approvedBefore = await currentLicenceExpiry(prisma, userId);
  const kind = approvedBefore ? "REVERIFICATION" : "INITIAL";
  const ownApproved = approvedBefore
    ? await prisma.vehicle.findMany({ where: { ownerId: userId, status: "APPROVED", isActive: true }, select: { type: true } })
    : [];

  checkFiles(kind, data, files);
  checkLicences(data.vehicles.map((v) => v.type).concat(ownApproved.map((v) => v.type)), files);
  if (approvedBefore && data.licenceExpiresOn <= approvedBefore) {
    throw fieldError("LICENCE_EXPIRY_NOT_LATER", "licenceExpiresOn", "Enter the expiry date of your renewed licence");
  }

  // Files are written first; if anything below fails they are removed again.
  const written: string[] = [];
  const replacedPhotos: string[] = [];
  try {
    const documents: { type: RiderDocumentType; fileKey: string; mimeType: string; sizeBytes: number }[] = [];
    const docFiles: [RiderDocumentType, UploadedFile | undefined][] = [
      ["NID_FRONT", kind === "INITIAL" ? files.nidFront : undefined],
      ["NID_BACK", kind === "INITIAL" ? files.nidBack : undefined],
      ["CAR_LICENCE", files.carLicence],
      ["MOTORCYCLE_LICENCE", files.motorcycleLicence],
    ];
    for (const [type, file] of docFiles) {
      if (!file) continue;
      const fileKey = await putPrivateFile("rider-documents", file.buffer, file.mimetype as AllowedMimeType);
      written.push(fileKey);
      documents.push({ type, fileKey, mimeType: file.mimetype, sizeBytes: file.buffer.length });
    }
    const photoKeys: string[] = [];
    for (const photo of files.vehiclePhotos) {
      const key = await putPrivateFile("vehicle-photos", await processVehiclePhoto(photo.buffer), "image/jpeg");
      written.push(key);
      photoKeys.push(key);
    }

    await prisma.$transaction(async (tx) => {
      // Locks the user, so two submissions at once cannot both pass the checks.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
      const pending = await tx.riderApplication.count({ where: { userId, status: "PENDING" } });
      if (pending > 0) throw new AppError(409, "APPLICATION_PENDING", "Your application is already being reviewed");

      const active = await tx.vehicle.count({
        where: { ownerId: userId, isActive: true, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (active + data.vehicles.length > rider.maxActiveVehicles) {
        throw new AppError(409, "VEHICLE_LIMIT_REACHED", `A rider can have at most ${rider.maxActiveVehicles} vehicles`);
      }

      const application = await tx.riderApplication.create({
        data: { userId, kind, licenceExpiresOn: dateOnly(data.licenceExpiresOn), documents: { create: documents } },
        select: { id: true },
      });

      for (const [index, vehicle] of data.vehicles.entries()) {
        const normalized = normalizeRegistrationNumber(vehicle.registrationNumber);
        const fields = {
          ownerId: userId,
          applicationId: application.id,
          type: vehicle.type,
          brand: vehicle.brand,
          model: vehicle.model,
          colour: vehicle.colour,
          registrationNumber: vehicle.registrationNumber,
          seatCapacity: vehicle.seatCapacity,
          photoKey: photoKeys[index],
          status: "PENDING" as const,
          reviewedById: null,
          reviewedAt: null,
          rejectionReason: null,
          isActive: true,
        };
        const existing = await tx.vehicle.findUnique({
          where: { registrationNumberNormalized: normalized },
          select: { id: true, ownerId: true, status: true, photoKey: true },
        });

        if (!existing) {
          try {
            await tx.vehicle.create({ data: { ...fields, registrationNumberNormalized: normalized } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw plateTaken(index);
            throw error;
          }
          continue;
        }
        // A rejected vehicle is updated by its owner's re-submission, or taken
        // over by another applicant (B1 decisions 3 and 4).
        if (existing.status === "REJECTED") {
          const updated = await tx.vehicle.updateMany({ where: { id: existing.id, status: "REJECTED" }, data: fields });
          if (updated.count === 0) throw plateTaken(index);
          replacedPhotos.push(existing.photoKey);
          continue;
        }
        if (existing.ownerId === userId) {
          throw fieldError("VEHICLE_ALREADY_REGISTERED", `vehicles.${index}.registrationNumber`, "This vehicle is already on your account");
        }
        throw plateTaken(index);
      }
    });
  } catch (error) {
    await Promise.all(written.map((key) => deletePrivateFile(key)));
    throw error;
  }

  await Promise.all(replacedPhotos.map((key) => deletePrivateFile(key)));
  return getRiderOverview(userId);
}

function checkFiles(kind: "INITIAL" | "REVERIFICATION", data: ApplicationData, files: ApplicationFiles) {
  const fields: Record<string, string[]> = {};
  if (kind === "INITIAL") {
    if (!files.nidFront) fields.nidFront = ["Upload the front of your NID"];
    if (!files.nidBack) fields.nidBack = ["Upload the back of your NID"];
    if (data.vehicles.length === 0) fields.vehicles = ["Add at least one vehicle"];
  }
  if (!files.carLicence && !files.motorcycleLicence) fields.licence = ["Upload your driving licence"];
  data.vehicles.forEach((_, index) => {
    if (!files.vehiclePhotos[index]) fields[`vehicles.${index}.photo`] = ["Add a photo of this vehicle"];
  });
  if (files.vehiclePhotos.length > data.vehicles.length) fields.vehiclePhotos = ["One photo per vehicle"];
  if (Object.keys(fields).length > 0) throw new AppError(400, "VALIDATION_ERROR", "Some fields are invalid", { fields });
}

// Every vehicle (new ones and, for a re-verification, the approved ones) needs
// the matching licence in this application.
function checkLicences(types: VehicleType[], files: ApplicationFiles) {
  for (const type of new Set(types)) {
    if (!files[LICENCE_FOR[type]]) {
      throw fieldError(
        "LICENCE_DOES_NOT_MATCH",
        "licence",
        type === "BIKE" ? "A bike needs a motorcycle licence" : "A car needs a car driving licence",
      );
    }
  }
}

export async function setRiderActive(userId: string, active: boolean) {
  if (active) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect });
    const blocker = activeBlocker(
      { ...user, accountStatus: effectiveAccountStatus(user) },
      await currentLicenceExpiry(prisma, userId),
    );
    if (blocker) throw new AppError(409, blocker, ACTIVE_MESSAGES[blocker]);
    await prisma.user.update({ where: { id: userId }, data: { riderActive: true } });
  } else {
    const { count } = await prisma.user.updateMany({ where: { id: userId, isVerifiedRider: true }, data: { riderActive: false } });
    if (count === 0) throw new AppError(409, "NOT_A_RIDER", ACTIVE_MESSAGES.NOT_A_RIDER);
  }
  return getRiderOverview(userId);
}

const ACTIVE_MESSAGES = {
  NOT_A_RIDER: "Only approved riders can switch Active",
  NOT_VERIFIED: "Verify your student status first",
  ACCOUNT_RESTRICTED: "Your account cannot go Active right now",
  RIDER_SUSPENDED: "Your rider access is suspended",
  LICENCE_EXPIRED: "Your licence has expired. Re-verify with your renewed licence",
};

const applicationSelect = {
  id: true,
  kind: true,
  status: true,
  licenceExpiresOn: true,
  createdAt: true,
  reviewedAt: true,
  rejectionReason: true,
  documents: { select: { type: true } },
  vehicles: { select: { id: true } },
} satisfies Prisma.RiderApplicationSelect;

type ApplicationRow = Prisma.RiderApplicationGetPayload<{ select: typeof applicationSelect }>;

const toApplication = ({ licenceExpiresOn, createdAt, documents, vehicles, ...row }: ApplicationRow) => ({
  ...row,
  licenceExpiresOn: dateOnlyString(licenceExpiresOn),
  submittedAt: createdAt,
  documents: documents.map((d) => d.type),
  vehicleCount: vehicles.length,
});

// Everything the Drive with UniGo page shows, for the rider themself: their own
// vehicles with full registration numbers, and their verification history.
export async function getRiderOverview(userId: string) {
  const [user, licenceExpiresOn, applications, vehicles] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: userSelect }),
    currentLicenceExpiry(prisma, userId),
    prisma.riderApplication.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: applicationSelect }),
    prisma.vehicle.findMany({
      where: { ownerId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
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
      },
    }),
  ]);
  const accountStatus = effectiveAccountStatus(user);
  const latest = applications[0] ?? null;

  return {
    studentVerified: user.studentVerificationStatus === "VERIFIED",
    accountStatus,
    isVerifiedRider: user.isVerifiedRider,
    riderActive: user.riderActive,
    riderSuspended: riderSuspensionInForce(user),
    riderSuspendedUntil: riderSuspensionInForce(user) ? user.riderSuspendedUntil : null,
    licenceExpiresOn,
    licenceExpired: user.isVerifiedRider && licenceExpired(licenceExpiresOn),
    activeBlocker: user.isVerifiedRider ? activeBlocker({ ...user, accountStatus }, licenceExpiresOn) : null,
    latestApplication: latest && toApplication(latest),
    history: applications.map(toApplication),
    vehicles: await Promise.all(
      vehicles.map(async ({ photoKey, ...vehicle }) => ({
        ...vehicle,
        photo: await signPrivateFileUrl(photoKey, Date.now(), rules.profile.photo.signedUrlLifetime),
      })),
    ),
    // Limits for the form, from rules.ts (never hard-coded in the client)
    limits: {
      maxVehiclesPerApplication: rider.maxVehiclesPerApplication,
      maxActiveVehicles: rider.maxActiveVehicles,
      licenceMaxYearsAhead: rider.licenceMaxYearsAhead,
      seats: rules.seats,
    },
  };
}

// The Rider Dashboard counters (proposal section 6). Rides and carpools arrive
// in B3 and B6, which fill these in; until then every counter is 0.
export async function getRiderDashboard(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isVerifiedRider: true } });
  if (!user.isVerifiedRider) throw new AppError(403, "NOT_A_RIDER", ACTIVE_MESSAGES.NOT_A_RIDER);
  return {
    totalRides: 0,
    accepted: 0,
    completed: 0,
    cancelled: 0,
    completionRate: null as number | null,
    lateCancellationRate: null as number | null,
    rating: null as number | null,
    activeCarpoolContracts: 0,
    carpoolSessionCancellations: 0,
    earnings: 0,
  };
}

function fieldError(code: string, field: string, message: string) {
  return new AppError(400, code, message, { fields: { [field]: [message] } });
}

function plateTaken(index: number) {
  const message = "This registration number is already registered by another rider";
  return new AppError(409, "REGISTRATION_TAKEN", message, { fields: { [`vehicles.${index}.registrationNumber`]: [message] } });
}
