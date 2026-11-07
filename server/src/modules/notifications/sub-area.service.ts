import { rules } from "../../config/rules.js";
import { queueJob } from "../../jobs/scheduler.js";
import { prisma } from "../../lib/prisma.js";
import { accountStatusSelect, effectiveAccountStatus } from "../auth/account-status.js";
import { blockedUserIds } from "../users/blocks.service.js";
import { notify } from "./notify.service.js";

// Sub-area notifications (proposal sections 14 and 15.5, B2c): a new food or
// service request tells the users who saved its sub-area, in-app and push.
// Left out: the creator, users blocked in either direction, users who are not
// verified students, and accounts that are not ACTIVE right now. An inactive
// sub-area notifies nobody. B4 and B5 call queueSubAreaNotification() after
// creating the request.

const SUB_AREA_TYPES = ["FOOD", "SERVICE"] as const;

export function queueSubAreaNotification(activityId: string) {
  return queueJob({ name: "sub-area-notify", jobId: `sub-area-notify-${activityId}`, runAt: new Date(), data: { id: activityId } });
}

// The job: re-reads the request and sends only while it is still OPEN. The
// dedupe key is the request, so an edit or a second run notifies nobody twice.
export async function runSubAreaNotifyJob(activityId: string, now = new Date()) {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, deletedAt: null, status: "OPEN", type: { in: [...SUB_AREA_TYPES] } },
    select: {
      id: true,
      type: true,
      creatorId: true,
      foodRequest: { select: { subArea: { select: { id: true, name: true, isActive: true } } } },
      serviceRequest: { select: { subArea: { select: { id: true, name: true, isActive: true } } } },
    },
  });
  const subArea = activity?.foodRequest?.subArea ?? activity?.serviceRequest?.subArea;
  if (!activity || !subArea || !subArea.isActive) return 0;

  const excluded = new Set([activity.creatorId, ...(await blockedUserIds(prisma, activity.creatorId))]);
  let sent = 0;
  let cursor: string | undefined;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { studentVerificationStatus: "VERIFIED", accountStatus: { not: "BANNED" }, subAreas: { some: { subAreaId: subArea.id } } },
      select: { id: true, ...accountStatusSelect },
      orderBy: { id: "asc" },
      take: rules.notifications.subAreaBatch,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1]!.id;
    const recipients = users.filter((user) => !excluded.has(user.id) && effectiveAccountStatus(user, now) === "ACTIVE").map((user) => user.id);
    const created = await notify({
      type: "SUB_AREA_NEW_REQUEST",
      userIds: recipients,
      dedupeKey: `SUB_AREA_NEW_REQUEST:${activity.id}`,
      activityId: activity.id,
      data: { activityType: activity.type, subAreaName: subArea.name },
    });
    sent += new Set(created.map((row) => row.userId)).size;
    if (users.length < rules.notifications.subAreaBatch) break;
  }
  return sent;
}
