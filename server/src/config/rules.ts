// Every business limit lives here, so no rule is hard-coded twice.
// Source: CLAUDE.md sections 5, 6, 8 and 13, and the proposal.
// Durations are in milliseconds unless the name says otherwise.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const rules = {
  timezone: "Asia/Dhaka",

  // How far ahead an item can be scheduled when it is created
  creationWindow: {
    earliestFromNow: 15 * MINUTE,
    rideLatestFromNow: 48 * HOUR,
    foodLatestFromNow: 24 * HOUR,
    serviceLatestFromNow: 7 * DAY,
  },

  activity: {
    conflictWindow: 90 * MINUTE,
    autoCompleteAfter: 24 * HOUR,
    notMarkedAfterStart: 6 * HOUR,
    lateCancellationBeforeStart: 60 * MINUTE,
    reminderBeforeStart: 30 * MINUTE,
  },

  limits: {
    maxOpenRequestsPerUser: 3,
    maxNewRequestsPerDay: 4,
    maxChatMessagesPerMinute: 10,
  },

  seats: {
    bike: { min: 1, max: 1 },
    car: { min: 1, max: 4 },
  },

  carpool: {
    maxSchedulesPerRider: 12,
    seatHold: 24 * HOUR,
    durationMonths: [1, 2, 3, 4],
    upcomingSessionsWindow: 7 * DAY,
  },

  reviews: {
    window: 7 * DAY,
    minStars: 1,
    maxStars: 5,
  },

  uploads: {
    maxFileSizeBytes: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "application/pdf"],
  },

  passwordReset: {
    tokenLifetime: 15 * MINUTE,
    // Per email address, registered or not, so a 429 reveals nothing
    maxRequestsPerHour: 3,
  },

  google: {
    // Short-lived tokens that carry a verified Google identity to the next step
    signupTokenLifetime: 10 * MINUTE,
    linkTokenLifetime: 10 * MINUTE,
  },

  auth: {
    // 8-72 characters with at least one letter and one number (A3 decision)
    password: { minLength: 8, maxLength: 72 },
    bcryptCost: 12,
    // bcrypt's minimum, only when NODE_ENV=test, so the test suite stays fast.
    bcryptCostInTests: 4,
    // Per IP; login is per IP and email
    rateLimits: {
      login: { window: 15 * MINUTE, max: 10 },
      register: { window: HOUR, max: 5 },
      refresh: { window: 15 * MINUTE, max: 30 },
      // On top of passwordReset.maxRequestsPerHour per email
      forgotPasswordPerIp: { window: HOUR, max: 10 },
      resetPassword: { window: 15 * MINUTE, max: 10 },
      // Shared by /google, /google/register and /google/link
      google: { window: 15 * MINUTE, max: 10 },
    },
  },
} as const;
