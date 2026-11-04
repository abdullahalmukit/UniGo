import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { runInBackground } from "../../utils/background.js";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

// Emails "sent" while NODE_ENV=test, newest last.
export const sentEmails: EmailMessage[] = [];

let smtp: Transporter | undefined;

export async function sendEmail(message: EmailMessage) {
  switch (env.emailTransport) {
    case "memory":
      sentEmails.push(message);
      return;
    case "console":
      // Development only: the whole email, reset links included, so flows can be
      // tried without a mail server (A4 decision, an exception to "never log tokens").
      console.log(
        ["", "----- Email (development) -----", `To: ${message.to}`, `Subject: ${message.subject}`, "", message.text, "-------------------------------", ""].join("\n"),
      );
      return;
    case "smtp":
      smtp ??= nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      });
      await smtp.sendMail({ from: env.MAIL_FROM, ...message });
      return;
  }
}

// Sends without holding up the response; a failure is logged without the email.
export function sendEmailInBackground(label: string, message: EmailMessage) {
  runInBackground(`email: ${label}`, () => sendEmail(message));
}
