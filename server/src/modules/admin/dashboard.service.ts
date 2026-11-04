import type { ActivityType } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { startOfDhakaDay } from "../../utils/time.js";

const FEATURES: Record<"ride" | "carpool" | "food" | "service", ActivityType[]> = {
  ride: ["RIDE_REQUEST", "RIDE_BOOKING"],
  carpool: ["CARPOOL_BOOKING"],
  food: ["FOOD"],
  service: ["SERVICE"],
};

// The admin dashboard counters (proposal section 17). Every counter reads its
// real table, so features that are not built yet simply show 0.
export async function getDashboard(now = new Date()) {
  const today = startOfDhakaDay(now);

  const [
    totalUsers,
    activeUsers,
    verifiedStudents,
    verifiedRiders,
    pendingStudentVerifications,
    pendingRiderApplications,
    openDisputes,
    openReports,
    openNoShowReports,
    newToday,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { accountStatus: "ACTIVE" } }),
    prisma.user.count({ where: { studentVerificationStatus: "VERIFIED" } }),
    prisma.user.count({ where: { isVerifiedRider: true } }),
    prisma.studentVerification.count({ where: { method: "ID_CARD", status: "PENDING" } }),
    prisma.riderApplication.count({ where: { status: "PENDING" } }),
    prisma.dispute.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    prisma.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    prisma.noShowReport.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
    prisma.activity.groupBy({ by: ["type"], where: { createdAt: { gte: today } }, _count: { _all: true } }),
  ]);

  const countFor = (types: ActivityType[]) =>
    newToday.filter((row) => types.includes(row.type)).reduce((sum, row) => sum + row._count._all, 0);

  return {
    totalUsers,
    activeUsers,
    verifiedStudents,
    verifiedRiders,
    pendingStudentVerifications,
    pendingRiderApplications,
    openDisputes,
    openReports,
    openNoShowReports,
    newRequestsToday: {
      ride: countFor(FEATURES.ride),
      carpool: countFor(FEATURES.carpool),
      food: countFor(FEATURES.food),
      service: countFor(FEATURES.service),
    },
  };
}
