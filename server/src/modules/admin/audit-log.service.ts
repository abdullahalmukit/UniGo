import { rules } from "../../config/rules.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// The read-only Audit Log (proposal section 17), Super Admin only (A8 decision 4).

export type AuditFilters = {
  adminId?: string;
  action?: string;
  targetType?: string;
  targetUserId?: string;
  from?: Date;
  to?: Date;
  page: number;
};

export async function listAuditLogs(filters: AuditFilters) {
  const pageSize = rules.admin.pageSize;
  const where: Prisma.AuditLogWhereInput = {
    adminId: filters.adminId,
    action: filters.action,
    targetType: filters.targetType,
    targetUserId: filters.targetUserId,
    createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
  };

  const [total, rows, actions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        oldValue: true,
        newValue: true,
        createdAt: true,
        admin: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
        targetUser: { select: { id: true, email: true, profile: { select: { fullName: true } } } },
      },
    }),
    // For the action filter's choices
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);

  const person = (user: { id: string; email: string; profile: { fullName: string } | null } | null) =>
    user && { id: user.id, email: user.email, name: user.profile?.fullName ?? null };

  return {
    items: rows.map(({ admin, targetUser, ...row }) => ({ ...row, admin: person(admin), targetUser: person(targetUser) })),
    actions: actions.map((row) => row.action),
    page: filters.page,
    pageSize,
    total,
  };
}
