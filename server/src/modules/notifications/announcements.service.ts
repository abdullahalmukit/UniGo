import { rules } from "../../config/rules.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { runInBackground } from "../../utils/background.js";
import { uuidv7 } from "../../utils/uuid.js";
import { recordAudit } from "../admin/audit-log.js";
import { notify } from "./notify.service.js";

// Admin › Notifications (proposal section 17): an announcement to everyone,
// to one university or to the users who saved one sub-area. In-app + push
// (section 14 "Promo, spotlight or announcement"). Banned and suspended
// accounts are left out (they cannot open the app). Every announcement is in
// the Audit Log; the send runs in the background in batches.

export type Audience = { kind: "ALL" } | { kind: "UNIVERSITY"; universityId: string } | { kind: "SUB_AREA"; subAreaId: string };
export type AnnouncementInput = { title: string; body: string; audience: Audience };

function audienceWhere(audience: Audience): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { accountStatus: { in: ["ACTIVE", "RESTRICTED"] } };
  if (audience.kind === "UNIVERSITY") return { ...base, universityId: audience.universityId };
  if (audience.kind === "SUB_AREA") return { ...base, subAreas: { some: { subAreaId: audience.subAreaId } } };
  return base;
}

async function assertAudienceExists(audience: Audience) {
  if (audience.kind === "UNIVERSITY") {
    const found = await prisma.university.count({ where: { id: audience.universityId } });
    if (!found) throw new AppError(404, "UNIVERSITY_NOT_FOUND", "University not found");
  }
  if (audience.kind === "SUB_AREA") {
    const found = await prisma.subArea.count({ where: { id: audience.subAreaId } });
    if (!found) throw new AppError(404, "SUB_AREA_NOT_FOUND", "Sub-area not found");
  }
}

// How many people would receive it (shown before sending).
export async function countAudience(audience: Audience) {
  await assertAudienceExists(audience);
  return { recipients: await prisma.user.count({ where: audienceWhere(audience) }) };
}

export async function sendAnnouncement(adminId: string, input: AnnouncementInput, ipAddress?: string) {
  await assertAudienceExists(input.audience);
  const id = uuidv7();
  const recipients = await prisma.user.count({ where: audienceWhere(input.audience) });
  if (recipients === 0) throw new AppError(409, "NO_RECIPIENTS", "Nobody matches this audience");
  await prisma.$transaction((tx) =>
    recordAudit(tx, {
      adminId,
      action: "ANNOUNCEMENT_SENT",
      targetType: "announcement",
      targetId: id,
      newValue: { title: input.title, body: input.body, audience: input.audience, recipients },
      ipAddress,
    }),
  );
  runInBackground("announcement", () => deliver(id, input));
  return { id, recipients };
}

// In batches, ordered by id, so a very large audience never loads at once.
// The dedupe key makes a repeated batch notify nobody twice.
async function deliver(id: string, input: AnnouncementInput) {
  let after: string | undefined;
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { ...audienceWhere(input.audience), ...(after && { id: { gt: after } }) },
      orderBy: { id: "asc" },
      take: rules.notifications.announcementBatch,
      select: { id: true },
    });
    if (batch.length === 0) return;
    await notify({
      type: "ANNOUNCEMENT",
      userIds: batch.map((user) => user.id),
      dedupeKey: `ANNOUNCEMENT:${id}`,
      data: { title: input.title, body: input.body },
    });
    after = batch.at(-1)!.id;
  }
}

// The latest announcements, from the Audit Log, for the admin page.
export async function listAnnouncements() {
  const rows = await prisma.auditLog.findMany({
    where: { action: "ANNOUNCEMENT_SENT" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { targetId: true, newValue: true, createdAt: true, admin: { select: { profile: { select: { fullName: true } } } } },
  });
  return rows.map((row) => {
    const value = (row.newValue ?? {}) as { title?: string; body?: string; audience?: Audience; recipients?: number };
    return {
      id: row.targetId,
      title: value.title ?? "",
      body: value.body ?? "",
      audience: value.audience ?? { kind: "ALL" },
      recipients: value.recipients ?? 0,
      sentAt: row.createdAt,
      sentBy: row.admin?.profile?.fullName ?? "",
    };
  });
}
