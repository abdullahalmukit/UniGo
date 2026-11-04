import type { Request } from "express";
import { ipKeyGenerator, MemoryStore, rateLimit } from "express-rate-limit";
import { rules } from "../config/rules.js";
import { AppError } from "../utils/app-error.js";

// In-memory counters for now; they move to Redis with the job system in B2.
const stores: MemoryStore[] = [];

function limiter(window: number, max: number, keyGenerator?: (req: Request) => string) {
  const store = new MemoryStore();
  stores.push(store);

  return rateLimit({
    windowMs: window,
    limit: max,
    store,
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many attempts. Try again later.")),
  });
}

const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "");
const bodyEmail = (req: Request) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "");
const { login, register, refresh, forgotPasswordPerIp, resetPassword, google } = rules.auth.rateLimits;
const HOUR = 60 * 60 * 1000;

export const loginRateLimit = limiter(login.window, login.max, (req) => `${ipKey(req)}:${bodyEmail(req)}`);
export const registerRateLimit = limiter(register.window, register.max, ipKey);
export const refreshRateLimit = limiter(refresh.window, refresh.max, ipKey);
// Counted for every email address, registered or not, so a 429 reveals nothing.
export const forgotPasswordEmailRateLimit = limiter(HOUR, rules.passwordReset.maxRequestsPerHour, bodyEmail);
export const forgotPasswordIpRateLimit = limiter(forgotPasswordPerIp.window, forgotPasswordPerIp.max, ipKey);
export const resetPasswordRateLimit = limiter(resetPassword.window, resetPassword.max, ipKey);
export const googleRateLimit = limiter(google.window, google.max, ipKey);

// A6: student verification. These run after `authenticate`, so they count per
// account; sending a code is also counted per IP.
const userKey = (req: Request) => (req.user ? `user:${req.user.id}` : ipKey(req));
const verificationLimits = rules.studentVerification.rateLimits;
export const sendOtpUserRateLimit = limiter(verificationLimits.sendOtpPerUser.window, verificationLimits.sendOtpPerUser.max, userKey);
export const sendOtpIpRateLimit = limiter(verificationLimits.sendOtpPerIp.window, verificationLimits.sendOtpPerIp.max, ipKey);
export const checkOtpRateLimit = limiter(verificationLimits.checkOtpPerUser.window, verificationLimits.checkOtpPerUser.max, userKey);
export const idCardUploadRateLimit = limiter(
  verificationLimits.idCardUploadPerUser.window,
  verificationLimits.idCardUploadPerUser.max,
  userKey,
);

// Lets each test start with empty counters.
export function resetRateLimits() {
  for (const store of stores) store.resetAll();
}
