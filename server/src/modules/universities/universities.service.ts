import { prisma } from "../../lib/prisma.js";

// The universities a student can register with: active ones only, by name.
// Admins manage the list through universities.admin.routes.ts.
export function listOpenUniversities() {
  return prisma.university.findMany({
    where: { isActive: true },
    select: { id: true, name: true, shortName: true },
    orderBy: { name: "asc" },
  });
}
