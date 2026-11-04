import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { recordAudit } from "../admin/audit-log.js";

// Admin management of universities and their allowed email domains (proposal
// section 17, A6 decision 4). Super Admin only. Every change is in the Audit
// Log. A university with users can only be deactivated, never deleted.

// ---- Validation ---------------------------------------------------------------

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// "@Mail.DIU.edu.bd " -> "mail.diu.edu.bd". Matching is exact (A6 decision 1),
// so each subdomain is added separately.
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^@/, ""))
  .pipe(z.string().regex(HOSTNAME, "Enter a domain such as diu.edu.bd"));

const name = z.string().trim().min(2).max(150);
const shortName = z.string().trim().min(1).max(30);

export const createUniversitySchema = z.object({
  name,
  shortName: shortName.optional(),
  domains: z.array(domainSchema).max(20).default([]),
});

export const updateUniversitySchema = z
  .object({ name: name.optional(), shortName: shortName.nullable().optional(), isActive: z.boolean().optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Change at least one field");

export const addDomainSchema = z.object({ domain: domainSchema });

export type CreateInput = z.infer<typeof createUniversitySchema>;
export type UpdateInput = z.infer<typeof updateUniversitySchema>;

// ---- Service ------------------------------------------------------------------

const universitySelect = {
  id: true,
  name: true,
  shortName: true,
  isActive: true,
  createdAt: true,
  domains: { select: { id: true, domain: true }, orderBy: { domain: "asc" } },
  _count: { select: { users: true } },
} satisfies Prisma.UniversitySelect;

type UniversityRow = Prisma.UniversityGetPayload<{ select: typeof universitySelect }>;

const toAdminUniversity = ({ _count, ...university }: UniversityRow) => ({ ...university, userCount: _count.users });

export async function listAllUniversities() {
  const rows = await prisma.university.findMany({ select: universitySelect, orderBy: { name: "asc" } });
  return rows.map(toAdminUniversity);
}

export async function createUniversity(adminId: string, input: CreateInput, ipAddress?: string) {
  const domains = [...new Set(input.domains)];
  try {
    const university = await prisma.$transaction(async (tx) => {
      const created = await tx.university.create({
        data: { name: input.name, shortName: input.shortName, domains: { create: domains.map((domain) => ({ domain })) } },
        select: universitySelect,
      });
      await recordAudit(tx, {
        adminId,
        action: "UNIVERSITY_CREATED",
        targetType: "university",
        targetId: created.id,
        newValue: { name: created.name, shortName: created.shortName, domains },
        ipAddress,
      });
      return created;
    });
    return toAdminUniversity(university);
  } catch (error) {
    throw await uniqueConflict(error, { name: input.name });
  }
}

export async function updateUniversity(adminId: string, id: string, input: UpdateInput, ipAddress?: string) {
  try {
    const university = await prisma.$transaction(async (tx) => {
      const before = await tx.university.findUnique({ where: { id }, select: { name: true, shortName: true, isActive: true } });
      if (!before) throw universityNotFound();

      const updated = await tx.university.update({ where: { id }, data: input, select: universitySelect });
      const changed = (Object.keys(input) as (keyof UpdateInput)[]).filter((key) => input[key] !== undefined);
      await recordAudit(tx, {
        adminId,
        action: "UNIVERSITY_UPDATED",
        targetType: "university",
        targetId: id,
        oldValue: Object.fromEntries(changed.map((key) => [key, before[key]])),
        newValue: Object.fromEntries(changed.map((key) => [key, updated[key]])),
        ipAddress,
      });
      return updated;
    });
    return toAdminUniversity(university);
  } catch (error) {
    throw await uniqueConflict(error, { name: input.name });
  }
}

export async function deleteUniversity(adminId: string, id: string, ipAddress?: string) {
  await prisma.$transaction(async (tx) => {
    const university = await tx.university.findUnique({ where: { id }, select: universitySelect });
    if (!university) throw universityNotFound();
    if (university._count.users > 0) {
      throw new AppError(409, "UNIVERSITY_HAS_USERS", "This university has users. Deactivate it instead.");
    }

    await tx.university.delete({ where: { id } });
    await recordAudit(tx, {
      adminId,
      action: "UNIVERSITY_DELETED",
      targetType: "university",
      targetId: id,
      oldValue: {
        name: university.name,
        shortName: university.shortName,
        domains: university.domains.map((domain) => domain.domain),
      },
      ipAddress,
    });
  });
}

export async function addUniversityDomain(adminId: string, universityId: string, domain: string, ipAddress?: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const university = await tx.university.findUnique({ where: { id: universityId }, select: { id: true } });
      if (!university) throw universityNotFound();

      const created = await tx.universityDomain.create({ data: { universityId, domain }, select: { id: true, domain: true } });
      await recordAudit(tx, {
        adminId,
        action: "UNIVERSITY_DOMAIN_ADDED",
        targetType: "university",
        targetId: universityId,
        newValue: { domain },
        ipAddress,
      });
      return created;
    });
  } catch (error) {
    throw await uniqueConflict(error, {});
  }
}

export async function removeUniversityDomain(adminId: string, universityId: string, domainId: string, ipAddress?: string) {
  await prisma.$transaction(async (tx) => {
    const domain = await tx.universityDomain.findFirst({ where: { id: domainId, universityId }, select: { domain: true } });
    if (!domain) throw new AppError(404, "DOMAIN_NOT_FOUND", "Domain not found");

    await tx.universityDomain.delete({ where: { id: domainId } });
    await recordAudit(tx, {
      adminId,
      action: "UNIVERSITY_DOMAIN_REMOVED",
      targetType: "university",
      targetId: universityId,
      oldValue: { domain: domain.domain },
      ipAddress,
    });
  });
}

// Turns a unique-constraint failure into the right error code: the university
// name, or else a domain that another university already has.
async function uniqueConflict(error: unknown, input: { name?: string }) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return error;
  if (input.name && (await prisma.university.findUnique({ where: { name: input.name }, select: { id: true } }))) {
    return new AppError(409, "UNIVERSITY_NAME_TAKEN", "A university with this name already exists");
  }
  return new AppError(409, "DOMAIN_TAKEN", "This domain already belongs to a university");
}

const universityNotFound = () => new AppError(404, "UNIVERSITY_NOT_FOUND", "University not found");
