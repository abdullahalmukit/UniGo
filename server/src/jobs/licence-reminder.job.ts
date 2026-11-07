import { rules } from "../config/rules.js";
import { prisma } from "../lib/prisma.js";
import { notify } from "../modules/notifications/notify.service.js";
import { dateOnly, dateOnlyString, dhakaDateString } from "../utils/time.js";

// Licence expiry reminders (CLAUDE.md section 8, B1 decision 9, B2c decision):
// 30 and 7 days before the rider's current licence expires (the latest expiry
// among their approved applications), in-app and email, always sent.
// Runs every rules.notifications.licenceReminderInterval. When the first run
// already finds 7 days or fewer, only the 7-day reminder is sent. The dedupe
// key holds the expiry date and the threshold, so a renewed licence gets its
// own reminders and nothing is sent twice.

const DAY = 24 * 60 * 60 * 1000;

export async function runLicenceReminderJob(now = new Date()) {
  const thresholds = [...rules.notifications.licenceReminderDays].sort((a, b) => a - b);
  const today = dhakaDateString(now);
  const latest = new Date(dateOnly(today).getTime() + Math.max(...thresholds) * DAY);

  // Each rider's current expiry, if it falls within the reminder window.
  const rows = await prisma.riderApplication.groupBy({
    by: ["userId"],
    where: { status: "APPROVED", user: { isVerifiedRider: true } },
    _max: { licenceExpiresOn: true },
  });

  let sent = 0;
  for (const row of rows) {
    const expires = row._max.licenceExpiresOn;
    if (!expires || expires < dateOnly(today) || expires > latest) continue;
    const expiresOn = dateOnlyString(expires);
    const days = Math.round((expires.getTime() - dateOnly(today).getTime()) / DAY);
    const threshold = thresholds.find((limit) => days <= limit);
    if (threshold === undefined) continue;
    const created = await notify({
      type: "LICENCE_EXPIRY_REMINDER",
      userIds: [row.userId],
      dedupeKey: `LICENCE_EXPIRY_REMINDER:${row.userId}:${expiresOn}:${threshold}`,
      data: { expiresOn, days },
    });
    if (created.length > 0) sent += 1;
  }
  return sent;
}
