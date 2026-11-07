import { rules } from "../../config/rules.js";
import { dateOnly, dateOnlyString, dhakaDateString, dhakaWallTime } from "../../utils/time.js";

// Pure date rules of Carpool (proposal section 9, B6a decisions). No database.
// Dates are "YYYY-MM-DD" days in Asia/Dhaka; a post's departure is a minute
// of the day in Asia/Dhaka (UTC+6 all year, so no daylight saving gaps).

const DAY = 24 * 60 * 60 * 1000;
const WEEK_MINUTES = 7 * 24 * 60;

// Weekday of a date: 0 = Sunday ... 6 = Saturday (the post's bitmask bits).
export const weekdayOf = (date: string) => dateOnly(date).getUTCDay();

export const addDays = (date: string, days: number) => dateOnlyString(new Date(dateOnly(date).getTime() + days * DAY));

export const runsOn = (daysOfWeek: number, date: string) => (daysOfWeek & (1 << weekdayOf(date))) !== 0;

// Weekdays in a bitmask, Sunday first.
export const weekdays = (daysOfWeek: number) => [0, 1, 2, 3, 4, 5, 6].filter((day) => (daysOfWeek & (1 << day)) !== 0);

// Tomorrow in Asia/Dhaka: the earliest start date of a contract (7.6).
export const tomorrow = (now = new Date()) => addDays(dhakaDateString(now), 1);

// Month k (0-based) of a contract starts on the start date's day of the
// month, moved back to the last day of a shorter month (B6a Q4): from
// 31 January, months start on 31 Jan, 28/29 Feb, 31 Mar ...
export function addMonthsClamped(start: string, months: number) {
  const [year, month, day] = start.split("-").map(Number) as [number, number, number];
  const index = month - 1 + months;
  const targetYear = year + Math.floor(index / 12);
  const targetMonth = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateOnlyString(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))));
}

// The contract's last day: start + N months - 1 day (10 Nov, 1 month -> 9 Dec).
export const contractEndDate = (start: string, months: number) => addDays(addMonthsClamped(start, months), -1);

// Each contract month (for the monthly payment records of B6b).
export function contractMonths(start: string, months: number) {
  return Array.from({ length: months }, (_, i) => ({
    monthNumber: i + 1,
    periodStart: addMonthsClamped(start, i),
    periodEnd: addDays(addMonthsClamped(start, i + 1), -1),
  }));
}

// Every ride day from start to end (both included) that the post runs on.
export function sessionDates(start: string, end: string, daysOfWeek: number) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) if (runsOn(daysOfWeek, date)) dates.push(date);
  return dates;
}

// A session's start instant: its date at the post's departure minute.
export const sessionStart = (date: string, departureMinute: number) => dhakaWallTime(date, Math.floor(departureMinute / 60), departureMinute % 60);

// The midnight (Asia/Dhaka) that ends a date: when a post's validity or a
// contract runs out.
export const endOfDate = (date: string) => dhakaWallTime(addDays(date, 1), 0, 0);

// B6a Q5: two of a rider's posts overlap when they share a ride day with
// departures less than 90 minutes apart (also across midnight, on the weekly
// clock) and their validity periods overlap (no end date = open-ended).
export type PostSchedule = { daysOfWeek: number; departureMinute: number; validFrom: string; validUntil: string | null };

export function schedulesOverlap(a: PostSchedule, b: PostSchedule) {
  const aEnd = a.validUntil ?? "9999-12-31";
  const bEnd = b.validUntil ?? "9999-12-31";
  if (a.validFrom > bEnd || b.validFrom > aEnd) return false;
  const window = rules.activity.conflictWindow / 60000;
  for (const dayA of weekdays(a.daysOfWeek)) {
    for (const dayB of weekdays(b.daysOfWeek)) {
      const diff = Math.abs(dayA * 1440 + a.departureMinute - (dayB * 1440 + b.departureMinute));
      if (Math.min(diff, WEEK_MINUTES - diff) < window) return true;
    }
  }
  return false;
}

// The next ride of a post at or after `now`, within its validity (feed order).
export function nextRideTime(post: { daysOfWeek: number; departureMinute: number; validFrom: string; validUntil: string | null }, now = new Date()) {
  let date = dhakaDateString(now) > post.validFrom ? dhakaDateString(now) : post.validFrom;
  for (let i = 0; i < 8; i += 1, date = addDays(date, 1)) {
    if (post.validUntil && date > post.validUntil) return null;
    const start = sessionStart(date, post.departureMinute);
    if (runsOn(post.daysOfWeek, date) && start > now) return start;
  }
  return null;
}

// The seat hold ends 24 hours after the rider accepts, or at the first
// session's departure if that is sooner (B6a Q1).
export function holdExpiry(acceptedAt: Date, firstSession: Date) {
  const day = new Date(acceptedAt.getTime() + rules.carpool.seatHold);
  return day < firstSession ? day : firstSession;
}
