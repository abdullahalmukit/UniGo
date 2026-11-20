// Sends one test email with the mail settings in server/.env, to check that
// verification codes and reset links can reach a real inbox.
//   npm run email:test -w server -- someone@example.com
import { env } from "../src/config/env.js";
import { reportEmailTransport, sendEmail } from "../src/modules/email/email.service.js";

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error("Usage: npm run email:test -w server -- someone@example.com");
  process.exit(1);
}

await reportEmailTransport();
if (env.emailTransport !== "smtp") {
  console.error("EMAIL_TRANSPORT is not smtp, so nothing would be delivered. See server/.env.example.");
  process.exit(1);
}
try {
  await sendEmail({
    to,
    subject: "UniGo test email",
    text: "This is a test email from UniGo. If you can read it, verification codes will arrive too.",
    html: "<p>This is a test email from UniGo. If you can read it, verification codes will arrive too.</p>",
  });
  console.log(`Sent to ${to}. Check the inbox and the spam folder.`);
  process.exit(0);
} catch (error) {
  console.error(`Sending failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
