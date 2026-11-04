// Account status emails (proposal sections 14 and 17.1): the user is told about
// every warning and status change, with the reason and dates in Asia/Dhaka.
import type { Language } from "../../generated/prisma/client.js";
import { formatDhakaDateTime } from "../../utils/time.js";
import { escapeHtml, layout, paragraph, type Email } from "./templates.js";

export type AccountEmailKind =
  | "WARN"
  | "RESTRICT"
  | "SUSPEND"
  | "BAN"
  | "UNBAN"
  | "REACTIVATE"
  | "SUSPENSION_ENDED"
  | "RESTRICTION_ENDED";

type Data = { name: string; reason?: string; startsAt?: Date | null; endsAt?: Date | null };
type Dates = { from: string; until: string };

const copy: Record<Language, { greeting: (name: string) => string; reason: string; support: string } & Record<
  AccountEmailKind,
  { subject: string; body: (dates: Partial<Dates>) => string }
>> = {
  EN: {
    greeting: (name) => `Hi ${name},`,
    reason: "Reason:",
    support: "If you think this is a mistake, contact UniGo support.",
    WARN: { subject: "A warning on your UniGo account", body: () => "Your UniGo account has received a warning for breaking UniGo's rules." },
    RESTRICT: {
      subject: "Your UniGo account is restricted",
      body: ({ until }) =>
        `You cannot create or accept new activities ${until ? `until ${until}` : "until an admin lifts the restriction"}. You can still use the rest of UniGo.`,
    },
    SUSPEND: {
      subject: "Your UniGo account is suspended",
      body: ({ from, until }) => `Your UniGo account is suspended from ${from} until ${until}. You cannot use UniGo during this time.`,
    },
    BAN: { subject: "Your UniGo account is banned", body: () => "Your UniGo account has been banned and can no longer be used." },
    UNBAN: { subject: "Your UniGo account is active again", body: () => "Your UniGo account has been unbanned. You can log in and use UniGo again." },
    REACTIVATE: {
      subject: "Your UniGo account is active again",
      body: () => "An admin has lifted the restriction or suspension on your UniGo account. You can use UniGo normally again.",
    },
    SUSPENSION_ENDED: {
      subject: "Your UniGo suspension has ended",
      body: () => "Your suspension has ended and your UniGo account is active again.",
    },
    RESTRICTION_ENDED: {
      subject: "Your UniGo restriction has ended",
      body: () => "Your restriction has ended. You can create and accept activities again.",
    },
  },
  BN: {
    greeting: (name) => `প্রিয় ${name},`,
    reason: "কারণ:",
    support: "এটি ভুল মনে হলে UniGo সাপোর্টে যোগাযোগ করুন।",
    WARN: { subject: "আপনার UniGo অ্যাকাউন্টে একটি সতর্কতা", body: () => "UniGo-র নিয়ম না মানার জন্য আপনার অ্যাকাউন্টে একটি সতর্কতা দেওয়া হয়েছে।" },
    RESTRICT: {
      subject: "আপনার UniGo অ্যাকাউন্ট সীমিত করা হয়েছে",
      body: ({ until }) =>
        `${until ? `${until} পর্যন্ত` : "অ্যাডমিন সীমাবদ্ধতা তুলে না নেওয়া পর্যন্ত"} আপনি নতুন অ্যাক্টিভিটি তৈরি বা গ্রহণ করতে পারবেন না। UniGo-র বাকি সব কিছু ব্যবহার করতে পারবেন।`,
    },
    SUSPEND: {
      subject: "আপনার UniGo অ্যাকাউন্ট স্থগিত করা হয়েছে",
      body: ({ from, until }) => `আপনার UniGo অ্যাকাউন্ট ${from} থেকে ${until} পর্যন্ত স্থগিত। এই সময়ে আপনি UniGo ব্যবহার করতে পারবেন না।`,
    },
    BAN: { subject: "আপনার UniGo অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে", body: () => "আপনার UniGo অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে এবং আর ব্যবহার করা যাবে না।" },
    UNBAN: {
      subject: "আপনার UniGo অ্যাকাউন্ট আবার সক্রিয়",
      body: () => "আপনার UniGo অ্যাকাউন্টের নিষেধাজ্ঞা তুলে নেওয়া হয়েছে। আবার লগ ইন করে UniGo ব্যবহার করতে পারবেন।",
    },
    REACTIVATE: {
      subject: "আপনার UniGo অ্যাকাউন্ট আবার সক্রিয়",
      body: () => "একজন অ্যাডমিন আপনার অ্যাকাউন্টের সীমাবদ্ধতা বা স্থগিতাদেশ তুলে নিয়েছেন। আপনি আবার স্বাভাবিকভাবে UniGo ব্যবহার করতে পারবেন।",
    },
    SUSPENSION_ENDED: {
      subject: "আপনার UniGo স্থগিতাদেশ শেষ হয়েছে",
      body: () => "আপনার স্থগিতাদেশের মেয়াদ শেষ হয়েছে এবং আপনার UniGo অ্যাকাউন্ট আবার সক্রিয়।",
    },
    RESTRICTION_ENDED: {
      subject: "আপনার UniGo সীমাবদ্ধতা শেষ হয়েছে",
      body: () => "আপনার সীমাবদ্ধতার মেয়াদ শেষ হয়েছে। আপনি আবার অ্যাক্টিভিটি তৈরি ও গ্রহণ করতে পারবেন।",
    },
  },
};

export function accountStatusEmail(language: Language, kind: AccountEmailKind, data: Data): Email {
  const t = copy[language];
  const dates = {
    from: data.startsAt ? formatDhakaDateTime(data.startsAt, language) : undefined,
    until: data.endsAt ? formatDhakaDateTime(data.endsAt, language) : undefined,
  };
  const body = t[kind].body(dates);
  const showSupport = kind !== "UNBAN" && kind !== "REACTIVATE" && !kind.endsWith("_ENDED");
  const lines = [t.greeting(data.name), "", body];
  if (data.reason) lines.push(`${t.reason} ${data.reason}`);
  if (showSupport) lines.push("", t.support);

  return {
    subject: t[kind].subject,
    text: lines.join("\n"),
    html: layout(
      language,
      [
        paragraph(t.greeting(escapeHtml(data.name))),
        paragraph(escapeHtml(body)),
        data.reason ? paragraph(`<strong>${t.reason}</strong> ${escapeHtml(data.reason)}`) : "",
        showSupport ? paragraph(t.support) : "",
      ].join(""),
    ),
  };
}
