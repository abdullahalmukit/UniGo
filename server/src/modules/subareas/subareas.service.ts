import { rules } from "../../config/rules.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

// My Sub-Areas (proposal section 5, CLAUDE.md 6.10): users pick from the admin
// master list only, at most rules.subAreas.maxPerUser. Inactive sub-areas are
// not offered, and a selection an admin later deactivates is hidden (A7).

const subAreaSelect = { id: true, name: true } as const;

export async function searchSubAreas(q?: string) {
  return prisma.subArea.findMany({
    where: { isActive: true, ...(q && { name: { contains: q } }) },
    select: subAreaSelect,
    orderBy: { name: "asc" },
    take: rules.subAreas.searchResults,
  });
}

export async function getMySubAreas(userId: string) {
  const rows = await prisma.userSubArea.findMany({
    where: { userId, subArea: { isActive: true } },
    select: { subArea: { select: subAreaSelect } },
    orderBy: { subArea: { name: "asc" } },
  });
  return rows.map((row) => row.subArea);
}

// Replaces the user's selection. Inactive selections an admin turned off are
// kept as they are (hidden), so reactivating a sub-area brings them back, and
// they do not count against the limit.
export async function setMySubAreas(userId: string, subAreaIds: string[]) {
  await prisma.$transaction(async (tx) => {
    const active = await tx.subArea.findMany({
      where: { id: { in: subAreaIds }, isActive: true },
      select: { id: true },
    });
    if (active.length !== subAreaIds.length) {
      throw new AppError(400, "SUB_AREA_NOT_FOUND", "Choose sub-areas from the list");
    }

    await tx.userSubArea.deleteMany({ where: { userId, subArea: { isActive: true }, subAreaId: { notIn: subAreaIds } } });
    await tx.userSubArea.createMany({
      data: subAreaIds.map((subAreaId) => ({ userId, subAreaId })),
      skipDuplicates: true,
    });
  });
  return getMySubAreas(userId);
}
