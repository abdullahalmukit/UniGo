import { describe, expect, it } from "vitest";
import { OPEN_REQUEST_TYPES, checkTransition, EXPIRING_TYPES } from "../../src/modules/activities/transitions.js";
import {
  addMonthsClamped,
  contractEndDate,
  contractMonths,
  holdExpiry,
  nextRideTime,
  schedulesOverlap,
  sessionDates,
  sessionStart,
  weekdayOf,
} from "../../src/modules/carpool/carpool-dates.js";
import { notificationLink } from "../../src/modules/notifications/link.js";
import { renderText } from "../../src/modules/notifications/templates.js";
import { systemCodeFor } from "../../src/modules/chat/chat-system.js";

// Days of the week as the post's bitmask (bit 0 = Sunday)
const EVERY_DAY = 127;
const TUESDAY = 1 << 2;
const SUN_TUE_THU = (1 << 0) | (1 << 2) | (1 << 4);
const SUN_TO_THU = 0b0011111;

describe("carpool contract months (B6a Q4)", () => {
  it("counts months from the start date: 10 Nov - 9 Dec is month 1", () => {
    expect(contractEndDate("2026-11-10", 1)).toBe("2026-12-09");
    expect(contractEndDate("2026-11-10", 4)).toBe("2027-03-09");
    expect(contractMonths("2026-11-10", 2)).toEqual([
      { monthNumber: 1, periodStart: "2026-11-10", periodEnd: "2026-12-09" },
      { monthNumber: 2, periodStart: "2026-12-10", periodEnd: "2027-01-09" },
    ]);
  });

  it("moves a month start back to the last day of a shorter month, from the start date's day", () => {
    expect(addMonthsClamped("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsClamped("2027-01-31", 2)).toBe("2027-03-31");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(contractEndDate("2027-01-31", 1)).toBe("2027-02-27");
    expect(addMonthsClamped("2026-11-30", 3)).toBe("2027-02-28");
  });
});

describe("carpool sessions for each duration and day pattern", () => {
  // 10 November 2026 is a Tuesday
  const counts: Record<number, number[]> = {
    1: [30, 5, 13, 22],
    2: [61, 9, 26, 43],
    3: [92, 14, 40, 66],
    4: [120, 18, 52, 86],
  };
  for (const months of [1, 2, 3, 4]) {
    it(`${months} month(s): every day, Tuesdays, Sun/Tue/Thu, Sun-Thu`, () => {
      const end = contractEndDate("2026-11-10", months);
      const got = [EVERY_DAY, TUESDAY, SUN_TUE_THU, SUN_TO_THU].map((mask) => sessionDates("2026-11-10", end, mask).length);
      expect(got).toEqual(counts[months]);
    });
  }

  it("only lists the post's ride days, at its Asia/Dhaka time", () => {
    expect(weekdayOf("2026-11-10")).toBe(2);
    const dates = sessionDates("2026-11-10", "2026-11-16", SUN_TUE_THU);
    expect(dates).toEqual(["2026-11-10", "2026-11-12", "2026-11-15"]);
    // 08:30 in Dhaka is 02:30 UTC
    expect(sessionStart("2026-11-10", 8 * 60 + 30).toISOString()).toBe("2026-11-10T02:30:00.000Z");
  });
});

describe("a rider's own schedules must not overlap (B6a Q5)", () => {
  const base = { daysOfWeek: TUESDAY, departureMinute: 8 * 60, validFrom: "2026-11-10", validUntil: null };

  it("refuses less than 90 minutes apart on a shared day; exactly 90 is allowed", () => {
    expect(schedulesOverlap(base, { ...base, departureMinute: 8 * 60 + 60 })).toBe(true);
    expect(schedulesOverlap(base, { ...base, departureMinute: 8 * 60 + 90 })).toBe(false);
    expect(schedulesOverlap(base, { ...base, daysOfWeek: 1 << 3 })).toBe(false);
  });

  it("checks across midnight on the weekly clock", () => {
    const saturdayLate = { ...base, daysOfWeek: 1 << 6, departureMinute: 23 * 60 + 30 };
    const sundayEarly = { ...base, daysOfWeek: 1 << 0, departureMinute: 30 };
    expect(schedulesOverlap(saturdayLate, sundayEarly)).toBe(true);
  });

  it("does not overlap when the validity periods do not meet", () => {
    const first = { ...base, validUntil: "2026-12-31" };
    expect(schedulesOverlap(first, { ...base, validFrom: "2027-01-01" })).toBe(false);
    expect(schedulesOverlap(first, { ...base, validFrom: "2026-12-31" })).toBe(true);
  });
});

describe("seat hold and next ride", () => {
  it("holds for 24 hours, or until the first ride when that is sooner (B6a Q1)", () => {
    const now = new Date("2026-11-08T10:00:00.000Z");
    expect(holdExpiry(now, new Date("2026-11-12T02:30:00.000Z")).toISOString()).toBe("2026-11-09T10:00:00.000Z");
    expect(holdExpiry(now, new Date("2026-11-09T02:30:00.000Z")).toISOString()).toBe("2026-11-09T02:30:00.000Z");
  });

  it("finds the next ride within the post's dates", () => {
    const now = new Date("2026-11-08T10:00:00.000Z"); // Sunday 16:00 in Dhaka
    const next = nextRideTime({ daysOfWeek: TUESDAY, departureMinute: 8 * 60, validFrom: "2026-11-01", validUntil: null }, now);
    expect(next?.toISOString()).toBe("2026-11-10T02:00:00.000Z");
    expect(nextRideTime({ daysOfWeek: TUESDAY, departureMinute: 8 * 60, validFrom: "2026-11-01", validUntil: "2026-11-09" }, now)).toBeNull();
  });
});

describe("carpool in the engine", () => {
  it("expires an unanswered booking request but keeps carpool out of the open and daily limits", () => {
    expect(EXPIRING_TYPES).toContain("CARPOOL_BOOKING");
    expect(OPEN_REQUEST_TYPES as readonly string[]).not.toContain("CARPOOL_BOOKING");
    const booking = { type: "CARPOOL_BOOKING" as const, status: "OPEN" as const, subStatus: null, creatorId: "r", accepterId: "p", completionRequestedById: null };
    expect(checkTransition(booking, "EXPIRE", { type: "SYSTEM" }).to.status).toBe("EXPIRED");
  });

  it("writes a chat line when the contract becomes active", () => {
    expect(systemCodeFor({ status: "ACCEPTED", subStatus: null }, { status: "ACCEPTED", subStatus: "CONTRACT_ACTIVE" })).toBe("CONTRACT_ACTIVE");
  });
});

describe("carpool notifications", () => {
  it("tells the other person to agree before the hold ends (B6a Q11)", () => {
    const data = { activityType: "CARPOOL_BOOKING" as const, name: "Rina", endsAt: "2026-11-09T10:00:00.000Z" };
    expect(renderText("CARPOOL_AGREE_REQUESTED", data, "EN").body).toBe(
      "Rina agreed to the carpool contract. Your turn: the seat hold ends at 9 November 2026 at 4:00 pm.",
    );
    expect(renderText("CARPOOL_AGREE_REQUESTED", data, "BN").body).toContain("Rina");
  });

  it("opens the booking page", () => {
    expect(notificationLink("CARPOOL_BOOKING_REQUESTED", { activityType: "CARPOOL_BOOKING" }, "b1")).toBe("/carpool/bookings/b1");
    expect(notificationLink("CARPOOL_AGREE_REQUESTED", { activityType: "CARPOOL_BOOKING", chatId: "c1" }, "b1")).toBe("/carpool/bookings/b1");
  });
});
