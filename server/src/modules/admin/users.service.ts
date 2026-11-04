import { rules } from "../../config/rules.js";
import type { AccountStatus, Prisma, StudentVerificationStatus, UserRole } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { accountStatusSelect, effectiveAccountStatus } from "../auth/account-status.js";
import { photoLink } from "../users/photo.js";

// Users for the admin panel (proposal section 17.1): list, search and one
// user's profile with verification and moderation history. Moderators and
// Super Admins can read these (A8 decision 3).

export type UserFilters = {
  q?: string;
  accountStatus?: AccountStatus;
  verification?: StudentVerificationStatus;
  role?: UserRole;
  universityId?: string;
  page: number;
};

export async function listUsers(filters: UserFilters) {
  const pageSize = rules.admin.pageSize;
  const q = filters.q?.trim();
  const where: Prisma.UserWhereInput = {
    accountStatus: filters.accountStatus,
    studentVerificationStatus: filters.verification,
    role: filters.role,
    universityId: filters.universityId,
    ...(q && {
      OR: [
        { email: { contains: q } },
        { phone: { contains: q.replace(/[\s-]/g, "") } },
        { verifiedUniversityEmail: { contains: q } },
        { profile: { fullName: { contains: q } } },
        { profile: { studentIdNumber: { contains: q } } },
      ],
    }),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        studentVerificationStatus: true,
        isVerifiedRider: true,
        createdAt: true,
        ...accountStatusSelect,
        university: { select: { id: true, name: true, shortName: true } },
        profile: { select: { fullName: true, studentIdNumber: true } },
      },
    }),
  ]);

  return {
    items: rows.map(({ profile, accountStatus, suspendedFrom, suspendedUntil, restrictedUntil, ...user }) => ({
      ...user,
      name: profile?.fullName ?? null,
      studentIdNumber: profile?.studentIdNumber ?? null,
      accountStatus: effectiveAccountStatus({ accountStatus, suspendedFrom, suspendedUntil, restrictedUntil }),
    })),
    page: filters.page,
    pageSize,
    total,
  };
}

export async function getUserForAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      studentVerificationStatus: true,
      verifiedUniversityEmail: true,
      isVerifiedRider: true,
      riderActive: true,
      language: true,
      createdAt: true,
      lastLoginAt: true,
      ...accountStatusSelect,
      university: { select: { id: true, name: true, shortName: true } },
      profile: {
        select: { fullName: true, photoKey: true, studentIdNumber: true, department: true, batch: true, location: true },
      },
      studentVerifications: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          method: true,
          status: true,
          universityEmail: true,
          createdAt: true,
          reviewedAt: true,
          rejectionReason: true,
          reviewedBy: { select: { id: true, profile: { select: { fullName: true } } } },
        },
      },
      moderationActions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          type: true,
          reason: true,
          startsAt: true,
          endsAt: true,
          previousStatus: true,
          newStatus: true,
          createdAt: true,
          admin: { select: { id: true, profile: { select: { fullName: true } } } },
        },
      },
    },
  });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");

  const { studentVerifications, moderationActions, profile, ...rest } = user;
  const { photoKey, ...profileFields } = profile ?? { photoKey: null };
  return {
    ...rest,
    accountStatus: effectiveAccountStatus(user),
    profile: profile ? profileFields : null,
    // A7: the profile photo through a signed link, never its storage key
    photo: await photoLink(photoKey),
    verifications: studentVerifications.map(({ reviewedBy, ...row }) => ({
      ...row,
      reviewedBy: reviewedBy && { id: reviewedBy.id, name: reviewedBy.profile?.fullName ?? null },
    })),
    moderationHistory: moderationActions.map(({ admin, ...row }) => ({
      ...row,
      admin: { id: admin.id, name: admin.profile?.fullName ?? null },
    })),
  };
}
