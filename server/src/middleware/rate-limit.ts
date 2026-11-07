import type { Request } from "express";
import { ipKeyGenerator, MemoryStore, rateLimit } from "express-rate-limit";
import { rules } from "../config/rules.js";
import { AppError } from "../utils/app-error.js";

// In-memory counters (B2b decision 7): one API process, so they need no Redis.
// They start again from zero when the server restarts; revisit in B10.
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

// A7: the user's own password, per account (after `authenticate`).
export const changePasswordRateLimit = limiter(
  rules.profile.changePasswordPerUser.window,
  rules.profile.changePasswordPerUser.max,
  userKey,
);
// A Google-only account's "set a password" link: the Forgot password limit, per account.
export const passwordSetupLinkRateLimit = limiter(HOUR, rules.passwordReset.maxRequestsPerHour, userKey);

// B1: rider applications, per account.
export const riderApplicationRateLimit = limiter(
  rules.rider.applicationsPerUser.window,
  rules.rider.applicationsPerUser.max,
  userKey,
);

// B2b: reports, per account.
export const reportRateLimit = limiter(rules.reports.perUser.window, rules.reports.perUser.max, userKey);

// B3a: place search through the server, and the suggested fare (public OSRM)
export const geoRateLimit = limiter(rules.geo.perUser.window, rules.geo.perUser.max, userKey);
export const fareEstimateRateLimit = limiter(rules.ride.fareEstimate.perUser.window, rules.ride.fareEstimate.perUser.max, userKey);

// B2c: saving this device's push subscription
export const pushSubscribeRateLimit = limiter(
  rules.notifications.subscribePerUser.window,
  rules.notifications.subscribePerUser.max,
  userKey,
);

// B2b: chat messages, per user, shared by REST and Socket.IO (so it is not an
// express middleware). A sliding window: at most `max` sends in any `window`.
const chatSends = new Map<string, number[]>();

export function consumeChatSend(userId: string, now = Date.now()) {
  const { maxChatMessagesPerMinute: max } = rules.limits;
  const window = rules.chat.rateWindow;
  const recent = (chatSends.get(userId) ?? []).filter((at) => at > now - window);
  if (recent.length >= max) {
    chatSends.set(userId, recent);
    throw new AppError(429, "RATE_LIMITED", "You are sending messages too fast. Wait a moment.");
  }
  recent.push(now);
  chatSends.set(userId, recent);
}

// Lets each test start with empty counters.
export function resetRateLimits() {
  for (const store of stores) store.resetAll();
  chatSends.clear();
}
