# CLAUDE.md — UniGo

This file guides Claude Code when working in this repository.
The full product specification is **`docs/UniGo-Proposal-v1.1.md`** (exported from the proposal doc). It is the single source of truth. If this file and the proposal ever disagree, the proposal wins — stop and ask before guessing.

> **Rule zero:** implement the specification as written. Do not change, simplify or "improve" a business rule (limits, timings, statuses, permissions) without the developer's explicit approval. If a rule is unclear, ask.

---

## 1. Project summary

UniGo is a university-only, peer-to-peer **Progressive Web App** for verified students from multiple universities. It has four services:

| Service | Short description |
| --- | --- |
| Ride Sharing | Passenger requests (one-to-one) and rider ride offers (seat-based) |
| Carpool | Recurring weekly rides; one post per schedule, one contract per passenger |
| Food Delivery | A student buys and brings food for another student |
| Uni Service | Help with daily tasks in 7 fixed categories |

Every person is a **User**. Admin-verified users become **Riders** and can also drive. A Rider can be a passenger in another activity. UniGo **never processes payments** in v1 — it only records amounts and methods.

---

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React, responsive, mobile-first, PWA (installable, Web Push) |
| i18n | Bangla + English (react-i18next) |
| Theme | Light, Dark, System |
| Maps | OpenStreetMap + Leaflet; Nominatim search (debounced, cached); OSRM for route distance |
| Backend | Node.js + Express, REST API |
| Database | MySQL + Prisma ORM |
| Auth | JWT access + refresh tokens, email/password + Google sign-in |
| Real-time | Socket.IO (chat, live notifications) |
| Jobs | BullMQ + Redis (node-cron only for an early prototype) |
| Email | SMTP / transactional service (OTP, password reset, fallback notifications) |
| Files | Private storage + signed URLs for verification documents; public storage for spotlight media |
| AI (later) | Separate Python service with scikit-learn |

---

## 3. Repository layout (target)

```
unigo/
├── CLAUDE.md
├── docs/
│   └── UniGo-Proposal-v1.1.md        # full spec — read the relevant section before coding a feature
├── client/                           # React PWA
│   ├── public/                       # manifest, service worker, icons
│   └── src/
│       ├── app/                      # router, providers (auth, theme, i18n, socket)
│       ├── components/               # shared UI: cards, chips, bottom sheets, toasts
│       ├── features/
│       │   ├── auth/  profile/  verification/  rider/
│       │   ├── ride/  carpool/  food/  service/
│       │   ├── activity/  upcoming/  inbox/  notifications/
│       │   └── admin/
│       ├── i18n/                     # bn.json, en.json
│       ├── lib/                      # api client, socket client, date utils (Asia/Dhaka)
│       └── styles/                   # theme tokens (light + dark)
├── server/
│   ├── prisma/                       # schema.prisma, migrations, seed
│   └── src/
│       ├── config/
│       ├── middleware/               # auth, roles, verification, account status, rate limits, uploads
│       ├── modules/                  # one folder per domain: routes, controller, service, validation
│       │   ├── auth/  users/  universities/  verification/  riders/  vehicles/
│       │   ├── activities/           # COMMON engine: statuses, completion, conflicts, cancellation
│       │   ├── ride/  carpool/  food/  service/
│       │   ├── chat/  notifications/  reviews/  disputes/  reports/  payments/
│       │   ├── subareas/  content/   # promos, spotlight, banners, fare settings
│       │   └── admin/                # dashboard, moderation, audit log
│       ├── jobs/                     # BullMQ queues + workers
│       ├── sockets/
│       └── utils/
└── ai/                               # B9 only
```

Keep business logic in **services**, never in controllers or routes. Every feature module must use the common `activities` engine instead of re-implementing status logic.

---

## 4. Roles and permissions

| Action | Guest | Verified User | Verified & Active Rider | Admin |
| --- | --- | --- | --- | --- |
| View home, spotlight, about | ✅ | ✅ | ✅ | ✅ |
| Create passenger ride request | ❌ | ✅ | ✅ | — |
| Book a ride offer seat | ❌ | ✅ | ✅ | — |
| Offer a ride / accept passenger request | ❌ | ❌ | ✅ | — |
| Create carpool schedule | ❌ | ❌ | ✅ | — |
| Book a carpool seat | ❌ | ✅ | ✅ | — |
| Create / accept food & service requests | ❌ | ✅ | ✅ | — |
| Apply to become a Rider | ❌ | ✅ | — | — |
| Manage users, riders, content, reports, disputes | ❌ | ❌ | ❌ | ✅ |

- Roles: `USER`, `MODERATOR`, `SUPER_ADMIN` + `studentVerificationStatus` (`UNVERIFIED | PENDING | VERIFIED | REJECTED`) and flags `isVerifiedRider`, `riderActive`.
- Moderator: verifications, reports, disputes, requests and content only. Super Admin: everything.
- Guests are redirected to login/register on any action. Unverified users can only complete profile and verification.
- Only **Active** riders appear in matching and can accept.
- Account status gates everything: `RESTRICTED` cannot create/accept; `SUSPENDED` and `BANNED` cannot access.

Enforce all of this in **backend middleware**. Frontend hiding is cosmetic only.

---

## 5. Common activity engine (applies to ALL features)

### 5.1 Statuses

| Status | Meaning | Terminal |
| --- | --- | --- |
| `OPEN` | Available for acceptance/booking | No |
| `ACCEPTED` | Accepted or booked | No |
| `IN_PROGRESS` | Started | No |
| `DISPUTED` | Under admin review | No |
| `COMPLETED` | Verified complete | Yes |
| `CANCELLED` | Cancelled by participant or admin | Yes |
| `EXPIRED` | Nobody accepted before start | Yes |
| `NOT_MARKED` | Still ACCEPTED 6 h after start | Yes |

Main flow: `OPEN → ACCEPTED → IN_PROGRESS → COMPLETED`.

Sub-statuses (never replace the main status): Ride `RIDE_CONFIRMED`; Carpool `CONTRACT_ACTIVE`; Food `ORDER_CONFIRMED`, `FOOD_COLLECTED`; Service `SERVICE_DELIVERED`; all features `COMPLETION_REQUESTED`.

Parent posts (ride offers, carpool posts) have their own post status: `OPEN`, `FULL`, `CLOSED` — separate from each booking/contract status.

Implement one transition table in `server/src/modules/activities`. Reject any transition not allowed for that feature, and any change by a non-participant. Log every change in `activity_status_history`.

### 5.2 Single confirmation
Acceptance **is** the confirmation. On accept/book → `ACCEPTED` immediately, notify both users. No second confirm, no confirmation deadline, no confirm auto-cancel.

### 5.3 Two-step completion
1. Either participant marks completed → `COMPLETION_REQUESTED`.
2. Other participant confirms → `COMPLETED`, or raises a dispute → `DISPUTED`.
3. No response in **24 h** → auto `COMPLETED`.
4. A dispute inside the 24 h stops auto-completion until an admin resolves it.
Nobody can finalise completion alone. This applies to all features except carpool sessions, which either participant marks Completed or Cancelled in one step (problems go through a complaint).

### 5.4 Auto-close (`NOT_MARKED`)
- Still `ACCEPTED` **6 h** after scheduled start → `NOT_MARKED`, notify both.
- Never auto-close `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `COMPLETION_REQUESTED`, `DISPUTED`.
- Store `auto_closed_at` and `closure_reason`.
- `NOT_MARKED` ≠ completed/cancelled/expired and does not count in completion rate.

### 5.5 Global time-conflict check
- Each accepted activity blocks `start_time` → `start_time + 90 min`. No `end_time` field.
- Check **both participants** across Ride, Carpool sessions, Food and Service before every accept/book.
- Only `ACCEPTED` and `IN_PROGRESS` create conflicts.
- A service request with a date but no time is excluded from the check.
- Run the check inside the **same DB transaction** as the accept.

### 5.6 Creation time limits (validate on server too)

| Feature | Earliest | Latest |
| --- | --- | --- |
| Ride request / offer | now + 15 min | now + 48 h |
| Food (expected delivery) | now + 15 min | now + 24 h |
| Service (preferred date/time) | now + 15 min | now + 7 days |
| Carpool booking start date | tomorrow | within the schedule |

An `OPEN` item that reaches its start time with no accepter → `EXPIRED`.

### 5.7 Editing and safe acceptance
- Before acceptance: creator can edit, upgrade (raise amount) or delete. After acceptance: details locked, only cancel.
- Nobody accepts/books their own post.
- Accept/book must be **atomic**:
  ```ts
  // Prisma pattern — succeeds only if still OPEN
  const r = await tx.foodRequest.updateMany({
    where: { id, status: 'OPEN' },
    data: { status: 'ACCEPTED', accepterId: userId },
  });
  if (r.count === 0) throw new ConflictError('ALREADY_TAKEN');
  ```
  Seat bookings use a conditional seat-count update the same way. Never read-then-write.

### 5.8 Cancellation
- Before acceptance: free.
- After acceptance: either side, **reason required**, record who cancelled.
- Cancelling < 60 min before start = late cancellation (shown on profile, visible to admin).

---

## 6. Feature rules

### 6.1 Users, verification, auth
- Registration requires name, phone, email, university (from admin list). Google sign-in supported.
- Student verification: university email OTP/link (domain must match `university_domains`) **or** Student ID card photo reviewed by admin. States: `UNVERIFIED`, `PENDING`, `VERIFIED`, `REJECTED`.
- Multi-university: verified students from different universities can use each other's posts.
- **Forgot password:** same response whether the email exists or not; single-use reset link or 6-digit code, **15-min expiry**, hashed token; on reset log out all sessions and send a "password changed" email; max 3 requests/hour/email. Google-only accounts can use it to set a first password.

### 6.2 Rider & vehicle verification
- Form: NID front/back, car and/or motorcycle licence, licence expiry, one or more vehicles (type `BIKE|CAR`, brand, model, colour, registration no., photo, seat capacity: BIKE = 1, CAR = 1–4).
- Application: `PENDING → APPROVED | REJECTED` (reason shown, can re-apply).
- Files: JPG/PNG/PDF ≤ 5 MB, private storage, admin-only signed URLs.
- Vehicle details shown to students only after admin verification; registration number partially masked.
- Before booking, students see: rider name, photo, badge, verification status, rating, completion rate, vehicle type/brand/model/masked number.
- B1: licence expiry reminders, re-verification, history, deactivation.

### 6.3 Ride Sharing
- **Need a Ride** (any verified user): pickup, destination, date, time, offered amount, passengers, notes, map, sub-area → passenger request (one accepter).
- **Search a Ride**: open ride offers; filters pickup, destination, date, time range, sub-area — usable independently or combined.
- **Offer a Ride** (Active Rider): pickup, destination, date, time, fare per seat, vehicle, seats, notes.
- No option selected → map + all open requests and offers; no filter = show all.
- Suggested fare = OSRM distance × admin rate per km. Recommendation only.
- Seats: BIKE 1, CAR 1–4, validated against the vehicle's verified capacity; rider not counted. A booking takes 1 seat by default, more for companions up to seats left. Offer → `FULL` when no seats, back to `OPEN` when a booking cancels.
- Each booking has its own status, chat, completion and review.
- Passenger request can only be accepted by an Active Rider whose vehicle has enough seats. Normal users never accept passenger requests.

### 6.4 Carpool
- One schedule = one Carpool Post (day(s), time, pickup, destination, vehicle, seats, notes, fixed monthly price per offered duration 1/2/3/4 months).
- Max **12** schedules per rider; a rider's own schedules must not overlap.
- Booking = **one seat**, one contract per passenger, independent duration and price.
- Flow: request → rider accepts/rejects → seat held **24 h** (or until start date if sooner) + chat → both press Agree → contract (`CONTRACT_ACTIVE`) → generate a session for every agreed day.
- Each session: Completed or Cancelled (reason, who cancelled). Unmarked = Not Marked, counts against nobody.
- Post `FULL` when all seats booked; one cancellation/contract end reopens only that seat.
- Monthly payment record per contract month: `UNPAID` at month start → rider marks `PAID`. Method Cash/bKash/Nagad.
- Rider session cancellations are recorded and visible to passengers; admin can warn or suspend carpool access.
- Early termination needs the other side's agreement; disagreement → complaint. Refunds outside the app.
- Contract end: reviews + Renew request.
- Holiday calendar and "Skip this date" are **future** — do not build in v1.

### 6.5 Food Delivery
- Required: restaurant name & location, items, details, quantity, estimated budget, pickup (prefilled from restaurant, editable), delivery location, sub-area, expected delivery time. Optional: delivery service amount.
- Flow: `OPEN → ACCEPTED` → both confirm order details in app (`ORDER_CONFIRMED`) → accepter buys and uploads receipt (`FOOD_COLLECTED`, `IN_PROGRESS`) → deliver → two-step completion → blind reviews.
- Over budget → approval in chat before buying.
- Requester No-Show report with evidence → admin review.

### 6.6 Uni Service
- Categories (fixed): Shopping & Purchasing; Parcel & Delivery; Pharmacy & Healthcare; Document & Academic Services; Warranty & Repair Services; Financial & Administrative Services; Custom / Other Services. Custom service title inside a category.
- Required: category, service title, task title, description, destination, preferred date, offered amount. Optional: item details, quantity, reference image, pickup, sub-area, preferred time, budget, instructions (show only if filled).
- Flow: accept → Start (`IN_PROGRESS`) → `SERVICE_DELIVERED` + completion request → two-step completion → reviews.
- Pharmacy: buying/collecting only, no medical advice. Financial/Admin: show "never share passwords, PINs or OTP" warning.

### 6.7 Activity & Upcoming
- Activity filters: All / Ride / Carpool / Food / Service; Requested by me / Accepted by me.
- Active = OPEN, ACCEPTED, IN_PROGRESS, DISPUTED. Ongoing = IN_PROGRESS. History = COMPLETED, CANCELLED, EXPIRED, NOT_MARKED.
- Upcoming: future ACCEPTED items from all features, nearest first; carpool only next 7 days; countdown on nearest.

### 6.8 Chat
- Auto-created on accept / seat booking / carpool booking acceptance. One chat per activity (per booking for seat posts).
- Phone + Call button only after acceptance. **Email never shown.**
- System messages for key events. Food chats allow receipt images.
- Read-only after terminal status. Report + Block inside chat.
- Rate limit **10 messages/min/user**.

### 6.9 Notifications
- Channels: in-app, Web Push (opt-in), email fallback for important events.
- Triggered by status transitions; de-duplicate (one per event per user per channel).
- Full event → recipient → channel table: proposal section 14. Implement it exactly.

### 6.10 Trust & safety
- **Blind reviews:** 1–5 stars + optional comment, only for COMPLETED, within 7 days; hidden until both submit or 7 days pass; one per user per activity/booking; no edit/delete.
- Profile stats: average rating, completed, completion rate (completed ÷ accepted, excluding NOT_MARKED), cancellations, late cancellation rate. Badges: Verified Student, Verified Rider, Top Rated, Reliable.
- **Complaints/disputes:** reason + description + optional evidence → activity `DISPUTED` → admin investigates → decision (final status + warning/suspension/ban) → both notified → history stored.
- **Limits:** max 3 OPEN items per user (passenger requests, ride offers, food and service requests; soft-deleted items do not count); max 4 new such items per day (reset at midnight Asia/Dhaka; soft-deleted items still count); carpool posts (max 12 schedules) and carpool bookings are excluded from both; chat 10/min.
- **Block:** blocked users never see each other in matching, sub-area notifications or new messages.
- **Sub-areas:** admin-managed master list only; users search and select many; users cannot create sub-areas.

### 6.11 Payments
Record only: amount, method (`CASH | BKASH | NAGAD`), status (`UNPAID | PAID`). Food stores food cost and delivery charge separately. No payment gateway in v1.

### 6.12 Admin panel
Modules: Users (account management), Universities & domains, Rider Requests, Ride, Carpool, Food (incl. No-Show), Service, Disputes & Complaints, Reports & Support, Sub-Areas, Fare Settings, Promos/Spotlight/Banners, Notifications, Audit Log.

**User Account Management**
- Actions: view profile & activity history, verify/reject student verification, warn, restrict, suspend (with period), ban, unban, view moderation history.
- Account status: `ACTIVE`, `RESTRICTED`, `SUSPENDED`, `BANNED`.
- Rules: reason required for every warning/restriction/suspension/ban; suspension needs start + end date and returns to `ACTIVE` automatically at end; user notified on every status change; every action in Audit Log and moderation history; only authorised admins; restricting/suspending/banning closes the user's OPEN posts and notifies participants of their accepted activities.

**Audit Log** fields: admin, action, time, affected user/content, old value, new value. Read-only.

---

## 7. Data model

Use a common **`activities`** table (type, status, sub_status, start_time, creator_id, accepter_id, auto_closed_at, closure_reason) that feature tables link to. Chat, reviews, disputes, payments and notifications reference the activity (or booking), so Activity and Upcoming are single queries.

| Group | Tables |
| --- | --- |
| People | users, profiles, universities, university_domains, student_verifications, saved_addresses, blocks, moderation_actions, password_reset_tokens |
| Areas | sub_areas, user_sub_areas |
| Riders | rider_applications, rider_documents, vehicles |
| Core | activities, activity_status_history |
| Ride | ride_requests, ride_offers, ride_bookings |
| Carpool | carpool_posts, carpool_prices, carpool_bookings, carpool_contracts, carpool_sessions, carpool_monthly_payments |
| Food | food_requests, food_receipts |
| Service | service_categories, service_requests |
| Communication | chats, messages, notifications, push_subscriptions |
| Trust | reviews, disputes, dispute_evidence, reports, no_show_reports, support_requests |
| Money | payment_records |
| Content | promos, spotlight_items, banners, fare_settings |
| Admin | audit_logs |

Conventions: Prisma models in PascalCase, mapped to snake_case tables (`@@map`); enums for every status; `createdAt`/`updatedAt` on every model; index `status`, `start_time`, foreign keys and `(user_id, status)` pairs used by limits and conflict checks.

---

## 8. Background jobs (BullMQ)

| Job | Trigger |
| --- | --- |
| Expire OPEN items | at start time |
| Auto-complete | 24 h after completion request, unless disputed |
| Auto-close NOT_MARKED | 6 h after start, if still ACCEPTED |
| Release carpool seat hold | 24 h after rider accepts, or at start date |
| Generate carpool sessions | on contract creation |
| Monthly payment records | start of each contract month |
| Reminders | 30 min before start; carpool on ride day |
| Publish blind reviews | both submitted, or 7 days after completion |
| End temporary suspensions | at suspension end date |
| Licence expiry reminders (B2, when the job system exists) | before expiry |

Every job must be **idempotent**: re-check the current status inside the job before changing anything.

---

## 9. Engineering rules

- **Time:** store UTC, display `Asia/Dhaka`. All time rules validated server-side.
- **Security:** bcrypt; refresh-token rotation; hashed single-use reset tokens; rate limits on auth and chat; validate every input (e.g. zod/Joi); sanitise chat text (XSS); MIME + size checks on uploads; HTTPS; never log tokens, passwords or document URLs.
- **Authorisation:** every endpoint checks role, verification, account status and activity participation.
- **Privacy:** never return another user's email; return phone only to accepted participants; mask vehicle numbers for students.
- **API:** REST, JSON, consistent error shape `{ error: { code, message } }`, stable error codes (e.g. `ALREADY_TAKEN`, `TIME_CONFLICT`, `OPEN_LIMIT_REACHED`, `DAILY_LIMIT_REACHED`, `NOT_VERIFIED`, `ACCOUNT_RESTRICTED`) translated on the client.
- **i18n:** no hard-coded UI strings; every label in `bn.json` and `en.json`.
- **Theme:** colours only from theme tokens with light and dark values; status chip colours: green = completed, amber = open/pending, indigo = accepted, purple = in progress, red = cancelled/disputed, grey = expired/not marked.
- **UI:** Pathao-style minimal — one action per screen, cards with 12–16 px radius, one outline icon set (Lucide), one sans-serif font + Bangla font (e.g. Inter + Hind Siliguri), three text sizes, bottom-sheet pickers, sticky primary button on phones, skeleton loaders, empty states, toasts, confirm dialogs before delete/cancel, touch targets ≥ 44 px.
- **Layout:** phone = top bar + bottom tabs (Home, Activity, Upcoming, All Services, Inbox); desktop = top navbar, content ~1100 px.
- **Maps:** debounce Nominatim search, cache results, respect its 1 request/second limit.

---

## 10. Build order (follow the steps in order)

This build order replaces proposal §21.2 for build sequence only. For all business rules, the proposal still wins.

### Stage A – Foundation & Dashboard

| Step | Scope |
| --- | --- |
| A1 | Scaffold |
| A2 | Full Prisma schema (all tables in section 18) |
| A3 | Auth backend |
| A4 | Forgot password, Google sign-in, email service |
| A5 | Frontend shell + auth pages; Bangla/English UI and dark mode (theme + i18n from the start) |
| A6 | Universities + student verification |
| A7 | User dashboard: Home, Profile, Account & Settings, Saved Addresses, My Sub-Areas |
| A8 | Admin panel base: admin dashboard, User Account Management incl. suspension, Audit Log |

### Stage B – Features, one at a time

| Step | Scope |
| --- | --- |
| B1 | Rider & vehicle verification; licence expiry tracking, re-verification, verification history, rider suspension |
| B2 | Common activity engine + chat + notifications; licence expiry reminder job, sub-area notification engine |
| B3 | Ride Sharing (+ Activity, Upcoming, reviews) |
| B4 | Food Delivery (uses the B2 sub-area notifications for Food requests) |
| B5 | Uni Service (uses the B2 sub-area notifications for Service requests) |
| B6 | Carpool |
| B7 | Disputes, reports, No-Show |
| B8 | Spotlight, promos, banners, support |
| B9 | AI matching |
| B10 | Testing & release |

**Dependency rule:** Ride Offer creation and Passenger Request acceptance are not done until rider application + admin approval work.

MVP priority — Must: auth, student verification, basic rider verification, Ride, Food, activity engine, chat, notifications (in-app + push), Activity, Upcoming, reviews, core admin. Should: Carpool, Service, disputes, email fallback, Bangla UI, dark mode. Could: AI, Spotlight, promos, banners, suggested fare.

---

## 11. Testing

- **Unit:** status transitions, time limits, 90-min conflict check, seat counting, open/daily limits, review visibility.
- **Integration:** each feature's API flow, including **two users accepting the same item at the same moment** (only one may succeed) and overbooking attempts.
- **Jobs:** expiry, auto-complete, auto-close, seat-hold release, session generation, suspension end.
- **Security:** auth, per-endpoint authorisation, upload validation, rate limits.
- A feature is not done until its business rules from this file have tests.

---

## 12. Out of scope for v1 (do not build)

Online payments/wallet · academic holiday calendar & "Skip this date" · SOS / share trip / emergency contacts · gender preference filter · native mobile apps.

---

## 13. Working agreement for Claude Code

1. Before starting a feature, read its section in `docs/UniGo-Proposal-v1.1.md` and this file.
2. Propose the plan (schema changes, endpoints, screens) and wait for approval on anything that touches the schema or a business rule.
3. Work one phase at a time; keep commits small and focused.
4. Never hard-code limits in several places — keep them in one config file (`server/src/config/rules.ts`): 48 h, 24 h, 7 days, 15 min, 90 min, 6 h, 24 h, 7 days, 3 open, 4 daily, 10 msg/min, 60 min late cancel, 12 schedules, seat limits, 5 MB, 15-min reset expiry.
5. If something in the spec is ambiguous or contradictory, ask instead of deciding.

---

## 14. Decisions log

Decisions approved by the developer. Each one is also written into the proposal. Where an earlier section of this file says less or differs, follow this log.

### A2 – Data model (2026-11-03)

| # | Topic | Decision | Proposal |
| --- | --- | --- | --- |
| 1 | Refresh tokens | Add a `refresh_tokens` table for token rotation and "log out all sessions". | §18 |
| 2 | Deleting a request | Soft delete (`activities.deleted_at`): hidden from users, kept for limits and auditing. | §7.7 |
| 3 | Moderation actions | Besides warn, restrict, suspend, ban and unban: reactivate early (lift a restriction or suspension before its end), suspend / reinstate rider access, suspend / reinstate carpool access. | §17.1 |
| 4 | Rate Us | Stored as a support request with category App Feedback and a rating. | §5 |
| 5 | Ride offer sub-area | Optional field on the Offer a Ride form, used by the Search sub-area filter. | §8.1 |
| 6 | Carpool post dates | Each post has a start date and an optional end date. Without an end date the post stays available until the rider closes it. A contract cannot end after the post's end date. | §9.2 |
| 7 | Activity participants | `creator` owns the post or request; `accepter` took it (accepted, booked a seat or requested a carpool seat). For a ride or carpool booking the rider is the creator and the passenger the accepter. "Requested by me" = created by me; "Accepted by me" = other users' items I accepted or booked. | §12.2 |
| 8 | Service without a time | Excluded from the conflict check. For expiry, NOT_MARKED and Upcoming ordering its effective start is 23:59 Asia/Dhaka on the preferred date. | §7.5 |
| 9 | Carpool sessions | Marked Completed or Cancelled in one step; no two-step completion. Problems go through a complaint. | §7.3, §9.3 |
| 10 | Open and daily limits | Max 3 OPEN items (passenger requests, ride offers, food, service); deleted items do not count. Max 4 new such items per day; deleted items still count. Carpool posts (max 12 schedules) and carpool bookings are excluded from both. | §15.5 |
| 11 | Uniqueness | One university email can verify only one account (`users.verified_university_email` unique). A vehicle registration number is unique across riders (normalised column, unique); a re-submission updates the existing vehicle row. | §4, §6 |
| 12 | Spotlight seen / unseen | Kept in browser local storage (per device); no database table. | — (CLAUDE.md only) |
| 13 | Default language | Detected from the browser (English if it is not Bangla); the user's choice is saved to the account. | §4 |
| 14 | IDs | Time-ordered UUID v7 strings, so ids cannot be guessed in URLs. | §18 |

### A3 – Auth (2026-11-03)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Password rule | 8–72 characters, at least one letter and one number (`rules.auth.password`). bcrypt cost 12 (4 only when `NODE_ENV=test`, to keep tests fast). |
| 2 | Phone format | Bangladesh mobile numbers only. `01XXXXXXXXX`, `8801…` and `+8801…` (spaces and hyphens allowed) are stored as `+8801XXXXXXXXX`, unique per account. |
| 3 | Refresh token | JWT, only in the `unigo_refresh` cookie: httpOnly, `SameSite=Lax`, path `/api/auth`, Secure only in production. Only its SHA-256 hash is stored. Rotated on every refresh; reuse of a rotated token revokes the whole session family. Access token: JWT, 15 min, `Authorization: Bearer`. |
| 4 | `users.tokens_valid_after` | Access tokens issued at or before this time are refused. Set by logout-all now and by password reset in A4. |
| 5 | Auth rate limits | Login 10 per 15 min per IP + email; register 5 per hour per IP; refresh 30 per 15 min per IP (`rules.auth.rateLimits`). In memory until Redis arrives in B2. |
| 6 | Duplicate email / phone | Registration answers `EMAIL_TAKEN` / `PHONE_TAKEN` explicitly; the register rate limit guards against probing. |
| 7 | Expired suspension | Until the A8 job exists, a SUSPENDED account whose `suspendedUntil` has passed is treated as ACTIVE by the auth checks; the stored status is not changed. |
| 8 | Test setup | `tests/unit` (no database) and `tests/integration` (real MySQL database named `*_test` from `server/.env.test`, emptied before every test). Dev-only seed: Test University A and B. |

### A4 – Forgot password, Google sign-in, email (2026-11-03)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Linking Google to an existing account | Google sign-in with the email of an existing **password** account answers `GOOGLE_LINK_REQUIRES_PASSWORD` with a 10-minute `linkToken`; the user enters the password once at `POST /api/auth/google/link`. Users who don't know the password use Forgot password. This blocks the "someone registered my email first" takeover, because account emails are never proven at registration. A new Google user gets a 10-minute `signupToken` and completes name, phone and university at `POST /api/auth/google/register`. |
| 2 | Reset link | Single-use link `CLIENT_URL/reset-password#token=…`. The token is in the **URL fragment**, which browsers never send to a server, so it cannot reach logs or referrers. 32 random bytes, only the SHA-256 hash is stored, 15-minute expiry, a new request cancels the previous link. A reset sets `tokens_valid_after`, revokes every refresh token and does not log the user in. |
| 3 | Console exception | In **development only**, the console email transport prints whole emails, reset links included. This is the one exception to "never log tokens". Tests use an in-memory outbox and production always uses SMTP. |
| 4 | Auth rate limits (A4) | Forgot password: 3 per hour per email (every address, registered or not, so a 429 reveals nothing) plus 10 per hour per IP. Reset password: 10 per 15 min per IP. Google endpoints: 10 per 15 min per IP, shared. All in `rules.ts`. |
| 5 | Password emails | Sent directly by the auth code in A4, without holding up the response. They move into the notification system in B2. |
| 6 | Account status | Banned and suspended accounts can reset their password like anyone; login still refuses them. |

### A5a – Frontend foundation (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Brand colour | *Replaced by A5a polish #1 and #3* (was teal with a placeholder "U" mark). |
| 2 | Styling | Plain CSS: theme tokens (light + dark) in `client/src/styles/tokens.css`, one CSS Module per component. No Tailwind. Components use only token variables, never raw colours. Fonts self-hosted with `@fontsource` (Inter + Hind Siliguri). Phone layout below 768 px, desktop from 768 px. |
| 3 | Cross-tab refresh | The access token lives only in memory. One refresh at a time across all tabs: callers in a tab share one refresh; the Web Lock `unigo-auth-refresh` lets one tab refresh at a time; the refreshing tab bumps a counter in localStorage (`unigo.auth.refreshGeneration`, not a secret) and sends the new session on the BroadcastChannel `unigo-auth` before it releases the lock; a tab that waited reuses the session it received, or waits up to 1 s for a late message, and refreshes itself only if neither happens. A new tab first asks open tabs for their session (150 ms). Logout reaches every tab. Without Web Locks a tab still refreshes one at a time, but tabs are not coordinated. Code: `client/src/lib/session.ts`. |
| 4 | Public pages | Home and All Services are public; Activity, Upcoming, Inbox, Notifications and Account need a login (guests go to `/login?next=…`). |
| 5 | Preferences | Theme and language are kept in localStorage; when a session starts the account's saved values (from `/me`) are applied once. A7 saves changes to the account. Default theme: see A5a polish #2. |
| 6 | PWA | Manifest and icons now; the service worker comes in B2 with Web Push. |

### A5a polish (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Logo | Originals in `client/brand/` (`Logo-UniGo01.png` full logo with tagline, `Logo-UniGo02.png` round "U" icon); design and colours are never changed. `client/scripts/build-brand-assets.mjs` makes every derived file: the full logo's white background removed (only outside the blue circle, so the white "U" stays), the "UNIGO" wordmark cropped from it, favicon and PWA icons from the round icon. Navbar and phone top bar: round icon + "UNIGO" wordmark, no tagline. Login, Register and splash: full logo with tagline. Dark mode: round icon on a small white circle, wordmark and tagline in white. |
| 2 | Default theme | **Light**. Users can still choose Light, Dark or System in Account & Settings. |
| 3 | Colours | Minimal: Light — background `#F4F8FD`, card `#FFFFFF`, brand `#0A6FD6`, text `#0F1B2D`. Dark — background `#0B1220`, card `#131C2E`, brand `#4DA3FF`, text `#E6EDF7`. No extra feature colours. Supporting tokens (muted text, borders, soft brand tint `#F0F6FE` / `#14294A`) chosen to pass WCAG AA; `client/src/styles/tokens.test.ts` checks every text/background pair in both themes. |
| 4 | Status chips | **Accepted is indigo** (was blue). Others unchanged: green completed, amber open/pending, purple in progress, red cancelled/disputed, grey expired/not marked. |
| 5 | Home service cards | Phone 2 × 2, desktop 1 × 4. White card, soft shadow, 16 px corners; bold title, one-line subtitle, tag (Ride "Bike & Car", Carpool "Weekly", Food "From campus", Uni Service "7 categories") and one picture of the service (bottom-right; on phones just above the tag row so they never overlap). |
| 6 | Service pictures | *Updated 2026-11-04:* the project's own images (`client/brand/services/`: ride, carpool, food, service), designs unchanged, replacing the Fluent Emoji illustrations. Built into WebP at the card's picture box (phone 92 × 72, desktop 128 × 96) at 1x and 2x, served with `srcset`/`sizes`. Large holes the picture fully surrounds (car windows, the circle on the bag) are filled with white so the pictures look the same on light and dark cards. No images, logos or artwork from Pathao or other apps. Proposal §3 updated to match (Color, Icons, Accessibility rows). |
| 7 | Quick actions and Spotlight | Quick actions: small cards with brand-colour icons, one sideways row on phones, centred on desktop. Spotlight: sideways-scrolling story cards with an "unseen" ring (placeholders until B8). |
| 8 | Desktop navbar | Text links for Home, All Services ("সব সার্ভিস", renamed in A5b), Upcoming, Activity, Inbox; Notifications (bell, with unread badge) and Account & Settings as icons with tooltip and aria-label. |

### A5b – Auth pages (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Universities list | Public `GET /api/universities`: active universities only (id, name, short name), by name. Admin management comes in A6. |
| 2 | Language and theme at sign-up | `/auth/register` and `/auth/google/register` accept optional `language` (`BN`/`EN`) and `theme` (`LIGHT`/`DARK`/`SYSTEM`); the client sends what the browser uses, so a Bangla browser user is not switched to English on login. The database default for `users.theme` is now `LIGHT` (migration `a5b_theme_default_light`). |
| 3 | "Forgot password?" wording | The login link reads "Forgot password?" / "পাসওয়ার্ড ভুলে গেছেন?", exactly as both "password changed" emails name it (the English email was changed to match). A test checks the emails. |
| 4 | Google button | Google's own sign-in library (Google Identity Services, loaded from `accounts.google.com`) draws the official button in the app's language and theme. Needs `VITE_GOOGLE_CLIENT_ID` in `client/.env` (same value as the server's `GOOGLE_CLIENT_ID`) and the site's address in the client's Authorised JavaScript origins. |
| 5 | Browser checks | The browser checks only required fields and the email format; password, phone and every other rule stay on the server (`rules.ts`), with the password rule shown as a hint. Server field errors are shown under each field in the user's language (`errors.fields.*`). |
| 6 | Auth layout | Login, Register, Google sign-up, Forgot password, Reset password and Verify use a simple layout: full logo with tagline, a language switch and "Back to Home"; no navbar or bottom tabs. |
| 7 | After login | Go to `next` if it is a path on this site (starts with `/`, not `//`, not an auth page), otherwise Home. Registration goes to the "verify your student status" screen (`/verify-student`; real verification in A6). |
| 8 | Reset link | The reset page reads `#token=…` and removes it from the address bar at once, so it does not stay in the browser history. |
| 9 | Bangla spelling | A test fails if `bn.json` ever contains "আ্যা"; the correct form is "অ্যা" (U+0985). Hind Siliguri renders অ্যা correctly, so the Bangla font stays. |
