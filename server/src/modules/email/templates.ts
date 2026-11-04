// Email texts in Bangla and English, picked by users.language.
// The Bangla wording is waiting for the developer's review (A4).
import type { Language } from "../../generated/prisma/client.js";

type Email = { subject: string; text: string; html: string };

const numbers = { BN: new Intl.NumberFormat("bn-BD"), EN: new Intl.NumberFormat("en") };

const copy = {
  passwordReset: {
    EN: {
      subject: "Reset your UniGo password",
      greeting: (name: string) => `Hi ${name},`,
      intro: "We received a request to reset your UniGo password. Open this link to choose a new password:",
      button: "Choose a new password",
      expiry: (minutes: string) => `The link works once and expires in ${minutes} minutes.`,
      ignore: "If you did not ask for this, you can ignore this email. Your password will not change.",
    },
    BN: {
      subject: "আপনার UniGo পাসওয়ার্ড রিসেট করুন",
      greeting: (name: string) => `প্রিয় ${name},`,
      intro: "আপনার UniGo পাসওয়ার্ড রিসেট করার একটি অনুরোধ আমরা পেয়েছি। নতুন পাসওয়ার্ড দিতে এই লিংকটি খুলুন:",
      button: "নতুন পাসওয়ার্ড দিন",
      expiry: (minutes: string) => `লিংকটি একবারই ব্যবহার করা যাবে এবং ${minutes} মিনিট পর এর মেয়াদ শেষ হবে।`,
      ignore: "আপনি এই অনুরোধ না করে থাকলে ইমেইলটি উপেক্ষা করুন। আপনার পাসওয়ার্ড বদলাবে না।",
    },
  },
  passwordChanged: {
    EN: {
      subject: "Your UniGo password was changed",
      greeting: (name: string) => `Hi ${name},`,
      body: "Your UniGo password was just changed, and you have been logged out on all devices. Log in again with your new password.",
      warning:
        "If you did not do this, reset your password straight away with “Forgot password?” on the login page, and contact UniGo support.",
    },
    BN: {
      subject: "আপনার UniGo পাসওয়ার্ড পরিবর্তন করা হয়েছে",
      greeting: (name: string) => `প্রিয় ${name},`,
      body: "আপনার UniGo পাসওয়ার্ড এইমাত্র পরিবর্তন করা হয়েছে এবং সব ডিভাইস থেকে আপনাকে লগ আউট করা হয়েছে। নতুন পাসওয়ার্ড দিয়ে আবার লগ ইন করুন।",
      warning:
        "এটি আপনি না করে থাকলে এখনই লগইন পেজের “পাসওয়ার্ড ভুলে গেছেন?” দিয়ে পাসওয়ার্ড রিসেট করুন এবং UniGo সাপোর্টে যোগাযোগ করুন।",
    },
  },
};

export function passwordResetEmail(language: Language, data: { name: string; resetUrl: string; minutes: number }): Email {
  const t = copy.passwordReset[language];
  const minutes = numbers[language].format(data.minutes);

  return {
    subject: t.subject,
    text: [t.greeting(data.name), "", t.intro, data.resetUrl, "", t.expiry(minutes), t.ignore].join("\n"),
    html: layout(
      language,
      [
        paragraph(t.greeting(escapeHtml(data.name))),
        paragraph(t.intro),
        `<p><a href="${escapeHtml(data.resetUrl)}">${t.button}</a></p>`,
        paragraph(t.expiry(minutes)),
        paragraph(t.ignore),
      ].join(""),
    ),
  };
}

export function passwordChangedEmail(language: Language, data: { name: string }): Email {
  const t = copy.passwordChanged[language];

  return {
    subject: t.subject,
    text: [t.greeting(data.name), "", t.body, "", t.warning].join("\n"),
    html: layout(language, [paragraph(t.greeting(escapeHtml(data.name))), paragraph(t.body), paragraph(t.warning)].join("")),
  };
}

function layout(language: Language, body: string) {
  return `<!doctype html><html lang="${language === "BN" ? "bn" : "en"}"><body style="font-family:Inter,'Hind Siliguri',Arial,sans-serif;line-height:1.5">${body}</body></html>`;
}

function paragraph(text: string) {
  return `<p>${text}</p>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
