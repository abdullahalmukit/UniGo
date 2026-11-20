import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env.js";
import { runInBackground } from "../../utils/background.js";

export type EmailMessage = { to: string; subject: string; text: string; html: string };

// Emails "sent" while NODE_ENV=test, newest last.
export const sentEmails: EmailMessage[] = [];

// Tests: the next emails fail as if the mail server refused them.
let failuresForTests = 0;
export function failNextEmailsForTests(count = 1) {
  failuresForTests = count;
}

let smtp: Transporter | undefined;

function smtpTransport() {
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : env.SMTP_PORT === 465;
  smtp ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    // Port 587 and similar: upgrade to TLS or refuse to send.
    requireTLS: !secure,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    // A mail server that never answers must not hold a request for minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return smtp;
}

export async function sendEmail(message: EmailMessage) {
  switch (env.emailTransport) {
    case "memory":
      if (failuresForTests > 0) {
        failuresForTests -= 1;
        throw new Error("Test mail server refused the email");
      }
      sentEmails.push(message);
      return;
    case "console":
      // Development only: the whole email, reset links included, so flows can be
      // tried without a mail server (A4 decision, an exception to "never log tokens").
      // Nothing reaches a real inbox: set EMAIL_TRANSPORT=smtp for that.
      console.log(
        [
          "",
          "----- Email (development, NOT delivered: EMAIL_TRANSPORT=console) -----",
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          "",
          message.text,
          "-------------------------------",
          "",
        ].join("\n"),
      );
      return;
    case "smtp":
      await smtpTransport().sendMail({ from: env.MAIL_FROM, ...message });
      return;
  }
}

// Sends without holding up the response; a failure is logged without the email.
export function sendEmailInBackground(label: string, message: EmailMessage) {
  runInBackground(`email: ${label}`, () => sendEmail(message));
}

// Checks the mail settings when the server starts and says plainly whether
// email reaches real inboxes. Never prints the password.
export async function reportEmailTransport(log: (line: string) => void = console.log) {
  if (env.emailTransport === "memory") return;
  if (env.emailTransport === "console") {
    log(
      "Email: EMAIL_TRANSPORT=console, so emails (verification codes, reset links) are only printed here and never reach an inbox. " +
        "Set EMAIL_TRANSPORT=smtp and the SMTP_* values in server/.env to deliver them.",
    );
    return;
  }
  try {
    await smtpTransport().verify();
    log(`Email: SMTP ready (${env.SMTP_HOST}:${env.SMTP_PORT}, from ${env.MAIL_FROM}).`);
  } catch (error) {
    log(`Email: SMTP check FAILED for ${env.SMTP_HOST}:${env.SMTP_PORT}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
