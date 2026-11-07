import type { ActivityType, NotificationChannel, NotificationType } from "../../generated/prisma/client.js";

// Every notification UniGo sends: proposal section 14, row by row, plus the
// B2c additions (decisions log). `channels` is exactly the table's channel
// list. `email` says whether the email follows the user's email switch
// (ACTIVITY) or is always sent (ACCOUNT: security, verification, account and
// rider status).

export type EmailClass = "ACTIVITY" | "ACCOUNT";

export type CatalogueEntry = {
  // Who receives it, as written in the section 14 table (documentation and tests)
  recipients: string;
  channels: readonly NotificationChannel[];
  email?: EmailClass;
};

const IN_APP_PUSH_EMAIL = ["IN_APP", "PUSH", "EMAIL"] as const;
const IN_APP_PUSH = ["IN_APP", "PUSH"] as const;
const IN_APP = ["IN_APP"] as const;
const IN_APP_EMAIL = ["IN_APP", "EMAIL"] as const;

export const CATALOGUE: Record<NotificationType, CatalogueEntry> = {
  // Request accepted / seat booked
  REQUEST_ACCEPTED: { recipients: "Creator", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  SEAT_BOOKED: { recipients: "Creator", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  // New carpool booking request
  CARPOOL_BOOKING_REQUESTED: { recipients: "Rider", channels: IN_APP_PUSH },
  // Booking request accepted or rejected
  CARPOOL_BOOKING_ACCEPTED: { recipients: "Passenger", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  CARPOOL_BOOKING_REJECTED: { recipients: "Passenger", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  CARPOOL_CONTRACT_CREATED: { recipients: "Both", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  CARPOOL_SESSION_REMINDER: { recipients: "Both", channels: IN_APP_PUSH },
  // Upcoming activity, 30 minutes before
  ACTIVITY_REMINDER: { recipients: "Both", channels: IN_APP_PUSH },
  COMPLETION_REQUESTED: { recipients: "Other participant", channels: IN_APP_PUSH },
  // Auto-completed / auto-closed (NOT_MARKED)
  AUTO_COMPLETED: { recipients: "Both", channels: IN_APP },
  AUTO_CLOSED_NOT_MARKED: { recipients: "Both", channels: IN_APP },
  ACTIVITY_CANCELLED: { recipients: "Other participant", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  // Dispute opened, updated or resolved
  DISPUTE_OPENED: { recipients: "Both", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  DISPUTE_UPDATED: { recipients: "Both", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  DISPUTE_RESOLVED: { recipients: "Both", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  NEW_CHAT_MESSAGE: { recipients: "Receiver", channels: IN_APP_PUSH },
  // New food or service request in my sub-area
  SUB_AREA_NEW_REQUEST: { recipients: "Users who saved that sub-area (not blocked)", channels: IN_APP_PUSH },
  // Student or rider verification result
  STUDENT_VERIFICATION_RESULT: { recipients: "Applicant", channels: IN_APP_EMAIL, email: "ACCOUNT" },
  RIDER_VERIFICATION_RESULT: { recipients: "Applicant", channels: IN_APP_EMAIL, email: "ACCOUNT" },
  REQUEST_EXPIRED: { recipients: "Creator", channels: IN_APP },
  CARPOOL_PAYMENT_DUE: { recipients: "Passenger", channels: IN_APP },
  // Report or support update
  REPORT_UPDATE: { recipients: "Reporter", channels: IN_APP },
  SUPPORT_UPDATE: { recipients: "Reporter", channels: IN_APP },
  // Promo, spotlight or announcement
  ANNOUNCEMENT: { recipients: "All or selected users", channels: IN_APP_PUSH },
  ACCOUNT_STATUS_CHANGED: { recipients: "Affected user", channels: IN_APP_EMAIL, email: "ACCOUNT" },
  // Password reset requested / password changed
  PASSWORD_RESET_REQUESTED: { recipients: "Account owner", channels: ["EMAIL"], email: "ACCOUNT" },
  PASSWORD_CHANGED: { recipients: "Account owner", channels: ["EMAIL"], email: "ACCOUNT" },
  // B2c additions (not in the section 14 table; approved by the developer)
  LICENCE_EXPIRY_REMINDER: { recipients: "Rider", channels: IN_APP_EMAIL, email: "ACCOUNT" },
  PARTICIPANT_ACCOUNT_LOCKED: { recipients: "Other participant", channels: IN_APP_PUSH_EMAIL, email: "ACTIVITY" },
  RIDER_ACCESS_CHANGED: { recipients: "Rider", channels: IN_APP_EMAIL, email: "ACCOUNT" },
  // B3b-2 (Q1): a review about the user was published
  REVIEW_PUBLISHED: { recipients: "Reviewee", channels: IN_APP },
  // B4 (Q2): food order details to confirm, over-budget approval asked and decided
  FOOD_ORDER_TO_CONFIRM: { recipients: "Other participant", channels: IN_APP_PUSH },
  FOOD_BUDGET_APPROVAL_REQUESTED: { recipients: "Requester", channels: IN_APP_PUSH },
  FOOD_BUDGET_APPROVAL_DECIDED: { recipients: "Accepter", channels: IN_APP_PUSH },
};

// Values stored with a notification to build its text in the recipient's
// language. Names of other users are kept as they were when it was sent.
// Never an email address, phone number, token or file link.
export type NotificationData = {
  activityType?: ActivityType;
  // The other user (who accepted, cancelled, sent the message...)
  name?: string;
  chatId?: string;
  // ISO date-time of the activity's start (reminders)
  startTime?: string;
  // A variant of the type, e.g. APPROVED / REJECTED, WARN / BAN
  kind?: string;
  // An admin's reason (account and verification decisions)
  reason?: string;
  startsAt?: string;
  endsAt?: string;
  // Chat: messages in this unread run; push: alert again only for the first
  count?: number;
  renotify?: boolean;
  reverification?: boolean;
  // Licence reminders: "YYYY-MM-DD" and whole days left
  expiresOn?: string;
  days?: number;
  subAreaName?: string;
  // B3b-2: the user a link opens (a published review opens the reviewee's profile)
  userId?: string;
  // Announcements written by an admin
  title?: string;
  body?: string;
};
