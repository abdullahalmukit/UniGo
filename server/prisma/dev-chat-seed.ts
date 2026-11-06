// Development-only demo data for trying Inbox and chat by hand before B3 adds
// the screens that create activities (B2b decision 13). A separate script, not
// part of `db:seed`: `npm run db:seed:dev-chat -w server`.
//
// Creates (or reuses) two verified demo students and gives them:
// - a food delivery request accepted through the activity engine, so its chat
//   opens like in the app (with a few messages);
// - a Uni Service request that is already COMPLETED, to see a read-only chat.
// Both demo accounts use the password in DEV_DEMO_PASSWORD (server/.env).
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { acceptActivity, transitionActivity } from "../src/modules/activities/engine.js";
import { passwordSchema } from "../src/modules/auth/auth.validation.js";
import { hashPassword } from "../src/modules/auth/password.js";

// Refuses anything but an explicit development environment.
if (process.env.NODE_ENV !== "development" || env.NODE_ENV !== "development") {
  console.error("The chat demo seed runs only with NODE_ENV=development.");
  process.exit(1);
}

const password = process.env.DEV_DEMO_PASSWORD;
if (!password || !passwordSchema.safeParse(password).success) {
  console.error("Set DEV_DEMO_PASSWORD in server/.env (8-72 characters, at least one letter and one number).");
  process.exit(1);
}

const HOUR = 60 * 60 * 1000;
const demoUsers = [
  { email: "demo.chat.a@example.com", phone: "+8801700000101", name: "Demo Student A" },
  { email: "demo.chat.b@example.com", phone: "+8801700000102", name: "Demo Student B" },
];

const university = await prisma.university.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } });
if (!university) {
  console.error("No university yet. Run `npm run db:seed -w server` first.");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const [a, b] = await Promise.all(
  demoUsers.map((demo) =>
    prisma.user.upsert({
      where: { email: demo.email },
      update: { passwordHash, studentVerificationStatus: "VERIFIED", accountStatus: "ACTIVE" },
      create: {
        email: demo.email,
        phone: demo.phone,
        passwordHash,
        universityId: university.id,
        studentVerificationStatus: "VERIFIED",
        profile: { create: { fullName: demo.name } },
      },
      select: { id: true },
    }),
  ),
);
// Earlier demo runs may have blocked each other; start clean.
await prisma.block.deleteMany({ where: { OR: [{ blockerId: a.id, blockedId: b.id }, { blockerId: b.id, blockedId: a.id }] } });

async function chatOf(activityId: string) {
  return (await prisma.chat.findUniqueOrThrow({ where: { activityId } })).id;
}

async function say(chatId: string, senderId: string, body: string) {
  const message = await prisma.message.create({ data: { chatId, senderId, kind: "TEXT", body } });
  await prisma.chat.update({ where: { id: chatId }, data: { lastMessageAt: message.createdAt } });
}

// Each run starts after the demo users' latest activity, so a new run never
// clashes with an earlier one in the 90-minute conflict check.
const latest = await prisma.activity.findFirst({
  where: { OR: [{ creatorId: { in: [a.id, b.id] } }, { accepterId: { in: [a.id, b.id] } }] },
  orderBy: { startTime: "desc" },
  select: { startTime: true },
});
const base = Math.max(Date.now(), latest?.startTime.getTime() ?? 0) + 2 * HOUR;

// An active food delivery: A asked, B accepted
const food = await prisma.activity.create({
  data: { type: "FOOD", creatorId: a.id, startTime: new Date(base) },
});
await acceptActivity(food.id, b.id);
const foodChat = await chatOf(food.id);
await say(foodChat, b.id, "Hi! I am near the canteen now. Same order as in the request?");
await say(foodChat, a.id, "Yes please. Extra sauce if they have it.");

// A finished Uni Service: B asked, A did it
const service = await prisma.activity.create({
  data: { type: "SERVICE", creatorId: b.id, startTime: new Date(base + 2 * HOUR) },
});
await acceptActivity(service.id, a.id);
await say(await chatOf(service.id), a.id, "Collected your parcel from the office.");
await transitionActivity(service.id, "START", { type: "USER", id: a.id });
await transitionActivity(service.id, "DELIVER_SERVICE", { type: "USER", id: a.id });
await transitionActivity(service.id, "CONFIRM_COMPLETION", { type: "USER", id: b.id });

console.log(`Chat demo ready: log in as ${demoUsers[0].email} or ${demoUsers[1].email} with DEV_DEMO_PASSWORD.`);
await prisma.$disconnect();
process.exit(0);
