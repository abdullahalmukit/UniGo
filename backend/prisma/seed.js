// Creates the first admin account. Run with: npm run seed
require('../src/config/env');
const bcrypt = require('bcrypt');
const prisma = require('../src/config/prisma');

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env first');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { role: 'ADMIN' },
    create: {
      fullName: 'UniGo Admin',
      email,
      passwordHash,
      role: 'ADMIN',
      emailVerified: true,
    },
  });

  console.log('Admin ready:', email);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
