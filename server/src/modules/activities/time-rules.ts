import { rules } from "../../config/rules.js";
import type { ActivityType } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";
import { dhakaWallTime } from "../../utils/time.js";

// Pure time rules of the activity engine (CLAUDE.md 5.4 to 5.8). No database.

const WINDOW = rules.activity.conflictWindow;

// Each accepted activity blocks start to start + 90 minutes, so two activities
// conflict when their starts are less than 90 minutes apart. Exactly 90 minutes
// apart is allowed.
export function windowsOverlap(a: Date, b: Date) {
  return Math.abs(a.getTime() - b.getTime()) < WINDOW;
}

// Starts that conflict with `start` lie strictly between these two instants.
export function conflictRange(start: Date) {
  return { after: new Date(start.getTime() - WINDOW), before: new Date(start.getTime() + WINDOW) };
}

export type CreationFeature = "RIDE" | "FOOD" | "SERVICE";

const LATEST = {
  RIDE: rules.creationWindow.rideLatestFromNow,
  FOOD: rules.creationWindow.foodLatestFromNow,
  SERVICE: rules.creationWindow.serviceLatestFromNow,
} as const;

// Creation (and edit) time limits, CLAUDE.md 5.6. Inclusive at both ends.
export function assertCreationWindow(feature: CreationFeature, start: Date, now = new Date()) {
  const fromNow = start.getTime() - now.getTime();
  if (fromNow < rules.creationWindow.earliestFromNow) {
    throw new AppError(400, "START_TOO_SOON", "Choose a time at least 15 minutes from now");
  }
  if (fromNow > LATEST[feature]) {
    throw new AppError(400, "START_TOO_LATE", "This time is too far ahead");
  }
}

// A service request with only a preferred date starts at 23:59 Asia/Dhaka on
// that date for expiry, NOT_MARKED and Upcoming ordering (A2 decision 8).
export function dateOnlyServiceStart(date: string) {
  const { hour, minute } = rules.activity.dateOnlyServiceStart;
  return dhakaWallTime(date, hour, minute);
}

// Whether a new activity takes part in the 90-minute conflict check
// (activities.blocks_time). A carpool booking never does: its sessions block
// time instead. A service request without a time does not either.
export function blocksTimeFor(type: ActivityType, options: { hasPreferredTime?: boolean } = {}) {
  if (type === "CARPOOL_BOOKING") return false;
  if (type === "SERVICE") return options.hasPreferredTime === true;
  return true;
}

// Cancelling less than 60 minutes before the start (or after it) is late (5.8).
export function isLateCancellation(start: Date, now = new Date()) {
  return start.getTime() - now.getTime() < rules.activity.lateCancellationBeforeStart;
}
