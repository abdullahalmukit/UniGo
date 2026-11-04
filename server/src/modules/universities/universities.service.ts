import { prisma } from "../../lib/prisma.js";

// The universities a student can register with: active ones only, by name.
// Admin management of the list comes in A6.
export function listOpenUniversities() {
  return prisma.university.findMany({
    where: { isActive: true },
    select: { id: true, name: true, shortName: true },
    orderBy: { name: "asc" },
  });
}
