import { rules } from "../../config/rules.js";
import { signPrivateFileUrl } from "../../lib/signed-files.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { sendEmailInBackground } from "../email/email.service.js";
import { studentVerificationApprovedEmail, studentVerificationRejectedEmail } from "../email/templates.js";
import { recordAudit } from "./audit-log.js";

// Admin review of student ID cards (proposal sections 4 and 17.1). Moderators
// and Super Admins. Every decision is in the Audit Log and emailed to the student.

type ReviewStatus = "PENDING" | "VERIFIED" | "REJECTED";

export async function listIdCardVerifications(status: ReviewStatus, page: number) {
  const pageSize = rules.admin.pageSize;
  const where = { method: "ID_CARD" as const, status };

  const [total, rows] = await Promise.all([
    prisma.studentVerification.count({ where }),
    prisma.studentVerification.findMany({
      where,
      // The longest-waiting card first; decided ones newest first.
      orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
        rejectionReason: true,
        reviewedBy: { select: { id: true, profile: { select: { fullName: true } } } },
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            studentVerificationStatus: true,
            university: { select: { id: true, name: true, shortName: true } },
            profile: { select: { fullName: true, studentIdNumber: true, department: true, batch: true } },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map(({ createdAt, reviewedBy, user, ...row }) => ({
      ...row,
      submittedAt: createdAt,
      reviewedBy: reviewedBy && { id: reviewedBy.id, name: reviewedBy.profile?.fullName ?? null },
      user: {
        id: user.id,
        name: user.profile?.fullName ?? null,
        email: user.email,
        phone: user.phone,
        studentVerificationStatus: user.studentVerificationStatus,
        studentIdNumber: user.profile?.studentIdNumber ?? null,
        department: user.profile?.department ?? null,
        batch: user.profile?.batch ?? null,
        university: user.university,
      },
    })),
    page,
    pageSize,
    total,
  };
}

// A short-lived link to the ID card file. The link is never stored or logged.
export async function idCardFileUrl(verificationId: string) {
  const row = await prisma.studentVerification.findUnique({
    where: { id: verificationId },
    select: { method: true, idCardFileKey: true },
  });
  if (!row || row.method !== "ID_CARD" || !row.idCardFileKey) throw notFound();
  return signPrivateFileUrl(row.idCardFileKey);
}

export function approveIdCard(adminId: string, verificationId: string, ipAddress?: string) {
  return review(adminId, verificationId, { status: "VERIFIED" }, ipAddress);
}

export function rejectIdCard(adminId: string, verificationId: string, reason: string, ipAddress?: string) {
  return review(adminId, verificationId, { status: "REJECTED", reason }, ipAddress);
}

async function review(
  adminId: string,
  verificationId: string,
  decision: { status: "VERIFIED" } | { status: "REJECTED"; reason: string },
  ipAddress?: string,
) {
  const now = new Date();
  const reason = decision.status === "REJECTED" ? decision.reason : null;

  const student = await prisma.$transaction(async (tx) => {
    const row = await tx.studentVerification.findUnique({
      where: { id: verificationId },
      select: {
        method: true,
        userId: true,
        user: {
          select: { email: true, language: true, studentVerificationStatus: true, profile: { select: { fullName: true } } },
        },
      },
    });
    if (!row || row.method !== "ID_CARD") throw notFound();
    if (row.userId === adminId) {
      throw new AppError(403, "CANNOT_REVIEW_OWN_VERIFICATION", "Another admin must review your own verification");
    }

    // Conditional, so two admins deciding at the same moment cannot both succeed.
    const claimed = await tx.studentVerification.updateMany({
      where: { id: verificationId, status: "PENDING" },
      data: {
        status: decision.status,
        reviewedById: adminId,
        reviewedAt: now,
        rejectionReason: reason,
        verifiedAt: decision.status === "VERIFIED" ? now : null,
      },
    });
    if (claimed.count === 0) throw new AppError(409, "ALREADY_REVIEWED", "This verification has already been reviewed");

    await tx.user.updateMany({
      where: { id: row.userId, studentVerificationStatus: "PENDING" },
      data: { studentVerificationStatus: decision.status },
    });

    await recordAudit(tx, {
      adminId,
      action: decision.status === "VERIFIED" ? "STUDENT_VERIFICATION_APPROVED" : "STUDENT_VERIFICATION_REJECTED",
      targetType: "student_verification",
      targetId: verificationId,
      targetUserId: row.userId,
      oldValue: { status: "PENDING", userStatus: row.user.studentVerificationStatus },
      newValue: { status: decision.status, userStatus: decision.status, ...(reason && { reason }) },
      ipAddress,
    });

    return row.user;
  });

  const name = student.profile?.fullName ?? "";
  sendEmailInBackground("student verification result", {
    to: student.email,
    ...(reason
      ? studentVerificationRejectedEmail(student.language, { name, reason })
      : studentVerificationApprovedEmail(student.language, { name })),
  });
}

const notFound = () => new AppError(404, "VERIFICATION_NOT_FOUND", "Verification not found");
