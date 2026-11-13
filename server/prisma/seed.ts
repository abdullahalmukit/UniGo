// Dev-only seed: two placeholder universities and, when SEED_ADMIN_EMAIL and
// SEED_ADMIN_PASSWORD are set, a SUPER_ADMIN account for trying the admin API
// by hand. Safe to run more than once.
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { passwordSchema } from "../src/modules/auth/auth.validation.js";
import { hashPassword } from "../src/modules/auth/password.js";

if (env.NODE_ENV === "production") {
  console.error("The dev seed must not run in production.");
  process.exit(1);
}

const universities = [
  { name: "Test University A", shortName: "TUA", domain: "test-a.edu" },
  { name: "Test University B", shortName: "TUB", domain: "test-b.edu" },
];

for (const { name, shortName, domain } of universities) {
  await prisma.university.upsert({
    where: { name },
    update: {},
    create: { name, shortName, domains: { create: { domain } } },
  });
}

console.log(`Seeded ${universities.length} test universities.`);

const serviceCategories = [
  { code: "SHOPPING_PURCHASING" as const, sortOrder: 1 },
  { code: "PARCEL_DELIVERY" as const, sortOrder: 2 },
  { code: "PHARMACY_HEALTHCARE" as const, sortOrder: 3 },
  { code: "DOCUMENT_ACADEMIC" as const, sortOrder: 4 },
  { code: "WARRANTY_REPAIR" as const, sortOrder: 5 },
  { code: "FINANCIAL_ADMINISTRATIVE" as const, sortOrder: 6 },
  { code: "CUSTOM_OTHER" as const, sortOrder: 7 },
];

for (const { code, sortOrder } of serviceCategories) {
  await prisma.serviceCategory.upsert({
    where: { code },
    update: { sortOrder, isActive: true },
    create: { code, sortOrder, isActive: true },
  });
}
console.log(`Seeded ${serviceCategories.length} service categories.`);

// The admin is not a student, so it stays UNVERIFIED. An existing account with
// this email is promoted to SUPER_ADMIN; its password is not changed.
if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
  const password = passwordSchema.safeParse(env.SEED_ADMIN_PASSWORD);
  if (!password.success) {
    console.error("SEED_ADMIN_PASSWORD must follow the password rule: 8-72 characters with a letter and a number.");
    process.exit(1);
  }
  const university = await prisma.university.findUniqueOrThrow({ where: { name: universities[0].name } });
  await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    update: { role: "SUPER_ADMIN" },
    create: {
      email: env.SEED_ADMIN_EMAIL,
      // A placeholder Bangladesh mobile number, unique to the seed admin
      phone: "+8801300000000",
      passwordHash: await hashPassword(password.data),
      universityId: university.id,
      role: "SUPER_ADMIN",
      profile: { create: { fullName: "UniGo Admin" } },
    },
  });
  console.log(`Seeded the SUPER_ADMIN account ${env.SEED_ADMIN_EMAIL}.`);
} else {
  console.log("SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD is not set, so no admin account was seeded.");
}
await prisma.$disconnect();
