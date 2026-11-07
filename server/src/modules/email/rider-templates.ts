// Rider emails (proposal section 14, B1 decision 9): application approved or
// rejected, rider access suspended or reinstated. Dates in Asia/Dhaka.
import type { Language } from "../../generated/prisma/client.js";
import { formatDhakaDateTime } from "../../utils/time.js";
import { escapeHtml, layout, paragraph, type Email } from "./templates.js";

// LICENCE_EXPIRED (B2c): the licence-expiry check set the rider Inactive.
export type RiderEmailKind = "APPROVED" | "REJECTED" | "SUSPENDED" | "REINSTATED" | "SUSPENSION_ENDED" | "LICENCE_EXPIRED";

type Data = { name: string; reason?: string; until?: Date | null; reverification?: boolean };

const copy: Record<
  Language,
  { greeting: (name: string) => string; reason: string } & Record<
    RiderEmailKind,
    { subject: (data: Data) => string; body: (data: Data, until?: string) => string; next?: string }
  >
> = {
  EN: {
    greeting: (name) => `Hi ${name},`,
    reason: "Reason:",
    APPROVED: {
      subject: ({ reverification }) => (reverification ? "Your UniGo rider re-verification is approved" : "You are now a UniGo rider"),
      body: ({ reverification }) =>
        reverification
          ? "Your renewed licence and vehicle details are approved."
          : "Your rider application is approved. Open Drive with UniGo and switch to Active when you are ready to drive.",
    },
    REJECTED: {
      subject: () => "Your UniGo rider application was not approved",
      body: () => "Your rider application was not approved.",
      next: "Open Drive with UniGo to fix the details and apply again.",
    },
    SUSPENDED: {
      subject: () => "Your UniGo rider access is suspended",
      body: (_data, until) =>
        `Your rider access is suspended ${until ? `until ${until}` : "until an admin reinstates it"}. You cannot offer rides or accept passenger requests during this time. You can still use UniGo as a passenger.`,
    },
    REINSTATED: {
      subject: () => "Your UniGo rider access is back",
      body: () => "An admin has reinstated your rider access. You can switch to Active again.",
    },
    SUSPENSION_ENDED: {
      subject: () => "Your UniGo rider suspension has ended",
      body: () => "Your rider suspension has ended. You can switch to Active again.",
    },
    LICENCE_EXPIRED: {
      subject: () => "Your UniGo rider status is Inactive: licence expired",
      body: () =>
        "Your driving licence has expired, so your rider status was set to Inactive. Send a re-verification with your renewed licence from Drive with UniGo to drive again.",
    },
  },
  BN: {
    greeting: (name) => `প্রিয় ${name},`,
    reason: "কারণ:",
    APPROVED: {
      subject: ({ reverification }) => (reverification ? "আপনার UniGo রাইডার পুনঃযাচাই অনুমোদিত হয়েছে" : "আপনি এখন একজন UniGo রাইডার"),
      body: ({ reverification }) =>
        reverification
          ? "আপনার নবায়ন করা লাইসেন্স ও যানবাহনের তথ্য অনুমোদিত হয়েছে।"
          : "আপনার রাইডার আবেদন অনুমোদিত হয়েছে। চালাতে প্রস্তুত হলে Drive with UniGo খুলে Active চালু করুন।",
    },
    REJECTED: {
      subject: () => "আপনার UniGo রাইডার আবেদন অনুমোদিত হয়নি",
      body: () => "আপনার রাইডার আবেদন অনুমোদিত হয়নি।",
      next: "Drive with UniGo খুলে তথ্য ঠিক করে আবার আবেদন করুন।",
    },
    SUSPENDED: {
      subject: () => "আপনার UniGo রাইডার সুবিধা স্থগিত করা হয়েছে",
      body: (_data, until) =>
        `${until ? `${until} পর্যন্ত` : "অ্যাডমিন আবার চালু না করা পর্যন্ত"} আপনার রাইডার সুবিধা স্থগিত। এই সময়ে আপনি রাইড অফার বা যাত্রীর অনুরোধ গ্রহণ করতে পারবেন না। যাত্রী হিসেবে UniGo ব্যবহার করতে পারবেন।`,
    },
    REINSTATED: {
      subject: () => "আপনার UniGo রাইডার সুবিধা আবার চালু হয়েছে",
      body: () => "একজন অ্যাডমিন আপনার রাইডার সুবিধা আবার চালু করেছেন। আপনি আবার Active চালু করতে পারবেন।",
    },
    SUSPENSION_ENDED: {
      subject: () => "আপনার UniGo রাইডার স্থগিতাদেশ শেষ হয়েছে",
      body: () => "আপনার রাইডার স্থগিতাদেশের মেয়াদ শেষ হয়েছে। আপনি আবার Active চালু করতে পারবেন।",
    },
    LICENCE_EXPIRED: {
      subject: () => "আপনার UniGo রাইডার স্ট্যাটাস Inactive: লাইসেন্সের মেয়াদ শেষ",
      body: () =>
        "আপনার ড্রাইভিং লাইসেন্সের মেয়াদ শেষ হয়েছে, তাই আপনার রাইডার স্ট্যাটাস Inactive করা হয়েছে। আবার চালাতে Drive with UniGo থেকে নবায়ন করা লাইসেন্স দিয়ে পুনঃযাচাই পাঠান।",
    },
  },
};

// The subject and main sentence, for in-app notifications (B2c).
export function riderText(language: Language, kind: RiderEmailKind, data: Omit<Data, "name">) {
  const item = copy[language][kind];
  const until = data.until ? formatDhakaDateTime(data.until, language) : undefined;
  return { title: item.subject({ name: "", ...data }), body: item.body({ name: "", ...data }, until) };
}

export function riderEmail(language: Language, kind: RiderEmailKind, data: Data): Email {
  const t = copy[language];
  const item = t[kind];
  const until = data.until ? formatDhakaDateTime(data.until, language) : undefined;
  const body = item.body(data, until);
  const lines = [t.greeting(data.name), "", body];
  if (data.reason) lines.push(`${t.reason} ${data.reason}`);
  if (item.next) lines.push("", item.next);

  return {
    subject: item.subject(data),
    text: lines.join("\n"),
    html: layout(
      language,
      [
        paragraph(t.greeting(escapeHtml(data.name))),
        paragraph(escapeHtml(body)),
        data.reason ? paragraph(`<strong>${t.reason}</strong> ${escapeHtml(data.reason)}`) : "",
        item.next ? paragraph(item.next) : "",
      ].join(""),
    ),
  };
}
