// Dev-only seed: two placeholder universities so registration can be tried by
// hand before the university admin (A6) exists. Safe to run more than once.
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";

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
await prisma.$disconnect();
