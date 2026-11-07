import { env } from "../../config/env.js";
import type { ActivityType, Language, NotificationType } from "../../generated/prisma/client.js";
import { formatDhakaDateTime } from "../../utils/time.js";
import { accountStatusEmail, accountStatusText, type AccountEmailKind } from "../email/account-status-templates.js";
import { riderEmail, riderText, type RiderEmailKind } from "../email/rider-templates.js";
import {
  escapeHtml,
  layout,
  numbers,
  paragraph,
  passwordChangedEmail,
  studentVerificationApprovedEmail,
  studentVerificationRejectedEmail,
  type Email,
} from "../email/templates.js";
import { CATALOGUE, type NotificationData } from "./catalogue.js";

// Notification texts in Bangla and English (proposal section 14), picked by
// the recipient's saved language. In-app text is built when the list is read;
// push and email text when they are sent. Account, verification and password
// emails keep the templates they had since A4-B1.

export type Text = { title: string; body: string };
type Template = (d: NotificationData, f: Format) => Text;
type Format = { activity: string; time: string; name: string; count: string; days: string; date: string };

const ACTIVITY_LABELS: Record<Language, Record<ActivityType, string>> = {
  EN: {
    RIDE_REQUEST: "ride",
    RIDE_BOOKING: "ride",
    CARPOOL_BOOKING: "carpool booking",
    CARPOOL_SESSION: "carpool ride",
    FOOD: "food delivery",
    SERVICE: "service request",
  },
  BN: {
    RIDE_REQUEST: "রাইড",
    RIDE_BOOKING: "রাইড",
    CARPOOL_BOOKING: "কারপুল বুকিং",
    CARPOOL_SESSION: "কারপুল রাইড",
    FOOD: "ফুড ডেলিভারি",
    SERVICE: "সার্ভিস অনুরোধ",
  },
};

// Types whose text comes from the A6/B1 account templates
type OwnTemplates = Exclude<NotificationType, "ACCOUNT_STATUS_CHANGED" | "RIDER_VERIFICATION_RESULT" | "RIDER_ACCESS_CHANGED">;

const EN: Record<OwnTemplates, Template> = {
  REQUEST_ACCEPTED: (_d, f) => ({ title: "Your request was accepted", body: `${f.name} accepted your ${f.activity}.` }),
  SEAT_BOOKED: (_d, f) => ({ title: "New seat booking", body: `${f.name} booked a seat on your ride.` }),
  CARPOOL_BOOKING_REQUESTED: (_d, f) => ({ title: "New carpool seat request", body: `${f.name} asked for a seat on your carpool.` }),
  CARPOOL_BOOKING_ACCEPTED: (_d, f) => ({
    title: "Carpool request accepted",
    body: `${f.name} accepted your carpool seat request. Agree on the details in the chat.`,
  }),
  CARPOOL_BOOKING_REJECTED: (_d, f) => ({ title: "Carpool request declined", body: `${f.name} declined your carpool seat request.` }),
  CARPOOL_CONTRACT_CREATED: (_d, f) => ({ title: "Carpool contract started", body: `Your carpool contract with ${f.name} is now active.` }),
  CARPOOL_SESSION_REMINDER: (_d, f) => ({ title: "Carpool today", body: `Your carpool ride with ${f.name} is today at ${f.time}.` }),
  ACTIVITY_REMINDER: (_d, f) => ({ title: "Starting in 30 minutes", body: `Your ${f.activity} with ${f.name} starts at ${f.time}.` }),
  COMPLETION_REQUESTED: (_d, f) => ({
    title: "Confirm completion",
    body: `${f.name} marked your ${f.activity} as completed. Confirm it, or raise a dispute if something is wrong. It completes automatically after 24 hours.`,
  }),
  AUTO_COMPLETED: (_d, f) => ({
    title: "Completed automatically",
    body: `Your ${f.activity} with ${f.name} was completed automatically after 24 hours.`,
  }),
  AUTO_CLOSED_NOT_MARKED: (_d, f) => ({
    title: "Closed as not marked",
    body: `Your ${f.activity} with ${f.name} was closed because nobody marked it started within 6 hours of its start time.`,
  }),
  ACTIVITY_CANCELLED: (d, f) => ({
    title: "Activity cancelled",
    body:
      d.kind === "HOLD_EXPIRED"
        ? `Your held carpool seat with ${f.name} was released because the contract was not agreed in time.`
        : d.kind === "UNIGO"
          ? `Your ${f.activity} with ${f.name} was cancelled by UniGo.`
          : `${f.name} cancelled your ${f.activity}.`,
  }),
  DISPUTE_OPENED: (_d, f) => ({
    title: "Dispute opened",
    body: `A dispute was opened on your ${f.activity} with ${f.name}. An admin will review it.`,
  }),
  DISPUTE_UPDATED: (_d, f) => ({ title: "Dispute updated", body: `There is an update on the dispute about your ${f.activity}.` }),
  DISPUTE_RESOLVED: (d, f) => ({
    title: "Dispute resolved",
    body: `The dispute about your ${f.activity} with ${f.name} was resolved. The activity is now ${d.kind === "CANCELLED" ? "cancelled" : "completed"}.`,
  }),
  // Never the message text (B2c decision): lock screens are seen by others.
  NEW_CHAT_MESSAGE: (d, f) => ({
    title: `New message from ${f.name}`,
    body: (d.count ?? 1) > 1 ? `${f.count} new messages` : "Open the chat to read it.",
  }),
  SUB_AREA_NEW_REQUEST: (d, f) => ({
    title: `New request in ${d.subAreaName ?? ""}`,
    body: `A new ${f.activity} was posted in ${d.subAreaName ?? ""}, one of your sub-areas.`,
  }),
  STUDENT_VERIFICATION_RESULT: (d) =>
    d.kind === "REJECTED"
      ? { title: "Student verification not approved", body: "We could not approve your student ID card. Open Verification to try again." }
      : { title: "Student verification approved", body: "You are now a verified student and can use every UniGo service." },
  REQUEST_EXPIRED: (_d, f) => ({ title: "Request expired", body: `Nobody accepted your ${f.activity} before its start time.` }),
  CARPOOL_PAYMENT_DUE: (_d, f) => ({ title: "Carpool payment due", body: `This month's carpool payment to ${f.name} is due.` }),
  REPORT_UPDATE: () => ({ title: "Report update", body: "There is an update on your report." }),
  SUPPORT_UPDATE: () => ({ title: "Support update", body: "There is an update on your support request." }),
  ANNOUNCEMENT: (d) => ({ title: d.title ?? "UniGo", body: d.body ?? "" }),
  PASSWORD_RESET_REQUESTED: () => ({ title: "Reset your UniGo password", body: "A password reset link was sent to your email." }),
  PASSWORD_CHANGED: () => ({ title: "Your UniGo password was changed", body: "Your password was changed." }),
  LICENCE_EXPIRY_REMINDER: (_d, f) => ({
    title: "Your driving licence expires soon",
    body: `Your driving licence expires on ${f.date} (in ${f.days} days). Send a re-verification with your renewed licence from Drive with UniGo to keep driving.`,
  }),
  PARTICIPANT_ACCOUNT_LOCKED: (_d, f) => ({
    title: `Update on your ${f.activity}`,
    body: `${f.name}'s account is under a moderation action and may not be able to take part. The activity stays as it is; you can cancel it from its page if you need to.`,
  }),
};

const BN: Record<OwnTemplates, Template> = {
  REQUEST_ACCEPTED: (_d, f) => ({ title: "আপনার অনুরোধ গ্রহণ করা হয়েছে", body: `${f.name} আপনার ${f.activity} গ্রহণ করেছেন।` }),
  SEAT_BOOKED: (_d, f) => ({ title: "নতুন সিট বুকিং", body: `${f.name} আপনার রাইডে একটি সিট বুক করেছেন।` }),
  CARPOOL_BOOKING_REQUESTED: (_d, f) => ({ title: "নতুন কারপুল সিটের অনুরোধ", body: `${f.name} আপনার কারপুলে একটি সিট চেয়েছেন।` }),
  CARPOOL_BOOKING_ACCEPTED: (_d, f) => ({
    title: "কারপুল অনুরোধ গ্রহণ করা হয়েছে",
    body: `${f.name} আপনার কারপুল সিটের অনুরোধ গ্রহণ করেছেন। চ্যাটে বিস্তারিত ঠিক করে নিন।`,
  }),
  CARPOOL_BOOKING_REJECTED: (_d, f) => ({ title: "কারপুল অনুরোধ ফিরিয়ে দেওয়া হয়েছে", body: `${f.name} আপনার কারপুল সিটের অনুরোধ ফিরিয়ে দিয়েছেন।` }),
  CARPOOL_CONTRACT_CREATED: (_d, f) => ({ title: "কারপুল চুক্তি শুরু হয়েছে", body: `${f.name}-এর সাথে আপনার কারপুল চুক্তি এখন সক্রিয়।` }),
  CARPOOL_SESSION_REMINDER: (_d, f) => ({ title: "আজ কারপুল আছে", body: `${f.name}-এর সাথে আপনার কারপুল রাইড আজ ${f.time}-এ।` }),
  ACTIVITY_REMINDER: (_d, f) => ({ title: "৩০ মিনিট পর শুরু", body: `${f.name}-এর সাথে আপনার ${f.activity} ${f.time}-এ শুরু হবে।` }),
  COMPLETION_REQUESTED: (_d, f) => ({
    title: "সম্পন্ন হয়েছে নিশ্চিত করুন",
    body: `${f.name} আপনার ${f.activity} সম্পন্ন হিসেবে চিহ্নিত করেছেন। নিশ্চিত করুন, অথবা কোনো সমস্যা হলে বিরোধ জানান। ২৪ ঘণ্টা পর এটি নিজে থেকেই সম্পন্ন হবে।`,
  }),
  AUTO_COMPLETED: (_d, f) => ({
    title: "নিজে থেকেই সম্পন্ন হয়েছে",
    body: `${f.name}-এর সাথে আপনার ${f.activity} ২৪ ঘণ্টা পর নিজে থেকেই সম্পন্ন হয়েছে।`,
  }),
  AUTO_CLOSED_NOT_MARKED: (_d, f) => ({
    title: "চিহ্নিত না হওয়ায় বন্ধ হয়েছে",
    body: `শুরুর সময়ের ৬ ঘণ্টার মধ্যে কেউ শুরু চিহ্নিত না করায় ${f.name}-এর সাথে আপনার ${f.activity} বন্ধ করা হয়েছে।`,
  }),
  ACTIVITY_CANCELLED: (d, f) => ({
    title: "অ্যাক্টিভিটি বাতিল হয়েছে",
    body:
      d.kind === "HOLD_EXPIRED"
        ? `সময়মতো চুক্তি না হওয়ায় ${f.name}-এর সাথে আপনার রাখা কারপুল সিটটি ছেড়ে দেওয়া হয়েছে।`
        : d.kind === "UNIGO"
          ? `${f.name}-এর সাথে আপনার ${f.activity} UniGo বাতিল করেছে।`
          : `${f.name} আপনার ${f.activity} বাতিল করেছেন।`,
  }),
  DISPUTE_OPENED: (_d, f) => ({
    title: "বিরোধ খোলা হয়েছে",
    body: `${f.name}-এর সাথে আপনার ${f.activity} নিয়ে একটি বিরোধ খোলা হয়েছে। একজন অ্যাডমিন এটি পর্যালোচনা করবেন।`,
  }),
  DISPUTE_UPDATED: (_d, f) => ({ title: "বিরোধের আপডেট", body: `আপনার ${f.activity} নিয়ে বিরোধে নতুন আপডেট আছে।` }),
  DISPUTE_RESOLVED: (d, f) => ({
    title: "বিরোধের নিষ্পত্তি হয়েছে",
    body: `${f.name}-এর সাথে আপনার ${f.activity} নিয়ে বিরোধের নিষ্পত্তি হয়েছে। অ্যাক্টিভিটিটি এখন ${d.kind === "CANCELLED" ? "বাতিল" : "সম্পন্ন"}।`,
  }),
  NEW_CHAT_MESSAGE: (d, f) => ({
    title: `${f.name}-এর কাছ থেকে নতুন মেসেজ`,
    body: (d.count ?? 1) > 1 ? `${f.count}টি নতুন মেসেজ` : "পড়তে চ্যাটটি খুলুন।",
  }),
  SUB_AREA_NEW_REQUEST: (d, f) => ({
    title: `${d.subAreaName ?? ""}-এ নতুন অনুরোধ`,
    body: `আপনার সাব-এরিয়া ${d.subAreaName ?? ""}-এ একটি নতুন ${f.activity} পোস্ট করা হয়েছে।`,
  }),
  STUDENT_VERIFICATION_RESULT: (d) =>
    d.kind === "REJECTED"
      ? { title: "শিক্ষার্থী যাচাই অনুমোদিত হয়নি", body: "আপনার স্টুডেন্ট আইডি কার্ড আমরা অনুমোদন করতে পারিনি। আবার চেষ্টা করতে যাচাই পেজ খুলুন।" }
      : { title: "শিক্ষার্থী যাচাই অনুমোদিত হয়েছে", body: "আপনি এখন যাচাইকৃত শিক্ষার্থী এবং UniGo-র সব সার্ভিস ব্যবহার করতে পারবেন।" },
  REQUEST_EXPIRED: (_d, f) => ({ title: "অনুরোধের মেয়াদ শেষ", body: `শুরুর সময়ের আগে কেউ আপনার ${f.activity} গ্রহণ করেননি।` }),
  CARPOOL_PAYMENT_DUE: (_d, f) => ({ title: "কারপুল পেমেন্ট বাকি", body: `${f.name}-কে এই মাসের কারপুল পেমেন্ট দেওয়ার সময় হয়েছে।` }),
  REPORT_UPDATE: () => ({ title: "রিপোর্টের আপডেট", body: "আপনার রিপোর্টে নতুন আপডেট আছে।" }),
  SUPPORT_UPDATE: () => ({ title: "সাপোর্টের আপডেট", body: "আপনার সাপোর্ট অনুরোধে নতুন আপডেট আছে।" }),
  ANNOUNCEMENT: (d) => ({ title: d.title ?? "UniGo", body: d.body ?? "" }),
  PASSWORD_RESET_REQUESTED: () => ({ title: "আপনার UniGo পাসওয়ার্ড রিসেট করুন", body: "পাসওয়ার্ড রিসেটের লিংক আপনার ইমেইলে পাঠানো হয়েছে।" }),
  PASSWORD_CHANGED: () => ({ title: "আপনার UniGo পাসওয়ার্ড পরিবর্তন করা হয়েছে", body: "আপনার পাসওয়ার্ড পরিবর্তন করা হয়েছে।" }),
  LICENCE_EXPIRY_REMINDER: (_d, f) => ({
    title: "আপনার ড্রাইভিং লাইসেন্সের মেয়াদ শীঘ্রই শেষ হবে",
    body: `আপনার ড্রাইভিং লাইসেন্সের মেয়াদ ${f.date} তারিখে শেষ হবে (${f.days} দিন বাকি)। চালানো চালিয়ে যেতে Drive with UniGo থেকে নবায়ন করা লাইসেন্স দিয়ে পুনঃযাচাই পাঠান।`,
  }),
  PARTICIPANT_ACCOUNT_LOCKED: (_d, f) => ({
    title: `আপনার ${f.activity} সম্পর্কে আপডেট`,
    body: `${f.name}-এর অ্যাকাউন্টের ওপর মডারেশন ব্যবস্থা চলছে, তাই তিনি হয়তো অংশ নিতে পারবেন না। অ্যাক্টিভিটিটি যেমন আছে তেমনই থাকবে; প্রয়োজনে এর পেজ থেকে বাতিল করতে পারেন।`,
  }),
};

export const TEMPLATES: Record<Language, Record<OwnTemplates, Template>> = { EN, BN };

const RIDER_RESULT_KINDS = ["APPROVED", "REJECTED"] as const;
const RIDER_ACCESS_KINDS = ["SUSPENDED", "REINSTATED", "SUSPENSION_ENDED", "LICENCE_EXPIRED"] as const;
const ACCOUNT_KINDS = ["WARN", "RESTRICT", "SUSPEND", "BAN", "UNBAN", "REACTIVATE", "SUSPENSION_ENDED", "RESTRICTION_ENDED"] as const;

const date = (value: string | undefined) => (value ? new Date(value) : null);
const pick = <T extends string>(allowed: readonly T[], value: string | undefined, fallback: T) =>
  (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;

function format(language: Language, d: NotificationData): Format {
  return {
    activity: d.activityType ? ACTIVITY_LABELS[language][d.activityType] : language === "BN" ? "অ্যাক্টিভিটি" : "activity",
    time: d.startTime ? formatDhakaDateTime(new Date(d.startTime), language) : "",
    // A user who left no name is still shown as someone
    name: d.name?.trim() || (language === "BN" ? "অন্য ব্যবহারকারী" : "The other user"),
    count: numbers[language].format(d.count ?? 1),
    days: numbers[language].format(d.days ?? 0),
    date: d.expiresOn ? formatDhakaDate(d.expiresOn, language) : "",
  };
}

function formatDhakaDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "BN" ? "bn-BD" : "en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Title and body for the Notifications page and push.
export function renderText(type: NotificationType, data: NotificationData, language: Language): Text {
  const d = data ?? {};
  switch (type) {
    case "ACCOUNT_STATUS_CHANGED":
      return accountStatusText(language, pick(ACCOUNT_KINDS, d.kind, "WARN") as AccountEmailKind, {
        startsAt: date(d.startsAt),
        endsAt: date(d.endsAt),
      });
    case "RIDER_VERIFICATION_RESULT":
      return riderText(language, pick(RIDER_RESULT_KINDS, d.kind, "APPROVED"), { reverification: d.reverification });
    case "RIDER_ACCESS_CHANGED":
      return riderText(language, pick(RIDER_ACCESS_KINDS, d.kind, "SUSPENDED") as RiderEmailKind, { until: date(d.endsAt) });
    default:
      return TEMPLATES[language][type](d, format(language, d));
  }
}

// The email for a notification. `name` is the recipient's own name, read when
// the email is sent. Account emails keep their A4-B1 templates; activity
// emails get the notification text, a link and how to turn them off.
export function renderEmail(type: NotificationType, data: NotificationData, language: Language, name: string, link: string): Email {
  const d = data ?? {};
  switch (type) {
    case "ACCOUNT_STATUS_CHANGED":
      return accountStatusEmail(language, pick(ACCOUNT_KINDS, d.kind, "WARN") as AccountEmailKind, {
        name,
        reason: d.reason,
        startsAt: date(d.startsAt),
        endsAt: date(d.endsAt),
      });
    case "RIDER_VERIFICATION_RESULT":
      return riderEmail(language, pick(RIDER_RESULT_KINDS, d.kind, "APPROVED"), { name, reason: d.reason, reverification: d.reverification });
    case "RIDER_ACCESS_CHANGED":
      return riderEmail(language, pick(RIDER_ACCESS_KINDS, d.kind, "SUSPENDED") as RiderEmailKind, {
        name,
        reason: d.reason,
        until: date(d.endsAt),
      });
    case "STUDENT_VERIFICATION_RESULT":
      return d.kind === "REJECTED"
        ? studentVerificationRejectedEmail(language, { name, reason: d.reason ?? "" })
        : studentVerificationApprovedEmail(language, { name });
    case "PASSWORD_CHANGED":
      return passwordChangedEmail(language, { name });
    default:
      return genericEmail(type, d, language, name, link);
  }
}

const EMAIL_COPY = {
  EN: {
    greeting: (name: string) => `Hi ${name},`,
    open: "Open UniGo",
    activityFooter: "You get these emails about your activities. Turn them off in UniGo under Account › Notifications.",
  },
  BN: {
    greeting: (name: string) => `প্রিয় ${name},`,
    open: "UniGo খুলুন",
    activityFooter: "আপনার অ্যাক্টিভিটি নিয়ে এই ইমেইলগুলো পাঠানো হয়। UniGo-র অ্যাকাউন্ট › নোটিফিকেশন থেকে এগুলো বন্ধ করতে পারেন।",
  },
};

function genericEmail(type: NotificationType, d: NotificationData, language: Language, name: string, link: string): Email {
  const t = EMAIL_COPY[language];
  const text = renderText(type, d, language);
  const url = `${env.CLIENT_URL}${link}`;
  const footer = CATALOGUE[type].email === "ACTIVITY" ? t.activityFooter : null;
  return {
    subject: text.title,
    text: [t.greeting(name), "", text.body, "", `${t.open}: ${url}`, ...(footer ? ["", footer] : [])].join("\n"),
    html: layout(
      language,
      [
        paragraph(t.greeting(escapeHtml(name))),
        paragraph(escapeHtml(text.body)),
        paragraph(`<a href="${escapeHtml(url)}">${t.open}</a>`),
        footer ? paragraph(`<small>${footer}</small>`) : "",
      ].join(""),
    ),
  };
}

// Push text is kept short; the notification opens the page with the details.
export function renderPush(type: NotificationType, data: NotificationData, language: Language, maxLength: number): Text {
  const text = renderText(type, data, language);
  return { title: clip(text.title, maxLength), body: clip(text.body, maxLength * 2) };
}
