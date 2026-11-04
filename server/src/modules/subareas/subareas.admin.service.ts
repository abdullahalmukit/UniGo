import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../admin/audit-log.js";

// The Sub-Areas master list (proposal section 17, CLAUDE.md 6.10). Super Admin
// only (A8 decision 4). Users only pick from this list; they never create one.

const name = z.string().trim().min(2).max(100);

export const createSubAreaSchema = z.object({ name });
export const updateSubAreaSchema = z
  .object({ name: name.optional(), isActive: z.boolean().optional() })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, "Change at least one field");

export type CreateSubAreaInput = z.infer<typeof createSubAreaSchema>;
export type UpdateSubAreaInput = z.infer<typeof updateSubAreaSchema>;

const subAreaSelect = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true, rideRequests: true, rideOffers: true, foodRequests: true, serviceRequests: true } },
} satisfies Prisma.SubAreaSelect;

type SubAreaRow = Prisma.SubAreaGetPayload<{ select: typeof subAreaSelect }>;

const usedByActivities = ({ _count }: SubAreaRow) =>
  _count.rideRequests + _count.rideOffers + _count.foodRequests + _count.serviceRequests;

const toAdminSubArea = (row: SubAreaRow) => ({
  id: row.id,
  name: row.name,
  isActive: row.isActive,
  createdAt: row.createdAt,
  userCount: row._count.users,
  activityCount: usedByActivities(row),
});

export async function listSubAreasForAdmin() {
  const rows = await prisma.subArea.findMany({ select: subAreaSelect, orderBy: { name: "asc" } });
  return rows.map(toAdminSubArea);
}

export async function createSubArea(adminId: string, input: CreateSubAreaInput, ipAddress?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.subArea.create({ data: { name: input.name }, select: subAreaSelect });
      await recordAudit(tx, {
        adminId,
        action: "SUB_AREA_CREATED",
        targetType: "sub_area",
        targetId: created.id,
        newValue: { name: created.name },
        ipAddress,
      });
      return toAdminSubArea(created);
    });
  } catch (error) {
    throw nameConflict(error);
  }
}

export async function updateSubArea(adminId: string, id: string, input: UpdateSubAreaInput, ipAddress?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.subArea.findUnique({ where: { id }, select: { name: true, isActive: true } });
      if (!before) throw notFound();
      const updated = await tx.subArea.update({ where: { id }, data: input, select: subAreaSelect });
      const changed = (["name", "isActive"] as const).filter((key) => input[key] !== undefined);
      await recordAudit(tx, {
        adminId,
        action: "SUB_AREA_UPDATED",
        targetType: "sub_area",
        targetId: id,
        oldValue: Object.fromEntries(changed.map((key) => [key, before[key]])),
        newValue: Object.fromEntries(changed.map((key) => [key, updated[key]])),
        ipAddress,
      });
      return toAdminSubArea(updated);
    });
  } catch (error) {
    throw nameConflict(error);
  }
}

// Deleted when no activity uses it (users' selections go with it); otherwise
// deactivated, so old activities keep their sub-area (A8 decision 6).
export async function removeSubArea(adminId: string, id: string, ipAddress?: string) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.subArea.findUnique({ where: { id }, select: subAreaSelect });
    if (!row) throw notFound();

    if (usedByActivities(row) > 0) {
      await tx.subArea.update({ where: { id }, data: { isActive: false } });
      await recordAudit(tx, {
        adminId,
        action: "SUB_AREA_DEACTIVATED",
        targetType: "sub_area",
        targetId: id,
        oldValue: { name: row.name, isActive: row.isActive },
        newValue: { name: row.name, isActive: false },
        ipAddress,
      });
      return { deleted: false };
    }

    await tx.subArea.delete({ where: { id } });
    await recordAudit(tx, {
      adminId,
      action: "SUB_AREA_DELETED",
      targetType: "sub_area",
      targetId: id,
      oldValue: { name: row.name, isActive: row.isActive, userCount: row._count.users },
      ipAddress,
    });
    return { deleted: true };
  });
}

function nameConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new AppError(409, "SUB_AREA_NAME_TAKEN", "A sub-area with this name already exists");
  }
  return error;
}

const notFound = () => new AppError(404, "SUB_AREA_NOT_FOUND", "Sub-area not found");
