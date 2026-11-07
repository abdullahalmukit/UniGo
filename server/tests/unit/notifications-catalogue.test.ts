import { describe, expect, it } from "vitest";
import { NotificationType } from "../../src/generated/prisma/enums.js";
import { CATALOGUE } from "../../src/modules/notifications/catalogue.js";
import { notificationLink } from "../../src/modules/notifications/link.js";
import { renderEmail, renderPush, renderText } from "../../src/modules/notifications/templates.js";

// Proposal section 14, row by row: type -> channels (and the B2c additions).
const SECTION_14 = {
  REQUEST_ACCEPTED: ["IN_APP", "PUSH", "EMAIL"],
  SEAT_BOOKED: ["IN_APP", "PUSH", "EMAIL"],
  CARPOOL_BOOKING_REQUESTED: ["IN_APP", "PUSH"],
  CARPOOL_BOOKING_ACCEPTED: ["IN_APP", "PUSH", "EMAIL"],
  CARPOOL_BOOKING_REJECTED: ["IN_APP", "PUSH", "EMAIL"],
  CARPOOL_CONTRACT_CREATED: ["IN_APP", "PUSH", "EMAIL"],
  CARPOOL_SESSION_REMINDER: ["IN_APP", "PUSH"],
  ACTIVITY_REMINDER: ["IN_APP", "PUSH"],
  COMPLETION_REQUESTED: ["IN_APP", "PUSH"],
  AUTO_COMPLETED: ["IN_APP"],
  AUTO_CLOSED_NOT_MARKED: ["IN_APP"],
  ACTIVITY_CANCELLED: ["IN_APP", "PUSH", "EMAIL"],
  DISPUTE_OPENED: ["IN_APP", "PUSH", "EMAIL"],
  DISPUTE_UPDATED: ["IN_APP", "PUSH", "EMAIL"],
  DISPUTE_RESOLVED: ["IN_APP", "PUSH", "EMAIL"],
  NEW_CHAT_MESSAGE: ["IN_APP", "PUSH"],
  SUB_AREA_NEW_REQUEST: ["IN_APP", "PUSH"],
  STUDENT_VERIFICATION_RESULT: ["IN_APP", "EMAIL"],
  RIDER_VERIFICATION_RESULT: ["IN_APP", "EMAIL"],
  REQUEST_EXPIRED: ["IN_APP"],
  CARPOOL_PAYMENT_DUE: ["IN_APP"],
  REPORT_UPDATE: ["IN_APP"],
  SUPPORT_UPDATE: ["IN_APP"],
  ANNOUNCEMENT: ["IN_APP", "PUSH"],
  ACCOUNT_STATUS_CHANGED: ["IN_APP", "EMAIL"],
  PASSWORD_RESET_REQUESTED: ["EMAIL"],
  PASSWORD_CHANGED: ["EMAIL"],
  // B2c additions approved by the developer
  LICENCE_EXPIRY_REMINDER: ["IN_APP", "EMAIL"],
  PARTICIPANT_ACCOUNT_LOCKED: ["IN_APP", "PUSH", "EMAIL"],
  RIDER_ACCESS_CHANGED: ["IN_APP", "EMAIL"],
  // B3b-2 (Q1)
  REVIEW_PUBLISHED: ["IN_APP"],
} as const;

const ACCOUNT_EMAILS = [
  "STUDENT_VERIFICATION_RESULT",
  "RIDER_VERIFICATION_RESULT",
  "ACCOUNT_STATUS_CHANGED",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_CHANGED",
  "LICENCE_EXPIRY_REMINDER",
  "RIDER_ACCESS_CHANGED",
];

const types = Object.values(NotificationType);
const sample = {
  activityType: "FOOD" as const,
  name: "Rina",
  chatId: "chat-1",
  startTime: "2026-11-07T10:00:00.000Z",
  kind: "REJECTED",
  reason: "Blurry photo",
  count: 3,
  expiresOn: "2026-12-01",
  days: 7,
  subAreaName: "Dhanmondi",
  title: "Hello",
  body: "News",
};

describe("notification catalogue (proposal section 14)", () => {
  it("lists every notification type with exactly the table's channels", () => {
    expect(Object.keys(CATALOGUE).sort()).toEqual([...types].sort());
    for (const type of types) expect([...CATALOGUE[type].channels], type).toEqual(SECTION_14[type]);
  });

  it("always sends account and security emails, and lets the switch control activity emails", () => {
    for (const type of types) {
      if (!CATALOGUE[type].channels.includes("EMAIL")) continue;
      expect(CATALOGUE[type].email, type).toBe(ACCOUNT_EMAILS.includes(type) ? "ACCOUNT" : "ACTIVITY");
    }
  });

  it("has Bangla and English text for every type, and push text is kept short", () => {
    for (const type of types) {
      for (const language of ["EN", "BN"] as const) {
        const text = renderText(type, sample, language);
        expect(text.title.trim(), `${type} ${language}`).not.toBe("");
        const push = renderPush(type, sample, language, 120);
        expect(push.title.length).toBeLessThanOrEqual(120);
        expect(push.body.length).toBeLessThanOrEqual(240);
      }
    }
    expect(renderText("REQUEST_ACCEPTED", sample, "BN").body).toContain("Rina");
    expect(renderText("REQUEST_ACCEPTED", sample, "EN").body).toBe("Rina accepted your food delivery.");
  });

  it("never puts the chat message text in a chat notification", () => {
    const text = renderText("NEW_CHAT_MESSAGE", { name: "Rina", count: 1 }, "EN");
    expect(text).toEqual({ title: "New message from Rina", body: "Open the chat to read it." });
    expect(renderText("NEW_CHAT_MESSAGE", { name: "Rina", count: 3 }, "EN").body).toBe("3 new messages");
  });

  it("builds an email for every email type, with the off switch only on activity emails", () => {
    for (const type of types) {
      if (!CATALOGUE[type].channels.includes("EMAIL") || type === "PASSWORD_RESET_REQUESTED") continue;
      const email = renderEmail(type, sample, "EN", "Karim", "/activity");
      expect(email.subject, type).not.toBe("");
      expect(email.text).toContain("Karim");
      expect(email.text.includes("Account › Notifications"), type).toBe(CATALOGUE[type].email === "ACTIVITY");
    }
  });

  it("links every notification to a path on this site", () => {
    for (const type of types) {
      for (const data of [sample, {}]) {
        const link = notificationLink(type, data);
        expect(link.startsWith("/") && !link.startsWith("//"), `${type} ${link}`).toBe(true);
      }
    }
    expect(notificationLink("NEW_CHAT_MESSAGE", { chatId: "c1" })).toBe("/inbox/c1");
    expect(notificationLink("REQUEST_ACCEPTED", { chatId: "c1" })).toBe("/inbox/c1");
    expect(notificationLink("RIDER_ACCESS_CHANGED", {})).toBe("/drive");
  });
});
