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
    // B2a: a service request with only a preferred date starts at this time
    // (Asia/Dhaka) for expiry, NOT_MARKED and Upcoming ordering (A2 decision 8)
    dateOnlyServiceStart: { hour: 23, minute: 59 },
    // Every cancellation after acceptance needs a reason (proposal section 15.3)
    cancelReason: { minLength: 3, maxLength: 500 },
    // Accept and booking transactions are retried this many times after a
    // deadlock or lock wait timeout
    transactionAttempts: 3,
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

  // A6: student verification (proposal section 4, A6 decisions)
  studentVerification: {
    otpLength: 6,
    otpLifetime: 10 * MINUTE,
    // Wrong codes allowed per code; then a new code must be requested
    maxOtpAttempts: 5,
    // Wait between two codes for the same user
    otpResendAfter: MINUTE,
    rejectionReason: { minLength: 3, maxLength: 500 },
    // Stored on a pending ID card closed because the university email was verified
    closedByEmailReason: "Verified by university email",
    rateLimits: {
      sendOtpPerUser: { window: HOUR, max: 5 },
      sendOtpPerIp: { window: HOUR, max: 20 },
      checkOtpPerUser: { window: 15 * MINUTE, max: 10 },
      idCardUploadPerUser: { window: HOUR, max: 5 },
    },
  },

  // Private documents (ID cards, later NID and licences) are opened only
  // through short-lived signed links
  privateFiles: {
    signedUrlLifetime: 5 * MINUTE,
  },

  // A7: the user's own profile and settings (proposal section 5, A7 decisions)
  profile: {
    name: { minLength: 2, maxLength: 100 },
    // Optional fields, limited by their column sizes
    studentIdMaxLength: 50,
    departmentMaxLength: 100,
    batchMaxLength: 50,
    locationMaxLength: 255,
    photo: {
      // JPG or PNG only, at most uploads.maxFileSizeBytes; re-encoded to a
      // square JPEG, which also removes EXIF data such as GPS position
      allowedMimeTypes: ["image/jpeg", "image/png"],
      sizePx: 512,
      jpegQuality: 82,
      // Longer than documents, so a photo on screen keeps working
      signedUrlLifetime: HOUR,
    },
    changePasswordPerUser: { window: 15 * MINUTE, max: 5 },
  },

  savedAddresses: {
    maxPerUser: 10,
    // Home, Hall and Work at most once each; Custom needs its own name
    singleLabels: ["HOME", "HALL", "WORK"],
    customLabel: { minLength: 1, maxLength: 50 },
    addressMaxLength: 255,
  },

  subAreas: {
    maxPerUser: 20,
    searchResults: 50,
  },

  // B1: rider and vehicle verification (proposal section 6, B1 decisions)
  rider: {
    // Vehicles in one application, and active (pending or approved) vehicles per rider
    maxVehiclesPerApplication: 5,
    maxActiveVehicles: 5,
    // The licence expiry date must be after today (Asia/Dhaka) and at most this far ahead
    licenceMaxYearsAhead: 10,
    registrationNumber: { minLength: 5, maxLength: 30 },
    vehicleText: { brandMaxLength: 50, modelMaxLength: 50, colourMaxLength: 30 },
    // Vehicle photos are re-encoded to a JPEG at most this many pixels on the longest side
    vehiclePhoto: { allowedMimeTypes: ["image/jpeg", "image/png"], maxSidePx: 1280, jpegQuality: 82 },
    applicationsPerUser: { window: HOUR, max: 5 },
  },

  // B2b: chat (proposal section 13, B2b decisions)
  chat: {
    // rules.limits.maxChatMessagesPerMinute messages in this window, REST and socket together
    rateWindow: MINUTE,
    messageMaxLength: 1000,
    messagesPageSize: 30,
    inboxPageSize: 30,
    // Inbox preview of the last message
    previewLength: 120,
    // Food chats only: receipt and bill photos
    image: {
      allowedMimeTypes: ["image/jpeg", "image/png"],
      maxSidePx: 1600,
      jpegQuality: 82,
      signedUrlLifetime: 10 * MINUTE,
    },
    // Kept in activity_status_history only, never shown to the other user
    blockCancellationReason: "Blocked",
  },

  // B2b: reports from chat (admin review in B7)
  reports: {
    reasons: ["HARASSMENT", "INAPPROPRIATE_CONTENT", "SPAM", "SCAM_OR_FRAUD", "SAFETY_CONCERN", "FAKE_PROFILE", "OTHER"],
    descriptionMaxLength: 1000,
    perUser: { window: HOUR, max: 5 },
  },

  // B2b: Socket.IO
  socket: {
    // Served under /api so the same proxy and origin as the REST API work
    path: "/api/socket",
    // A socket whose access token expired without auth:refresh is disconnected
    // this long after the expiry
    expiryGrace: 5 * 1000,
  },

  // B3a: Ride Sharing (proposal section 8, B3a decisions)
  ride: {
    // Offered amount of a passenger request and fare per seat of an offer, in taka
    amount: { min: 10, max: 1000 },
    passengers: { min: 1, max: 4 },
    notesMaxLength: 500,
    addressMaxLength: 255,
    // Start Ride is allowed from this long before the start time (B3a Q4)
    startAllowedBefore: 30 * MINUTE,
    // Search: straight-line distance from the chosen point (B3a Q6)
    searchRadiusKm: [1, 2, 5],
    defaultSearchRadiusKm: 2,
    pageSize: 30,
    // Suggested fare: OSRM route distance x the admin rate per km
    fareEstimate: { timeout: 3000, cacheSize: 1000, cacheTtl: DAY, perUser: { window: MINUTE, max: 20 } },
    ratePerKm: { min: 1, max: 500 },
  },

  // B3a: Nominatim through the server (CLAUDE.md 9, Maps)
  geo: {
    // Nominatim's usage policy: at most one request per second, from the whole server
    minInterval: 1000,
    timeout: 5000,
    cacheSize: 2000,
    cacheTtl: DAY,
    queryMaxLength: 200,
    results: 5,
    perUser: { window: MINUTE, max: 30 },
  },

  // B2c: notifications (proposal section 14, B2c decisions)
  notifications: {
    pageSize: 20,
    // Reminder of an accepted activity, this long before its start (ride, food,
    // service with a time). Not scheduled when the activity is accepted later.
    reminderBeforeStart: 30 * MINUTE,
    // Carpool ride-day reminder: this time of day in Asia/Dhaka, or
    // carpoolReminderLeadTime before the start when that is earlier
    carpoolReminderAt: { hour: 7, minute: 0 },
    carpoolReminderLeadTime: 60 * MINUTE,
    // Licence expiry reminders, whole days before the expiry date (Asia/Dhaka)
    licenceReminderDays: [30, 7],
    licenceReminderInterval: HOUR,
    // Users notified per batch query of the sub-area engine
    subAreaBatch: 500,
    // How long a push service keeps an undelivered push (seconds)
    pushTtlSeconds: 24 * 60 * 60,
    // Push and email delivery job: attempts in total, first backoff
    delivery: { attempts: 3, backoffMs: 10 * 1000 },
    // Subscribing this device, per account
    subscribePerUser: { window: HOUR, max: 20 },
    // A push subscription endpoint and its keys
    endpointMaxLength: 512,
    keyMaxLength: 255,
    // Never shown longer than this in a push or notification
    textMaxLength: 120,
  },

  admin: {
    pageSize: 20,
    // Every warning, restriction, suspension, ban, unban and reactivation
    reason: { minLength: 3, maxLength: 500 },
    // A suspension may start this long before "now" (clock differences).
    suspensionStartTolerance: MINUTE,
  },

  jobs: {
    // How often the account-status job ends suspensions and restrictions (A8)
    accountStatusInterval: MINUTE,
    // B2a: the safety-net sweeper catches overdue expiry, NOT_MARKED,
    // auto-complete and ride offer closing if a delayed job was lost
    sweepInterval: MINUTE,
    // Items handled per kind in one sweep; the next sweep takes the rest
    sweepBatch: 100,
    // A failed job is tried this many times in total, then removed (the sweeper
    // catches anything it left)
    attempts: 3,
    workerConcurrency: 5,
    // B2b decision 1: a request never waits longer than this for Redis when
    // it queues or removes a job after its commit
    queueTimeout: 2000,
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
