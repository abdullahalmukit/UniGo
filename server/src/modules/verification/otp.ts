import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { rules } from "../../config/rules.js";

const { otpLength } = rules.studentVerification;

// A random 6-digit code, zero-padded.
export function generateOtp() {
  return String(randomInt(0, 10 ** otpLength)).padStart(otpLength, "0");
}

// Only this keyed hash is stored. The verification id is part of the input, so
// the same code on two rows never hashes the same.
export function hashOtp(verificationId: string, code: string) {
  return createHmac("sha256", env.JWT_ACCESS_SECRET).update(`student-otp:${verificationId}:${code}`).digest("hex");
}

export function otpMatches(verificationId: string, code: string, storedHash: string) {
  const actual = Buffer.from(hashOtp(verificationId, code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// "Student@Mail.DIU.edu.bd" -> "mail.diu.edu.bd". Emails are already lower-cased
// by validation.
export function emailDomain(email: string) {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}
