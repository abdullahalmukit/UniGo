import { rules } from "../../config/rules.js";
import { Prisma } from "../../generated/prisma/client.js";
import { deletePrivateFile, putPrivateFile } from "../../lib/private-storage.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import type { AllowedMimeType } from "../../utils/file-type.js";
import { sendEmail } from "../email/email.service.js";
import { studentVerificationOtpEmail } from "../email/templates.js";
import { emailDomain, generateOtp, hashOtp, otpMatches } from "./otp.js";

// Proposal section 4 and the A6 decisions. Two ways to become VERIFIED:
// 1. University email: the domain must exactly match one of the user's
//    university domains; a 6-digit code is emailed and expires after 10 minutes.
// 2. Student ID card: a private upload that an admin approves or rejects.
// Verifying the email while an ID card is pending closes that card.

const cfg = rules.studentVerification;

const pendingEmailRow = (userId: string) => ({ userId, method: "UNIVERSITY_EMAIL" as const, status: "PENDING" as const });

// What the Verification page shows.
export async function getStudentVerification(userId: string, now = new Date()) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { studentVerificationStatus: true, verifiedUniversityEmail: true },
  });

  const [idCard, emailCode, verified] = await Promise.all([
    prisma.studentVerification.findFirst({
      where: { userId, method: "ID_CARD" },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true, reviewedAt: true, rejectionReason: true },
    }),
    prisma.studentVerification.findFirst({
      where: { ...pendingEmailRow(userId), otpHash: { not: null }, otpExpiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { universityEmail: true, otpExpiresAt: true, otpAttempts: true },
    }),
    prisma.studentVerification.findFirst({
      where: { userId, status: "VERIFIED" },
      orderBy: { verifiedAt: "desc" },
      select: { method: true },
    }),
  ]);

  const status = user.studentVerificationStatus;
  return {
    status,
    verifiedBy: status === "VERIFIED" ? (verified?.method ?? null) : null,
    universityEmail: user.verifiedUniversityEmail,
    idCard: idCard && {
      status: idCard.status,
      submittedAt: idCard.createdAt,
      reviewedAt: idCard.reviewedAt,
      rejectionReason: idCard.status === "REJECTED" ? idCard.rejectionReason : null,
    },
    emailCode:
      emailCode && emailCode.otpAttempts < cfg.maxOtpAttempts
        ? {
            email: emailCode.universityEmail,
            expiresAt: emailCode.otpExpiresAt,
            resendAvailableAt: resendAvailableAt(emailCode.otpExpiresAt!),
            attemptsLeft: cfg.maxOtpAttempts - emailCode.otpAttempts,
          }
        : null,
  };
}

// Emails a new code to the university email. A new code replaces the previous one.
export async function sendEmailOtp(userId: string, email: string, now = new Date()) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { studentVerificationStatus: true, universityId: true, language: true, profile: { select: { fullName: true } } },
  });
  if (user.studentVerificationStatus === "VERIFIED") throw alreadyVerified();
  await assertEmailUsable(userId, user.universityId, email);

  const existing = await prisma.studentVerification.findFirst({
    where: pendingEmailRow(userId),
    orderBy: { createdAt: "desc" },
    select: { id: true, otpExpiresAt: true },
  });
  if (existing?.otpExpiresAt) {
    const availableAt = resendAvailableAt(existing.otpExpiresAt);
    if (now < availableAt) {
      throw new AppError(429, "OTP_RESEND_TOO_SOON", "Wait a moment before asking for a new code", {
        data: { resendAvailableAt: availableAt.toISOString() },
      });
    }
  }

  const code = generateOtp();
  const expiresAt = new Date(now.getTime() + cfg.otpLifetime);
  const row =
    existing ??
    (await prisma.studentVerification.create({
      data: { userId, method: "UNIVERSITY_EMAIL", status: "PENDING", universityEmail: email },
      select: { id: true },
    }));
  await prisma.studentVerification.update({
    where: { id: row.id },
    data: { universityEmail: email, otpHash: hashOtp(row.id, code), otpExpiresAt: expiresAt, otpAttempts: 0 },
  });

  await sendEmail({
    to: email,
    ...studentVerificationOtpEmail(user.language, {
      name: user.profile?.fullName ?? "",
      code,
      minutes: cfg.otpLifetime / 60_000,
    }),
  });

  return { email, expiresAt, resendAvailableAt: resendAvailableAt(expiresAt) };
}

// Checks the code. The right code makes the account VERIFIED with this
// university email and closes a pending ID card.
export async function confirmEmailOtp(userId: string, code: string, now = new Date()) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { studentVerificationStatus: true, universityId: true },
  });
  if (user.studentVerificationStatus === "VERIFIED") throw alreadyVerified();

  const row = await prisma.studentVerification.findFirst({
    where: { ...pendingEmailRow(userId), otpHash: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, universityEmail: true, otpHash: true, otpExpiresAt: true, otpAttempts: true },
  });
  if (!row?.otpHash || !row.otpExpiresAt || !row.universityEmail) {
    throw new AppError(400, "OTP_INVALID", "This code is not right");
  }
  if (row.otpAttempts >= cfg.maxOtpAttempts) throw tooManyAttempts();
  if (row.otpExpiresAt <= now) throw new AppError(400, "OTP_EXPIRED", "This code has expired. Ask for a new one.");

  if (!otpMatches(row.id, code, row.otpHash)) {
    await prisma.studentVerification.updateMany({
      where: { id: row.id, otpAttempts: { lt: cfg.maxOtpAttempts } },
      data: { otpAttempts: { increment: 1 } },
    });
    const attemptsLeft = cfg.maxOtpAttempts - (row.otpAttempts + 1);
    if (attemptsLeft <= 0) throw tooManyAttempts();
    throw new AppError(400, "OTP_INVALID", "This code is not right", { data: { attemptsLeft } });
  }

  // The admin may have removed the domain since the code was sent.
  await assertEmailUsable(userId, user.universityId, row.universityEmail);
  const email = row.universityEmail;

  try {
    await prisma.$transaction(async (tx) => {
      // Single use: only the request that claims the code goes on.
      const claimed = await tx.studentVerification.updateMany({
        where: { id: row.id, status: "PENDING", otpHash: row.otpHash, otpAttempts: { lt: cfg.maxOtpAttempts } },
        data: { status: "VERIFIED", verifiedAt: now, otpHash: null, otpExpiresAt: null },
      });
      if (claimed.count === 0) throw new AppError(400, "OTP_INVALID", "This code is not right");

      // A6 decision 2: close a pending ID card; no email about it.
      await tx.studentVerification.updateMany({
        where: { userId, method: "ID_CARD", status: "PENDING" },
        data: { status: "REJECTED", rejectionReason: cfg.closedByEmailReason, reviewedAt: now },
      });

      await tx.user.update({
        where: { id: userId },
        data: { studentVerificationStatus: "VERIFIED", verifiedUniversityEmail: email },
      });
    });
  } catch (error) {
    // Another account verified the same email at the same moment.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw emailTaken();
    throw error;
  }
}

// Saves the ID card privately and puts the account in PENDING until an admin decides.
export async function submitIdCard(userId: string, file: { buffer: Uint8Array; mimeType: AllowedMimeType }) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { studentVerificationStatus: true } });
  assertCanSubmitIdCard(user.studentVerificationStatus);

  const key = await putPrivateFile("student-id-cards", file.buffer, file.mimeType);
  try {
    await prisma.$transaction(async (tx) => {
      // Conditional, so two uploads at the same moment cannot both go through.
      const claimed = await tx.user.updateMany({
        where: { id: userId, studentVerificationStatus: { in: ["UNVERIFIED", "REJECTED"] } },
        data: { studentVerificationStatus: "PENDING" },
      });
      if (claimed.count === 0) {
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { studentVerificationStatus: true } });
        assertCanSubmitIdCard(current.studentVerificationStatus);
        throw new AppError(409, "VERIFICATION_PENDING", "Your ID card is already being reviewed");
      }
      await tx.studentVerification.create({
        data: { userId, method: "ID_CARD", status: "PENDING", idCardFileKey: key },
      });
    });
  } catch (error) {
    await deletePrivateFile(key);
    throw error;
  }
}

function assertCanSubmitIdCard(status: string) {
  if (status === "VERIFIED") throw alreadyVerified();
  if (status === "PENDING") throw new AppError(409, "VERIFICATION_PENDING", "Your ID card is already being reviewed");
}

// The domain must exactly match one of the user's university domains (A6
// decision 1), and no other account may have verified this email.
async function assertEmailUsable(userId: string, universityId: string, email: string) {
  const domain = await prisma.universityDomain.findFirst({
    where: { universityId, domain: emailDomain(email) },
    select: { id: true },
  });
  if (!domain) {
    throw new AppError(400, "EMAIL_DOMAIN_NOT_ALLOWED", "Use the email your university gave you");
  }

  const owner = await prisma.user.findFirst({
    where: { verifiedUniversityEmail: email, id: { not: userId } },
    select: { id: true },
  });
  if (owner) throw emailTaken();
}

function resendAvailableAt(otpExpiresAt: Date) {
  return new Date(otpExpiresAt.getTime() - cfg.otpLifetime + cfg.otpResendAfter);
}

const alreadyVerified = () => new AppError(409, "ALREADY_VERIFIED", "Your student status is already verified");
const emailTaken = () => new AppError(409, "UNIVERSITY_EMAIL_TAKEN", "This university email already verified another account");
const tooManyAttempts = () =>
  new AppError(400, "OTP_TOO_MANY_ATTEMPTS", "Too many wrong codes. Ask for a new code.");
