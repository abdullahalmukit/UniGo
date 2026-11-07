## 0. Git Identity and Attribution (Highest Priority)

These rules are permanent and take priority over every other instruction in this file.

* Git identity: Name Mukit, Email abdullahalmukit287@gmail.com.
* Always verify git config user.name and user.email before creating a commit. If they do not match, stop and tell me.
* Never change the configured Git identity.
* Never use Claude, Anthropic or any AI tool as author or committer.
* Never add Co-authored-by trailers or any AI attribution to commit messages, README, docs or project metadata.
* Do not commit unless I explicitly ask.
* Never push to GitHub. Mukit reviews the commits and pushes manually.
* Work directly in D:\UniGo on the main branch. Do not create worktrees or new branches.
* Never force-push or rewrite Git history without my explicit permission.
* Preserve existing project instructions and third-party copyright notices.
* Keep Mukit identified as the project owner in documentation.

---


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
- No option selected → list of all open requests and offers, no map (B3b-1 #5); no filter = show all. A map opens only inside the place picker.
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
- Profile stats: average rating, completed, completion rate, cancellations, late cancellation rate; exact profile definitions in B3b-2 #4 (the platform KPI keeps completed ÷ accepted, excluding NOT_MARKED: B3b-2 #5). Badges: Verified Student, Verified Rider, Top Rated, Reliable.
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
| A8 | Admin panel base: admin dashboard, User Account Management incl. suspension, Audit Log |
| A7 | User dashboard: Home, Profile, Account & Settings, Saved Addresses, My Sub-Areas |

A8 is built before A7 (developer decision, 2026-11-04); the step numbers stay the same.

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
| 7 | Expired suspension | A SUSPENDED account whose `suspendedUntil` has passed is treated as ACTIVE by the auth checks; since A8 the account-status job also writes ACTIVE within a minute (A8 #5). |
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

### A6 – Universities and student verification (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Email domain | The university email's domain must **exactly** match one of the user's own university domains; an admin adds each subdomain separately. Checked when the code is sent and again when it is confirmed. |
| 2 | Email code | 6 digits, expires after 10 minutes, at most 5 wrong tries per code, a new code at most once a minute and replaces the previous one. Only an HMAC of the code is stored. Sending a code does not change `studentVerificationStatus`. Rate limits: send 5 per hour per account + 20 per hour per IP; check 10 per 15 min per account. All in `rules.studentVerification`. As in A4 #3, the development console prints the code email. |
| 3 | Email while an ID card is pending | Allowed. When the email is verified, the pending card is closed as `REJECTED` with the system reason "Verified by university email", no reviewer and no email. |
| 4 | ID card | JPG/PNG/PDF ≤ 5 MB; the declared type and the file's first bytes must both match. Stored under a random name in private storage (`PRIVATE_STORAGE_DIR`, default `server/storage/private`, gitignored); the original filename is never kept. One card under review at a time; re-submit after rejection. 5 uploads per hour per account. |
| 5 | Signed file links | Admins get a 5-minute link `/api/files/<token>` (JWT signed with `FILE_SIGNING_SECRET`); the link is the permission, so it needs no login and is never logged. Served with `no-store` and `nosniff`. |
| 6 | Admin review | `GET/POST /api/admin/student-verifications…` for Moderators and Super Admins: list (pending oldest first), file link, approve, reject with a reason (3–500 characters). Atomic, so two admins cannot both decide one card (`ALREADY_REVIEWED`); an admin cannot review their own card. Each decision is in the Audit Log and emailed to the student in their language. The in-app notification comes with B2. |
| 7 | University admin | `/api/admin/universities` (Super Admin only): list, create (with domains), edit, deactivate, delete, add and remove domains. A university with users cannot be deleted (`UNIVERSITY_HAS_USERS`); deactivate it instead. Every change is in the Audit Log. |
| 8 | Status on the client | `/verify-student` is the real flow (both methods). Account & Settings shows a status card and the Verification menu item with a status chip (green verified, amber under review, red rejected, grey not verified); A7 reuses the chip on Profile. |
| 9 | Dev admin | `npm run db:seed -w server` also creates a `SUPER_ADMIN` from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (development only); an existing account with that email is promoted, its password unchanged. |

### A8 – Admin panel base (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Suspension start | A suspension starts now or at a later date (`users.suspended_from`, migration `a8_account_status_periods`). A suspension booked for later keeps the current status until it starts; from its start date the auth checks treat the account as SUSPENDED even before the job writes it. |
| 2 | Restriction end | A restriction has an optional end date (`users.restricted_until`); without one it lasts until a Super Admin reactivates the account. |
| 3 | Who acts on accounts | Moderators and Super Admins can open `/admin` and view users, verification and moderation history. Warn, restrict, suspend, ban, unban and reactivate are Super Admin only. Nobody can act on their own account or on a Super Admin. |
| 4 | Super-Admin-only modules | Universities (A6), Sub-Areas and the Audit Log. |
| 5 | Ending statuses | `server/src/jobs/account-status.job.ts` runs every minute in the API process (until BullMQ in B2): starts booked suspensions, returns ended suspensions and restrictions to ACTIVE and emails the user. Idempotent (conditional updates). Not an admin action, so it writes no Audit Log row; the original entry holds the end date. |
| 6 | Removing a sub-area | Deleted when no activity uses it (users' selections go with it); otherwise deactivated. Every change is audited. |
| 7 | Account actions | Reason 3–500 characters for every action. Allowed starting status: warn any but BANNED; restrict from ACTIVE/RESTRICTED; suspend from ACTIVE/RESTRICTED/SUSPENDED; ban any but BANNED; unban from BANNED; reactivate from RESTRICTED/SUSPENDED or with a booked suspension. Conditional update, so two admins at once cannot both apply (`STATUS_CHANGED`). Each action writes `moderation_actions` and `audit_logs` in one transaction and emails the user in their language (dates in Asia/Dhaka). Closing OPEN posts and notifying participants is a hook (`onAccountLocked`) that B2/B3 fill in. |
| 8 | Dashboard | Counts from the real tables: total users, active users (status ACTIVE), verified students, verified riders, pending ID cards, pending rider applications, open disputes, open reports, No-Show reports, new requests today per feature (from midnight Asia/Dhaka). Unbuilt features show 0. |
| 9 | Admin UI | `/admin` has its own layout: sidebar on desktop, a menu drawer on phones. A normal user sees "Not allowed"; a Moderator sees "Not allowed" on Super Admin pages. Admins get an "Admin panel" link in Account & Settings. ID cards open through the 5-minute signed link (image inline, PDF in a frame, plus "open in a new tab"); the file-url response includes `mimeType`. Audit Log date filters are whole days in Asia/Dhaka. |

### A7 – User dashboard (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Profile fields | Users edit name, phone, student ID, department, batch, location and photo (`PATCH /api/me/profile`). Email and university cannot be changed after registration. The phone follows A3 #2 and answers `PHONE_TAKEN` when another account uses it. A blank optional field is stored as empty (null). |
| 2 | Profile photo | JPG or PNG up to 5 MB (`PUT`/`DELETE /api/me/photo`). The server re-encodes it with `sharp` to a 512 × 512 JPEG, which removes EXIF data such as a phone's GPS position. Stored in private storage under `profile-photos/` (`profiles.photo_key`, migration `a7_profile_photo_key`); a replaced or removed photo's file is deleted. `/auth/me` and the admin user page return a signed link `photo: { url, expiresAt }` valid for **1 hour** (`rules.profile.photo`), never the key. The browser shrinks a photo to at most 1024 px before uploading. Other users see photos through signed links from B3 (participants only). |
| 3 | Change password | `POST /api/auth/change-password` (under `/api/auth` because it answers with a new session cookie). Needs the current password (`WRONG_PASSWORD`); the new one follows A3 #1. Every session ends (`tokens_valid_after`, refresh tokens revoked) and this device gets a new session, so only the other devices are logged out. Sends the "password changed" email. 5 per 15 min per account. |
| 4 | Google-only accounts | Profile shows "Email me a link" instead of Change password: `POST /api/me/password-setup-link` sends the A4 reset link, which proves the user owns the email. 3 per hour per account; refused when the account already has a password (`PASSWORD_ALREADY_SET`). `/auth/me` includes `hasPassword` and `hasGoogle`. |
| 5 | Language and Appearance | Applied on the device at once, then saved with `PATCH /api/me/preferences` (`language`, `theme`, `emailNotificationsEnabled`). If saving fails a toast says so and the device keeps the choice. Every open tab receives the updated account (`session.updateUser`). |
| 6 | Notification settings | The Web Push switch stays disabled ("Coming in a later update") until B2. One email switch (`users.email_notifications_enabled`) covers activity emails from B2 on. Emails about password, account status and verification results are always sent. |
| 7 | Saved addresses | One each of Home, Hall and Work; a Custom place needs a name (1–50 characters); at most **10** per user (`rules.savedAddresses`). The user row is locked while checking, so requests sent together cannot pass the limits. "Add Home" when Home exists opens the saved one. |
| 8 | Map picker | Leaflet 1.9.4 used directly (no react-leaflet), OpenStreetMap tiles with attribution, pin fixed in the centre; moving the map fills in the address (Nominatim reverse), which stays editable. Nominatim search is limited to Bangladesh (`countrycodes=bd`), debounced 600 ms, sent through one app-wide queue at least 1 s apart, and cached in memory and `sessionStorage` (`client/src/lib/nominatim.ts`). *Since B3a (#15) the requests go through the server proxy `/api/geo`, which keeps the 1-per-second rule for the whole server.* |
| 9 | My Sub-Areas | `GET /api/sub-areas?q=` lists active sub-areas to logged-in users (50 at most). `PUT /api/me/sub-areas` replaces the selection, at most **20** (`rules.subAreas`); each add or remove is saved at once. A selection whose sub-area an admin deactivates is hidden and kept (it returns if reactivated) and does not count against the limit. |
| 10 | Limits on screens | List responses carry `max` from `rules.ts` (addresses, sub-areas), so the client never hard-codes a limit. |
| 11 | Blocked Users | `GET /api/me/blocks` shows only name, photo and university, never email or phone; `DELETE /api/me/blocks/:userId` unblocks. Blocking itself comes with chat in B2. |
| 12 | Who can use them | Every logged-in user, including unverified and RESTRICTED accounts (completing the profile is allowed before verification). SUSPENDED and BANNED accounts are refused by `authenticate`. |
| 13 | Account & Settings | A profile card at the top; Profile, Verification, Saved Addresses, My Sub-Areas, Notifications and Blocked Users open their pages; Drive with UniGo, Payment Methods, Promos, Support Request, Policy and Rate Us show "Coming soon". Social media logos are left out until their URLs are given. Home quick actions Saved Addresses, Add Home and My Sub-Areas open these pages. |
| 14 | Shared UI | Toasts (`components/toast.tsx`), a confirm sheet before delete or unblock (`components/ConfirmSheet.tsx`) and `Avatar` (photo or initials). Routes: `/account/profile`, `/account/addresses` (`/new`, `/:id`), `/account/sub-areas`, `/account/notifications`, `/account/blocked`. |

### B1 – Rider and vehicle verification (2026-11-04)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Who can apply | VERIFIED students on an ACTIVE account (`NOT_VERIFIED`, `ACCOUNT_RESTRICTED`). One application under review at a time (`APPLICATION_PENDING`; the user row is locked while checking). 5 submissions per hour per account. No migration: the A2 rider tables are used as they are. |
| 2 | Application | One multipart `POST /api/rider/applications`: the form as JSON in `data`, plus `nidFront`, `nidBack`, `carLicence`, `motorcycleLicence` and `vehiclePhotos` (one per vehicle, in order). 1–5 vehicles per application, at most 5 active (pending or approved) vehicles per rider (`rules.rider`). Seats: BIKE = 1, CAR = 1–4. Registration number 5–30 characters with digits. Field errors keep their full path (`vehicles.0.registrationNumber`). |
| 3 | Licences | A BIKE needs a motorcycle licence and a CAR a car licence (`LICENCE_DOES_NOT_MATCH`). One expiry date per application: after today (Asia/Dhaka), at most 10 years ahead; valid through the whole expiry day. The current expiry is the latest one among the rider's approved applications. |
| 4 | Files | NID and licences: JPG, PNG or PDF up to 5 MB, stored as uploaded in private storage (`rider-documents/`), opened by admins through 5-minute signed links. Vehicle photos: JPG or PNG, re-encoded with `sharp` to a JPEG of at most 1280 px without EXIF (`vehicle-photos/`). Files written before a failed submission are removed. |
| 5 | Registration numbers | Unique through the A2 normalisation helper. Another user's PENDING or APPROVED vehicle → `REGISTRATION_TAKEN`. A REJECTED vehicle row is updated by its owner's re-submission or taken over by another applicant (its old photo is deleted); the Audit Log keeps the history. Re-sending one's own approved vehicle → `VEHICLE_ALREADY_REGISTERED`. |
| 6 | Review | Moderators and Super Admins approve or reject the whole application with all its vehicles (`/api/admin/rider-applications`). Reject needs a reason (3–500 characters). Conditional update, so two admins at once cannot both decide (`ALREADY_REVIEWED`); nobody reviews their own. Approval sets `isVerifiedRider` (the Verified Rider badge). Every decision is audited and emailed (bn/en). |
| 7 | Re-verification | An approved rider's next application is a REVERIFICATION: the current licence file(s) for every vehicle they drive, a later expiry date (`LICENCE_EXPIRY_NOT_LATER`) and optionally new vehicles; no NID. It is also how a rider adds a vehicle. While it is under review the rider carries on as before. |
| 8 | Active switch | `PATCH /api/rider/active`. Going Active needs a verified rider, a VERIFIED student, an ACTIVE account, no rider suspension and a valid licence; the error code names the blocker. Restricting, suspending or banning an account sets the rider Inactive (`onAccountLocked`). |
| 9 | Licence expiry | The account-status job sets an Active rider Inactive once their licence expiry day has ended; they cannot go Active until a re-verification with a later date is approved. `isVerifiedRider` stays true. Reminders come with B2. |
| 10 | Rider suspension | Super Admin only: `POST /api/admin/riders/:id/suspend` (reason, optional end date) and `/reinstate` (reason). Suspending sets the rider Inactive. Writes `moderation_actions` (RIDER_SUSPEND / RIDER_REINSTATE) and the Audit Log, and emails the rider. The account-status job lifts a suspension at its end date and emails the rider. |
| 11 | Masked numbers | `maskRegistrationNumber` hides all but the last 2 digits of the last group of digits (`Dhaka Metro-LA 12-1234` → `Dhaka Metro-LA 12-••34`, Bangla digits too). `toPublicVehicle()` must be used for every vehicle sent to students (B3 on). The rider and admins see the full number. |
| 12 | Rider Dashboard | `GET /api/rider/dashboard`: the proposal §6 counters, all 0 until B3/B6 fill them in. Riders only (`NOT_A_RIDER`). |
| 13 | Screens | `/drive` (Drive with UniGo, from Account & Settings and Home): verify first, requirements, the application form, under review, rejected with the reason and "Fix and apply again", and for riders the badge, Active switch, licence, re-verification, dashboard, vehicles and history. Admin "Rider Requests" (`/admin/rider-requests`): Applications (by status) with a review page, and Riders with suspend/reinstate for Super Admins. |
| 14 | Bundle | Leaflet loads only with the map (`React.lazy`, map values in `components/map-types.ts`); the admin area and `/drive` load per route (react-router `lazy`, one explicit import per page). The main bundle is about 320 kB. |

### B2a – Common activity engine and background jobs (2026-11-07)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Scope of B2 | B2 is built in three parts: **B2a** the activity engine and background jobs, **B2b** chat, **B2c** notifications, Web Push, reminders and sub-area notifications. B3 starts only after all three. |
| 2 | Conflict group | New column `activities.conflict_group_id` (migration `b2a_conflict_group`): the ride offer id for ride bookings, the carpool post id for carpool sessions. Activities of the same group never conflict with each other, so a rider's several bookings on one offer do not block each other. |
| 3 | Transition table | One table for every feature in `server/src/modules/activities/transitions.ts`; every change goes through `applyTransition()` (conditional UPDATE on the status and sub-status that were read, plus `activity_status_history` in the same transaction). Refusals: `INVALID_TRANSITION` (409), `NOT_PARTICIPANT` and `ACTION_NOT_ALLOWED` (403). Completion can be requested only once started (`IN_PROGRESS`). No cancelling while `COMPLETION_REQUESTED`: the other user confirms or disputes. Carpool sessions are completed or cancelled in one step. |
| 4 | Per-feature steps | Ride Start: either participant (§8.6). Service Start: accepter only (§11.3). Food has no Start: it reaches `IN_PROGRESS` only through `COLLECT_FOOD`, the accepter's receipt upload (§10.3), after `CONFIRM_ORDER`. One sub-status column holds the latest sub-status: the service accepter's `DELIVER_SERVICE` sets `COMPLETION_REQUESTED` and writes two history rows (`SERVICE_DELIVERED`, then `COMPLETION_REQUESTED`); the service requester can still ask for completion with `REQUEST_COMPLETION`. |
| 5 | Accept transaction | READ COMMITTED (under REPEATABLE READ the conflict query could read an old snapshot). Both users' rows are locked first with `SELECT … FOR UPDATE`, sorted by id (no deadlock); retried up to 3 times after a deadlock. Then: own item `OWN_ITEM`, start time passed `START_TIME_PASSED` (never left to the expiry job), restricted accepter `ACCOUNT_RESTRICTED`, a block either way `NOT_AVAILABLE`, conditional `updateMany … status = OPEN` → `ALREADY_TAKEN`, then the 90-minute check `TIME_CONFLICT`. |
| 6 | Conflict check | `assertNoTimeConflict()` takes a list of start times, so B6 checks every session of a contract in one call. Starts less than 90 minutes apart conflict; exactly 90 minutes apart is allowed. Only `ACCEPTED` and `IN_PROGRESS` with `blocks_time = true` count, across all features, for either user as creator or accepter. |
| 7 | Seats and ride offers | Seats change only by conditional UPDATE (`seats_available >= n`, offer OPEN, not departed); refusals `ALREADY_TAKEN` or `NOT_ENOUGH_SEATS`. Cancelling a ride or carpool booking gives its seats back in the engine. A FULL ride offer reopens only while `departure_time > now`; a carpool post only while its end date has not passed; a CLOSED post never reopens. OPEN and FULL ride offers are CLOSED at departure (job and sweeper); bookings on them carry on. |
| 8 | Open and daily limits | `assertCreationLimits()` locks the creator's row, then counts. Open: OPEN passenger, food and service requests plus OPEN ride offers; a FULL offer does not count. Daily: the same, created since midnight Asia/Dhaka (18:00 UTC), deleted items included. Deleting is a soft delete to CANCELLED (`DELETED_BY_CREATOR`). |
| 9 | Complaints | A complaint moves an `ACCEPTED` or `IN_PROGRESS` activity (ride, food, service, carpool session) to `DISPUTED` and stops auto-completion. A complaint on a terminal activity does not change its status. The admin resolves a dispute to COMPLETED or CANCELLED (`DISPUTE_RESOLVED`). Endpoints come in B7. |
| 10 | BullMQ | One queue (`unigo`) on Redis at `REDIS_URL` (Memurai on Windows). Job ids are deterministic, `<job>-<id>-<due time in ms>` (BullMQ refuses `:` in custom ids), so adding one twice is a no-op. `removeOnComplete` and `removeOnFail` are true, 3 attempts. Jobs are queued only after the transaction commits; each handler re-reads the database and changes nothing if the item no longer qualifies, so every job can run twice. Editing an OPEN item's start time removes the old jobs and queues new ones (`rescheduleAfterStartChange`). Tests use an in-memory scheduler and never need Redis. |
| 11 | Safety-net sweeper | Not a spec rule; added on the developer's advisor's suggestion. Every minute (`rules.jobs.sweepInterval`) it expires overdue OPEN items, closes items still ACCEPTED 6 h after start as NOT_MARKED, auto-completes 24-hour-old completion requests and closes departed ride offers, using the same handlers. It covers lost Redis data and time the server was down. |
| 12 | `blocks_time` | Already in the A2 schema. `blocksTimeFor()`: false for `CARPOOL_BOOKING` (its sessions block time) and for a service request without a time; true for everything else. |
| 13 | Account lock hook | `onAccountLocked()` runs in the transaction that restricts, suspends or bans: rider set Inactive, the user's OPEN requests and OPEN carpool booking requests (sent or received) CANCELLED with `ACCOUNT_MODERATED`, their OPEN and FULL ride offers and carpool posts CLOSED. Accepted activities carry on; the hook returns their ids so B2c notifies the other participants. The account-status job (suspensions, restrictions, rider suspensions and the licence-expiry auto-Inactive check) now runs as a repeating BullMQ job every minute instead of `setInterval`. |
| 14 | Endpoints and events | `POST /api/activities/:id/start`, `/request-completion`, `/confirm-completion`, `/cancel` (reason 3–500 characters) and `DELETE /api/activities/:id`. Accept and booking routes belong to each feature (B3 on) and call `acceptActivity()`. Every committed change is announced with `onActivityTransition()` for chat (B2b) and notifications (B2c). |
| 15 | Later jobs | Licence-expiry reminders, the 30-minute start reminder, carpool ride-day reminders and sub-area notifications: B2c. Publishing blind reviews: B3. Carpool seat-hold release, session generation and monthly payment records: B6. Each is added as a BullMQ job in `server/src/jobs` with the same rules (deterministic id, re-check before changing). |

### B2b – Inbox and chat (2026-11-07)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Redis down after a commit | Queueing or removing a job never holds up a request: once the Redis connection has reported an error, queue calls are skipped at once (logged once per outage) until it is back, and any single call gives up after `rules.jobs.queueTimeout` (2 s). The database change stays committed; the sweeper does the job's work later. |
| 2 | Read tracking | New table `chat_reads (chat_id, user_id, last_read_at)` (migration `b2b_chat_reads`); `messages.read_at` and its index are dropped. A message is unread for a user when it is newer than their `last_read_at` and they did not send it; system messages count for both. Marking read never moves the position back. |
| 3 | Opening a chat | One chat per activity (per booking for seat-based posts), created inside the accept transaction (`acceptActivity`), or when the rider accepts a carpool booking request (`ACCEPT_BOOKING`, §9.3 step 3). B3 opens ride booking chats with `postTransitionMessage`. Carpool sessions have no chat of their own: their messages go to the booking's chat (`SESSION_*` codes). |
| 4 | System messages | Written by the engine in the same transaction for accepted, started (a food chat shows "food collected"), completion requested, completed, cancelled, disputed and NOT_MARKED. `sender_id` is the user who made the change (null for the system or an admin), so the client says "You …" or "The other user …" and the actor never gets it as unread. Only a cancellation carries its reason; a dispute's reason is for the admin. |
| 5 | Socket.IO | Path `/api/socket` on the API port. Signs in with the access token (same checks as REST); the client sends a refreshed token with `auth:refresh`, and a socket whose token expired is disconnected. Each socket joins only its user's room; `chat:join` checks participation. Sending re-reads the account status every time. Suspending or banning an account disconnects all its sockets at once (`afterAccountLocked`); a restricted user keeps chatting. |
| 6 | Message text | Plain text, 1–1000 characters, shown as text and never as HTML. Removed: control characters (except new line and tab), invisible direction overrides and zero-width characters; Bangla's zero-width joiner and non-joiner are kept. |
| 7 | Rate limits stay in memory | Chat: 10 messages a minute per user, shared by REST and the socket (`RATE_LIMITED`). All rate limits stay in memory (one API process); they start from zero when the server restarts, including the auth limits (for example 3 reset requests an hour per email). Revisit in B10. |
| 8 | Block | From a chat (`/api/chats/:id/block`) or a profile (`POST /api/me/blocks`); the confirmation sheet shows the impact first (`…/block-impact`, `/api/me/blocks/:userId/impact`) and also offers Report. Shared activities that are ACCEPTED, or IN_PROGRESS without a completion request, and a held carpool seat are cancelled through the normal CANCEL step by the blocker: the late-cancellation flag is kept, the reason "Blocked" is stored only in `activity_status_history` (visible to admins), and the other user sees "Cancelled by the other user". Completion-requested and disputed activities stay as they are. A shared active carpool contract refuses the block (`BLOCK_CARPOOL_CONTRACT`): end it early or file a complaint (§9.6); full handling in B6. After reviewing a report, admins can clear such a late-cancellation flag (B7). Chats between them stay visible, read-only for both; unblocking reopens sending in chats that are still active. `blockedUserIds()` is for matching (B3) and sub-area notifications (B2c). |
| 9 | Phone and Call | Shown only while the activity is ACCEPTED, IN_PROGRESS or DISPUTED, and hidden at once if either user has blocked the other. Email is never in any chat or socket payload (tested). |
| 10 | Food chat images | Food chats only. JPG or PNG up to 5 MB, declared type and first bytes checked, re-encoded with `sharp` to at most 1600 px without EXIF, stored in private storage (`chat-images/`). Links are signed for 10 minutes and given only to participants; the client fetches fresh links when one has expired instead of showing a broken image. |
| 11 | Reports | `POST /api/reports`: reason Harassment, Inappropriate content, Spam, Scam or fraud, Safety concern, Fake profile or identity, or Other (Other needs a description); optional text, activity and message. With an activity, the reporter must take part and the reported user is the other participant; a message must be theirs in that chat. 5 reports an hour per account. Admin review in B7. |
| 12 | Read-only | A chat accepts messages while its activity is ACCEPTED, IN_PROGRESS or DISPUTED; COMPLETED, CANCELLED, EXPIRED and NOT_MARKED make it read-only (`CHAT_READ_ONLY`), a block either way too (`CHAT_BLOCKED`). The activity row is read `FOR SHARE` while sending, so a message can never slip in after the change that closed the chat. |
| 13 | Dev chat demo | `npm run db:seed:dev-chat -w server`, a separate script (not part of `db:seed`) that refuses to run unless `NODE_ENV=development`. Uses `DEV_DEMO_PASSWORD` from `server/.env`. |
| 14 | Endpoints | `GET /api/chats` (inbox), `GET /api/chats/unread-count`, `GET /api/chats/:id`, `GET /api/chats/:id/messages`, `POST /api/chats/:id/messages`, `POST /api/chats/:id/images`, `POST /api/chats/:id/read`. Socket events: `auth:refresh`, `chat:join`, `chat:leave`, `message:send`, `chat:read` from the client; `message:new`, `inbox:update`, `chat:changed`, `auth:expired` from the server. |

### B2c – Notifications, Web Push and reminders (2026-11-07)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Catalogue | Every proposal §14 row is one entry in `server/src/modules/notifications/catalogue.ts` with exactly the table's channels (tested row by row). Reminders have **no email**: the table wins, and "reminders" was removed from the email sentence above it in the proposal. Added rows: licence expiry reminder (in-app + email), the other participant's account was locked (`PARTICIPANT_ACCOUNT_LOCKED`, in-app + push + email) and rider access changed (`RIDER_ACCESS_CHANGED`, in-app + email). Migration `b2c_notifications` adds the two types and an index for the Notifications page. |
| 2 | De-duplication | One row per user per channel per event: `notifications (user_id, channel, dedupe_key)` is unique, and each event has a fixed key (e.g. `ACTIVITY_CANCELLED:<activity>`, `ACTIVITY_REMINDER:<activity>:<start ms>`, `ACCOUNT_STATUS_CHANGED:<moderation action>`). A repeated event or a job that runs twice notifies nobody twice. |
| 3 | Email switch | `users.email_notifications_enabled` covers activity emails only (the row is stored as `SKIPPED`, reason `EMAIL_OFF`). Password, verification, account status, rider and licence emails are always sent. The A4-B1 emails now go through `notify()` and keep their templates. Exception: the reset email's single-use link is never stored, so it is sent at once and only the outcome is recorded (`notifyWithDirectEmail`). The OTP code email stays a direct send. |
| 4 | Text and links | Server templates in Bangla and English (`notifications/templates.ts`), in the recipient's saved language: in-app text is built when the list is read, push and email text when they are sent. `data` holds only names, kinds and dates, never an email, phone, token or file link. One function (`notifications/link.ts`) gives each notification its page; activity notifications open the activity's chat until B3 adds detail pages. |
| 5 | Delivery | In-app rows are delivered by being stored and pushed to open tabs (`notification:new`, `notification:unread`). Push and email rows are sent by the `notification-deliver` BullMQ job: 3 attempts, exponential backoff from 10 s; a failed attempt leaves the row `PENDING`, the last one records `FAILED`. When Redis is unavailable the row is sent directly, once (same idea as B2b #1). The sweeper sends rows still `PENDING` 2 minutes after they were written (up to a day old). |
| 6 | Web Push | `web-push` with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (required in production; without them in development push is off). One subscription per device (unique endpoint; a shared device moves to the account that subscribed last). The switch in Account › Notifications is per device; the device remembers which account turned it on and never starts pushes for another account. Logging out removes this device's subscription; log out of all devices, password reset and password change remove all of them (this device saves its own again after a password change). A subscription that answers 404 or 410 is deleted. No push to SUSPENDED or BANNED accounts. `users.push_enabled` is true while the account has a subscribed device. |
| 7 | Service worker | `client/public/sw.js` shows pushes and opens their page. It has **no fetch handler**, so it caches nothing (API responses included). Registered with `updateViaCache: "none"`, checked for updates when the page becomes visible, and takes over at once (`skipWaiting` + `clients.claim`), which is safe because it holds no cache. A tapped push focuses an open tab and routes inside the app, or opens a window; only paths on this site are followed. |
| 8 | Chat messages | Nothing (no push, no in-app row) while one of the receiver's tabs shows that chat and is visible (`chat:viewing` socket event). In-app: one row per chat per unread run (`NEW_CHAT_MESSAGE:<chat>:<last read time>`), updated by later messages (count, latest sender, moved to the top, unread again) and marked read when the chat is read. Push: one per message with tag `chat-<chat>`; only the first message of an unread run alerts (`renotify`), later ones replace it silently. Push and lock-screen text never show the message, only "New message from <name>" (developer decision Q1). System messages notify nobody here; their activity notification does. |
| 9 | Activity events | From `onActivityTransition`: ACCEPT → creator (`SEAT_BOOKED` for a ride booking); ACCEPT/REJECT_BOOKING → passenger; contract active → both; completion requested (incl. DELIVER_SERVICE) → the other participant; auto-completed and NOT_MARKED → both, in-app; cancelled by a user → the other participant; cancelled by the system or an admin (seat hold expired, admin cancel, a locked account's carpool booking request) → the participants still active; dispute opened and resolved → both; expired → creator. START, CONFIRM_ORDER, COLLECT_FOOD, CONFIRM_COMPLETION, COMPLETE_SESSION, END_CONTRACT and DELETE are not in §14: chat system message only. New carpool booking request, payment due, dispute updated, report/support update and announcements are in the catalogue and tested; their triggers are wired in B6-B8. |
| 10 | Locked accounts | `afterAccountLocked` notifies the other participant of each accepted activity of a restricted, suspended or banned user (`PARTICIPANT_ACCOUNT_LOCKED`), without saying which action it was; the activity stays as it is (developer decision Q2). One per activity per account status. Account actions, suspension and restriction ends, student and rider verification results, rider suspend/reinstate and rider suspension end get in-app rows as well as their emails. |
| 11 | Reminders | `activity-reminder` 30 minutes before the start of an accepted ride, food or service request with a time. `carpool-session-reminder` at 07:00 Asia/Dhaka on the ride day, or 60 minutes before the start when that is earlier; sessions get no 30-minute reminder (Q4). Both participants, in-app + push. Not queued, and not sent by the job or the sweeper, when the activity was accepted after the reminder time; skipped unless still ACCEPTED and not started. Queued from `timerJobsFor`, so accepts and edits of OPEN items reschedule them. The sweeper sends a due reminder whose job was lost. |
| 12 | Licence reminders | Repeating `licence-reminder` job every hour: 30 and 7 days before the rider's current licence expiry (Asia/Dhaka), in-app + email, always sent (Q3); a first check at 7 days or fewer sends only the 7-day one. When the account-status job sets a rider Inactive because the licence expired, the rider gets `RIDER_ACCESS_CHANGED` (in-app + email, always sent). |
| 13 | Sub-area engine | `queueSubAreaNotification(activityId)` queues `sub-area-notify`; the job re-checks that the food or service request is still OPEN and its sub-area active, then notifies users who saved the sub-area, leaving out the creator, users blocked either way, users who are not VERIFIED and accounts not ACTIVE right now. Key `SUB_AREA_NEW_REQUEST:<activity>`, so an edit never notifies twice. B4 and B5 call it after creating a request. |
| 14 | Endpoints | `GET /api/notifications` (cursor `before`, 20 per page, in-app only), `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/push/config`, `PUT` and `DELETE /api/me/push-subscriptions` (20 saves per hour per account). Socket: `chat:viewing` from the client; `notification:new` and `notification:unread` from the server. |
| 15 | For B3 | Proposal §8.6 step 2 says riders get a sub-area/route notification for ride requests, but the §14 table lists sub-area notifications only for food and service requests. **Ask the developer in the B3 plan** whether ride requests (and offers) notify by sub-area. *Answered in B3a #1.* |

### B3a – Ride Sharing core (2026-11-07)

B3 is built in two parts: **B3a** (this) and **B3b**: Activity and Upcoming pages, reviews, profile stats and badges, payment records, the admin Ride Sharing module and the Rider Dashboard counters.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Sub-area notices for ride requests (Q1) | A new passenger request notifies **Active riders** who saved its sub-area (in-app + push), with the B2c exclusions (creator, blocked either way, not VERIFIED, not ACTIVE). Ride offers notify nobody. Added as a row to proposal §14. |
| 2 | Overlapping offers (Q2) | A new offer, or an offer moved to a new time, is refused (`TIME_CONFLICT`) less than 90 minutes from another OPEN or FULL offer of the same rider or from their ACCEPTED or IN_PROGRESS activities. The accept-time conflict rule (CLAUDE.md 5.5) is unchanged. |
| 3 | A rider's own open offer (addition 1) | A rider cannot accept a passenger request, or book a seat as a passenger, less than 90 minutes from one of their own OPEN offers: `OWN_OFFER_CONFLICT`, telling them to use "Stop new bookings" on that offer first. Unbooked offers never block other users. |
| 4 | Offers with bookings (Q3) | Before the first active booking everything can be edited. After it the details are locked (`OFFER_LOCKED`); the rider may only raise the seat count up to the vehicle's capacity. **Stop new bookings** closes the offer (`STOPPED_BY_RIDER`) and keeps the bookings. **Cancel offer** needs a reason, cancels every ACCEPTED booking through the engine with the rider as canceller (late cancellation per booking, each passenger notified) and closes it (`CANCELLED_BY_RIDER`); refused while a booking is IN_PROGRESS, completion-requested or DISPUTED (`OFFER_HAS_STARTED_BOOKINGS`). **Remove** is for an offer with no active booking (`REMOVED_BY_RIDER`, still counted in the daily limit). Migration `b3a_ride` adds `ride_offers.close_reason` (also `DEPARTED` and `ACCOUNT_MODERATED`). |
| 5 | Start Ride (Q4) | Allowed from 30 minutes before the start time (`START_TOO_EARLY` before that, `rules.ride.startAllowedBefore`), checked in the engine for ride requests and bookings. Proposal §8.6 updated. NOT_MARKED still closes it 6 h after the start. |
| 6 | Vehicle on accept (Q5) | The rider picks one of their own approved, active vehicles with `seatCapacity ≥ passengerCount` (`VEHICLE_NOT_USABLE`, `SEATS_EXCEED_CAPACITY`); the client preselects it when only one fits. Stored on `ride_requests.vehicle_id` and shown to the passenger through `toPublicVehicle()`. |
| 7 | Search (Q6) | Pickup and destination match within 1, 2 or 5 km (default 2) straight-line distance: a latitude/longitude box in SQL, then the exact distance. The date filter is the **Asia/Dhaka day** (addition 5); a time range without a date applies to every day. Up to 500 candidates per type are filtered, merged by time and paged 30 at a time. |
| 8 | Who sees what | Ride Sharing needs a VERIFIED student (`NOT_VERIFIED`); RESTRICTED accounts cannot create, accept or book but can see, cancel and finish what they have. Blocked users are left out of listings, details, accepts and bookings both ways. Only offers of Active riders are listed or bookable (`RIDER_NOT_AVAILABLE`). Your own items are listed and marked. |
| 9 | Privacy on shared offers (addition 2) | The rider sees every booking; a passenger sees only their own booking and the seats left, never other passengers' names, ids or bookings, and another passenger's booking page answers 404. Tested. |
| 10 | Booking | `createAcceptedActivity()` in the engine creates the booking already ACCEPTED in one READ COMMITTED transaction: both users locked, own offer, start passed, restricted, blocks, the rider still Active, **one active booking per passenger per offer** (`ALREADY_BOOKED`, checked with both users locked because sibling bookings skip the conflict check), own open offer nearby, seats by conditional update, then the 90-minute check. 1 seat by default, companions up to the seats left. |
| 11 | Booking amount (addition 3) | `ride_bookings.amount` = fare per seat × seats, stored when the booking is made; later seat or rate changes never alter it. B3b uses it for the payment record. |
| 12 | Amounts | Offered amount and fare per seat ৳10–৳1000 (`rules.ride.amount`); 1–4 passengers; notes up to 500 characters. |
| 13 | Suggested fare | OSRM driving distance (`OSRM_URL`, public server by default, 3 s timeout, cached per rounded points) × the newest admin rate per km: the total for a request, per seat for an offer, rounded to whole taka within ৳10–৳1000. No suggestion when OSRM fails or no rate is set; the forms still work. 20 estimates a minute per account (addition 4). The distance is stored on the request or offer. |
| 14 | Fare Settings | Super Admin only (`/admin/fare-settings`): rate per km ৳1–৳500, a new rate applies from now, history kept, every change in the Audit Log (`FARE_RATE_SET`). |
| 15 | Nominatim proxy | `/api/geo/search` and `/api/geo/reverse` (login needed): one queue for the whole server at most 1 request per second, 24-hour cache, Bangladesh only, a UniGo User-Agent without personal data, 30 a minute per account. The client geocoder now calls the proxy and keeps its session cache (A7 #8 updated). |
| 16 | Account lock | No change to `onAccountLocked()` beyond recording `ACCOUNT_MODERATED` on closed offers; tested through the ride API (offers closed, open requests cancelled, accepted bookings carry on, passengers notified). |
| 17 | Notification links | Ride notifications open `/ride/requests/<id>` or `/ride/bookings/<id>` (`notifications/link.ts`). |
| 18 | Endpoints | `GET /api/rides` (list), `/api/rides/config`, `/api/rides/fare-estimate`; requests: `POST /api/rides/requests`, `GET` and `PATCH /:id`, `POST /:id/upgrade`, `POST /:id/accept`; offers: `POST /api/rides/offers`, `GET` and `PATCH /:id`, `POST /:id/stop`, `POST /:id/cancel`, `DELETE /:id`, `POST /:id/bookings`; `GET /api/rides/bookings/:activityId`. Start, completion, cancelling a booking or accepted request and deleting an OPEN request use `/api/activities` (B2a). |
| 19 | Screens | `/ride` (map with pins *(removed in B3b-1 #5)*, list, tabs, filter sheet), `/ride/requests/new` and `/edit`, `/ride/offers/new` and `/edit`, detail pages for requests, offers and bookings with the steps that fit the status. Date-time fields show Asia/Dhaka wall time. Home and All Services link to Ride. Admin › Fare Settings. |

### B3b-1 – Activity, Upcoming, phone numbers, profiles and fixes (2026-11-07)

B3b is built in two parts: **B3b-1** (this: fixes from the developer's browser test, Activity and Upcoming moved forward) and **B3b-2**: reviews, profile stats and badges, payment records, the admin Ride Sharing module and the Rider Dashboard counters.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Activity (§12.2) | `GET /api/activity?feature=&role=&tab=&page=` (20 per page). Ride requests for the passenger (Requested by me) and the rider who accepted (Accepted by me); seat bookings for the passenger (Accepted); a rider's offers (Requested) with their bookings inside, never as separate items. Tabs: Active = OPEN, ACCEPTED, IN_PROGRESS, DISPUTED; Ongoing = IN_PROGRESS; History = COMPLETED, CANCELLED, EXPIRED, NOT_MARKED. An offer is Active while it can take bookings or a booking has not finished, Ongoing while a booking is in progress, History otherwise (Q2). Deleted requests are hidden (A2 #2). Active and Ongoing nearest first, History newest first. Carpool, Food and Service add their items in B4-B6 (their chips show "coming soon"). |
| 2 | Activity actions | By status (§12.2): OPEN → Edit (and raise amount or delete on the page); ACCEPTED / IN_PROGRESS → Start, Mark completed, Confirm (other user), Chat, Call, Cancel with reason (the same steps as the detail page); DISPUTED → status only, details with B7; terminal → View details and **Create again** (Q5): everything copied but the time, a sub-area that is no longer active left empty, a vehicle that is no longer approved replaced; the server checks the open and daily limits again on submit (addition 2). Leave review on COMPLETED comes in B3b-2. |
| 3 | Upcoming (§12.3) | `GET /api/upcoming?feature=&role=&limit=`: future ACCEPTED items, nearest first. A rider's offer is one card with its booked passengers while it has at least one ACCEPTED booking (Q1); an offer without one is not in Upcoming (addition 1). The nearest card shows a countdown updated every minute (addition 4). Home shows the next 3. |
| 4 | Live refresh (addition 3) | Activity, Upcoming and the Home section reload when a `notification:new` event about an activity arrives (the notification view now carries `activityId`) and when the tab becomes visible again. |
| 5 | Ride page without a map (fix E) | Business-rule change approved by the developer: the Ride page is a list of open requests and offers with filters; a map opens only inside the place picker. Proposal §8.1 and CLAUDE.md §6.3 updated; the B3a page map was removed. |
| 6 | Maps never cover other layers (fix F) | Cause: the B3a Ride page map had no stacking context, so Leaflet's layers (z-index up to 1000) covered sheets (50), toasts (60) and bars (10-20). Every map container isolates its stacking context (`isolation: isolate`, already on the place picker and Saved Addresses), and the layers moved to tokens above 1000: `--z-bar` 1100, `--z-tooltip` 1150, `--z-drawer` 1200, `--z-sheet` 1300, `--z-toast` 1400. A test checks the CSS. |
| 7 | Phone numbers (fix D) | Cause: the ride detail pages never returned a phone, and the chat header showed only a phone icon with the number hidden in its label. Now `users/contact.ts` gives the other participant's phone to the two participants while the activity is ACCEPTED, IN_PROGRESS or DISPUTED and nobody has blocked the other (B2b #9 unchanged): on request and booking details, on the rider's offer page for each passenger, in Activity items, and in the chat header as text plus Call. Email is never shown. |
| 8 | Opening items (fix C) | Ride notifications, the chat header's **View details**, Activity and Upcoming open the right detail page. The creator can always open their own request (even a deleted one) and offer, whatever its status. |
| 9 | Public profile (fix G) | `GET /api/users/:id/profile` (verified students only) and `/u/:id`: name, photo, university, department, batch, badges (Verified Student, Verified Rider), verified vehicles through `toPublicVehicle()`, member since, open ride requests and offers (offers only of Active riders), and empty rating, completion rate, late cancellation rate and reviews ("No reviews yet") until B3b-2. Never a phone or email. Blocked users either way and BANNED accounts answer `PROFILE_NOT_FOUND`; restricted and suspended accounts stay visible (Q3). Tapping a name or photo on ride cards, detail pages, the chat header and Activity opens it. |
| 10 | 12-hour clock | Every time is shown on a 12-hour clock with am/pm, in Asia/Dhaka (`hour12: true` in the client date helpers, admin pages and the server's email and notification dates). Time inputs are a date field plus hour (1-12), minute (5-minute steps) and AM/PM selects (`components/DateTimeInput.tsx`, Q4), because the browser's own box follows the device and may show 24-hour time; also used in the admin suspension and restriction dates. Proposal §3 updated. |
| 11 | Endpoints | `GET /api/activity`, `GET /api/upcoming`, `GET /api/users/:id/profile`; `phone` added to `GET /api/rides/requests/:id`, `/offers/:id` (each booking for the rider, `myBooking` for a passenger) and `/bookings/:activityId` (plus `rider`). |

### B3b-2 – Reviews, stats, payments, admin Ride Sharing, Rider Dashboard (2026-11-07)

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Blind reviews (§15.1) | `POST /api/activities/:id/review` (1-5 stars, comment up to 500 characters) by a participant of a COMPLETED activity, within 7 days of `completed_at` (Q5; for an auto-completed ride that is the auto-complete time). One per user per activity (`ALREADY_REVIEWED`); for an offer one per booking, so the rider reviews each passenger. Refused for CANCELLED, EXPIRED, NOT_MARKED (`REVIEW_NOT_ALLOWED`) and after the window (`REVIEW_WINDOW_CLOSED`). No edit or delete. `GET /api/activities/:id/reviews` returns the viewer's own review and the other one only once published and not hidden. |
| 2 | Publishing | A review is published when both participants have reviewed (at once, in the request) or when the 7 days end (`review-publish` job queued on completion, and the sweeper). Conditional on `published_at` being empty, so it runs safely twice. Each reviewee gets an in-app notification `REVIEW_PUBLISHED` (Q1, new §14 row; no push or email) opening their profile. |
| 3 | Hiding reviews | `POST /api/admin/reviews/:id/hide` with a reason (3-500 characters), audited (`REVIEW_HIDDEN`); a hidden review leaves every user view and every average. Moderators and Super Admins (Q3). |
| 4 | Profile stats (Q2) | For a person's profile only (`users/stats.service.ts`): accepted = finished accepted activities, i.e. COMPLETED plus CANCELLED by the person; NOT_MARKED, still running ones and cancellations by the other user, the system or an admin are left out. Completion rate = completed ÷ accepted; late cancellation rate = the person's late cancellations ÷ accepted; rating = average of published, not hidden reviews with their count. "New" below 5 accepted (rates) or 3 reviews (rating). Counted from the common `activities` table (carpool bookings excluded, their sessions count), so Food, Service and Carpool join automatically. |
| 5 | Platform KPI | Proposal §22.1 keeps completed ÷ accepted (excluding NOT_MARKED) across the platform, every accepted activity counted whoever cancelled it; it is a different figure from the profile completion rate. Both definitions are written in the proposal (§15.2 and §22.1). |
| 6 | Badges | Verified Student, Verified Rider, Top Rated (average ≥ 4.5 from ≥ 5 reviews), Reliable (completion rate ≥ 90%, late cancellations < 10%, ≥ 10 accepted). A late cancellation rate ≥ 10% shows a warning on the profile (§15.3). Every threshold is in `rules.stats`. Stats and badges are on profiles, ride cards, detail pages and Activity (`fillPersonStats()` fills every mini profile of an answer in one batch). |
| 7 | Payment records (§16) | Created on acceptance in the same transaction, from the stored amount: the request's offered amount, or the booking's amount (B3a #11). `payment_records.payee_id` (migration `b3b2_reviews_payments`, with a backfill for rides accepted before) is who receives the money, the rider for rides. Either participant picks the method (Cash, bKash, Nagad) while UNPAID (`PATCH /api/activities/:id/payment`); only the payee marks it PAID (`POST …/payment/paid`, `NOT_PAYEE`), after a method is chosen (`PAYMENT_METHOD_REQUIRED`), in any status after acceptance except CANCELLED (`PAYMENT_NOT_DUE`). PAID is final for users (Q4). Shown on detail pages and Activity items. Written after the item is taken (`afterTake` in `acceptActivity`), so a lost accept race writes nothing. |
| 8 | Admin Ride Sharing (§17) | `/api/admin/rides` and `/admin/rides`: requests, offers and bookings with status, person and Asia/Dhaka day filters; details with both people (email and phone, admins only), the full vehicle number, payment record, reviews (hidden ones marked) and the full status history. Admin cancel needs a reason (3-500 characters): requests and bookings through the engine's `ADMIN_CANCEL`, offers closed as `ADMIN_REMOVED` with every unfinished booking cancelled; both participants notified (B2c), the reason kept in the status history and the Audit Log (`RIDE_CANCELLED_BY_ADMIN`, `RIDE_OFFER_CANCELLED_BY_ADMIN`), users see "cancelled by UniGo". Moderators and Super Admins (Q3, proposal §17: Moderators handle requests and content). |
| 9 | Rider Dashboard (§6) | On the rider's side of rides (requests they accepted and bookings on their offers): total rides, accepted (still running), completed, cancelled, completion rate and late cancellation rate (profile rules), the overall rating, and the earnings record = sum of PAID ride payments the rider received. Carpool counters stay 0 until B6. |
| 10 | For B7: payments | **Open item:** admin correction of a wrong PAID mark (users cannot undo PAID). |
| 11 | For B7: chats | Admins may read the chat of a **DISPUTED** activity only, and every such view is written to the Audit Log. Until B7 chats stay private to admins (the admin ride page says so). |
| 12 | Endpoints | `GET /api/activities/:id/reviews`, `POST /api/activities/:id/review`, `GET` and `PATCH /api/activities/:id/payment`, `POST /api/activities/:id/payment/paid`, `GET /api/users/:id/reviews`, `GET /api/admin/rides`, `GET /api/admin/rides/activities/:id`, `GET /api/admin/rides/offers/:id`, `POST /api/admin/rides/activities/:id/cancel`, `POST /api/admin/rides/offers/:id/cancel`, `POST /api/admin/reviews/:id/hide`. |

### B4 – Food Delivery (2026-11-08)

Authored by Shawon Sarkar on branch `shawon/b4-food`; for this step only the developer approved this author and branch in place of section 0 (section 0 itself is unchanged).

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Over budget (Q1) | Compared with the **confirmed food price**, not the estimated budget. The accepter sends an approval card in the chat (`POST /api/food/requests/:id/budget-approvals`, only after ORDER_CONFIRMED, one PENDING at a time, amount above the confirmed price). The requester approves or rejects it once; the decision, who and when are stored in `food_budget_approvals`. Approving raises the confirmed price and keeps ORDER_CONFIRMED (the approval is the requester's confirmation); rejecting changes nothing. A pending approval is WITHDRAWN when the order changes or the receipt is uploaded. A receipt above the confirmed price is refused (`OVER_BUDGET_APPROVAL_REQUIRED`). Proposal §10.4 updated. |
| 2 | Notifications (Q2) | Three new §14 rows, in-app + push: `FOOD_ORDER_TO_CONFIRM` (other participant, once per order version), `FOOD_BUDGET_APPROVAL_REQUESTED` (requester), `FOOD_BUDGET_APPROVAL_DECIDED` (accepter). The approval card itself sends no "new chat message" notification. Food notifications open `/food/requests/<id>`. |
| 3 | Marking PAID (Q3) | The payee is the accepter (who buys the food). Only the payee marks PAID, from ORDER_CONFIRMED onwards (students often pay by bKash before buying), never when CANCELLED. For food the payment method is part of the order details, so `PATCH /api/activities/:id/payment` answers `USE_ORDER_DETAILS`. |
| 4 | Search (Q4) | Two radius filters, near the restaurant and near the delivery location, 1, 2 or 5 km (default 2, `rules.food.searchRadiusKm`), plus the Asia/Dhaka day and a sub-area; alone or together; no filter shows all. Blocked users are left out both ways. No map on the list (B3b-1 #5). |
| 5 | Upgrade (Q5) | "Upgrade" before acceptance raises the offered delivery charge (`AMOUNT_NOT_HIGHER` otherwise). Everything else, the budget included, is changed with a normal edit while OPEN. |
| 6 | After the receipt (Q6) | Only the accepter can cancel once FOOD_COLLECTED (two engine rules: food CANCEL by either side from ACCEPTED, by the ACCEPTER only from IN_PROGRESS/FOOD_COLLECTED; reason required, late flag as usual). The requester uses Report (B2b) until complaints arrive with B7. `findRule()` now picks the rule that starts from the current state, so one action may have several rules per feature, never two from the same state (unit-tested). |
| 7 | Order confirmation | Either participant saves items, food price, delivery charge and payment method (`PUT …/order`); saving counts as the saver's confirmation and clears the other's, and `order_version` goes up. The other confirms with `POST …/order/confirm { version }`; an old version answers `ORDER_CHANGED`. When both have confirmed: `CONFIRM_ORDER` → ORDER_CONFIRMED. Any change after that runs the new engine action `REOPEN_ORDER` (ORDER_CONFIRMED → no sub-status) and needs confirming again. Saving the same details again is a confirmation. The details lock at the receipt (`ORDER_LOCKED`) or once the payment is PAID (`ORDER_PAID`). Every step locks the activity row first. |
| 8 | Receipt | `POST …/receipt`, multipart (`receipt` JPG/PNG ≤ 5 MB, first bytes checked, re-encoded with the B2b chat-image rules, no EXIF, stored in `food-receipts/`) and `actualCost`. Accepter only, only from ORDER_CONFIRMED, → `COLLECT_FOOD` (FOOD_COLLECTED, IN_PROGRESS). Food still has no Start; the receipt is the only way to IN_PROGRESS. The photo is also posted in the chat. Participants see it through 10-minute signed links, admins through 5-minute links. |
| 9 | Payment record | Created on accept (`afterTake`, so a lost race writes nothing) with the estimate: food cost = estimated budget, delivery charge = offered charge (0 when none), amount = their sum. While UNPAID it follows the confirmed order, an approved higher price and the receipt's actual cost; once PAID it no longer changes. |
| 10 | Limits | Food budget, confirmed price, approval amount and receipt cost ৳10–৳5,000; delivery charge 0 or ৳10–৳1,000; quantity 1–20; restaurant name 150, items and details 1000 characters (`rules.food`). Expected delivery time 15 minutes to 24 hours ahead (`rules.creationWindow`), and it is the activity's start: an OPEN request expires at it. No grace period (B3a-1 comes later). |
| 11 | Accepting | Any VERIFIED student on an ACTIVE account through `acceptActivity()`: not their own (`OWN_ITEM`), not blocked either way (`NOT_AVAILABLE`), 90-minute conflict for both (`TIME_CONFLICT`), start not passed; the atomic take answers `ALREADY_TAKEN` to the loser of a race (tested with two at once). Open and daily limits and the sub-area notification (B2c engine, its exclusions tested for food) apply on creation. |
| 12 | Chat | New message kind `APPROVAL` with `messages.ref_id` (the approval); the card shows its current state. New system codes `ORDER_UPDATED`, `ORDER_CONFIRMED`, `BUDGET_APPROVED`, `BUDGET_REJECTED`. Migration `b4_food`. |
| 13 | Activity, Upcoming, Home | Food items join `/api/activity` and `/api/upcoming` (merged by time with rides); My Orders and Accepted Orders on `/food` are the Activity feed with `feature=food`. All Services and Home open `/food`. `onAccountLocked()` already covered food (OPEN requests cancelled, accepted ones carry on, the other participant told); now tested through the food API. |
| 14 | Admin Food | `/api/admin/food` and `/admin/food` for Moderators and Super Admins: list with status, person or restaurant and Asia/Dhaka day filters; detail with both people (email and phone), the order, approvals, receipts, payment (food cost and delivery charge), reviews and the full status history; cancel with a reason through `ADMIN_CANCEL` (Audit Log `FOOD_CANCELLED_BY_ADMIN`, users see "cancelled by UniGo"). No-Show reports come in B7. |
| 15 | Endpoints | `GET /api/food`, `/api/food/config`; `POST /api/food/requests`, `GET` and `PATCH /:id`, `POST /:id/upgrade`, `POST /:id/accept`, `PUT /:id/order`, `POST /:id/order/confirm`, `POST /:id/budget-approvals`, `POST /:id/budget-approvals/:approvalId/approve` and `/reject`, `POST /:id/receipt`; `GET /api/admin/food`, `GET /api/admin/food/:id`, `POST /api/admin/food/:id/cancel`. Cancel, completion and delete use `/api/activities` (B2a); payment and reviews the B3b-2 endpoints. |

### B6a – Carpool posts, booking requests, contracts and sessions (2026-11-08)

Authored by Shawon Sarkar on branch `shawon/b6-carpool`; for this step only the developer approved this author and branch in place of section 0 (section 0 itself is unchanged). Carpool is built in two parts: **B6a** (this) and **B6b**: session marking, monthly payments, cancellation history, admin warn/suspend carpool access, early termination, the block rule, contract-end reviews and Renew, Rider Dashboard carpool counters, the admin Carpool module and `onAccountLocked` for carpool.

| # | Topic | Decision |
| --- | --- | --- |
| 1 | Seat hold (Q1) | The hold ends 24 hours after the rider accepts, or at the **first session's departure** if that is sooner (`carpool_bookings.hold_expires_at`). Job `carpool-hold-release` (`RELEASE_HOLD`, closure `SEAT_HOLD_EXPIRED`) gives the seat back; it re-reads the hold, so it runs safely twice; the sweeper releases holds whose job was lost. |
| 2 | Start date (Q2) | From tomorrow (Asia/Dhaka), inside the post's dates, and on **one of the post's ride days** (`START_DATE_TOO_SOON`, `START_DATE_OUTSIDE_POST`, `START_DATE_NOT_A_RIDE_DAY`). |
| 3 | Unanswered requests (Q3) | A booking request is a `CARPOOL_BOOKING` activity, OPEN, created by the passenger (accepter) on the rider's post (creator, A2 #7), its start = the first session. It **expires at the first session** (new `EXPIRING_TYPES`; not in `OPEN_REQUEST_TYPES`, so never in the open and daily limits) and the passenger gets "Request expired". New requests on a FULL post are refused (`POST_FULL`); pending ones stay. One OPEN request, held seat or contract per passenger per post (`ALREADY_BOOKED`). The passenger can withdraw while OPEN. |
| 4 | Contract months (Q4) | Month *k* starts on the start date's day of the month, moved back to the last day of a shorter month (31 Jan → 28/29 Feb → 31 Mar); the contract ends on start + N months − 1 day (10 Nov – 9 Dec is month 1). A duration that would end after the post's last day is refused (`CONTRACT_PAST_POST_END`). `carpool/carpool-dates.ts` holds every date rule (unit-tested). |
| 5 | Limit and overlap (Q5) | At most **12** live posts per rider (`SCHEDULE_LIMIT_REACHED`): OPEN or FULL (paused ones too) plus CLOSED ones that still hold a seat. Two of a rider's posts overlap (`SCHEDULE_OVERLAP`) when they share a ride day with departures less than 90 minutes apart (on the weekly clock, so across midnight too) and their validity periods meet. The rider's row is locked while checking. |
| 6 | Stop new bookings (Q6, changed) | A **pause flag** (`carpool_posts.paused_at`), not CLOSED: the status stays OPEN or FULL, so a released seat still reopens it. Paused posts are not listed and take no new requests or accepts (`POST_PAUSED`); pending requests stay. Resume while not CLOSED. CLOSED is final (`close_reason`: REMOVED_BY_RIDER, ENDED, ACCOUNT_MODERATED, ADMIN_REMOVED). Migration `b6a_carpool`. |
| 7 | Editing (Q7) | Everything can be edited while nobody holds a seat or has a contract; saving rejects the pending requests (closure `POST_CHANGED`, passengers get "request declined"). After a seat is held: only "add seats" (up to the vehicle's capacity), pause and resume (`POST_LOCKED`). Remove (CLOSED, REMOVED_BY_RIDER) is refused while a seat is held or a contract runs (`POST_HAS_CONTRACTS`); pending requests are rejected (`POST_REMOVED`). |
| 8 | Limits (Q8) | Monthly price ৳100–৳10,000 per offered duration, at least one duration; first valid day today to 60 days ahead; last day optional, on or after the first and long enough for the shortest duration offered (`VALIDITY_TOO_SHORT`); notes 500 and reject reason 500 characters (`rules.carpool`). A post closes at the midnight after its last day (`carpool-post-close` job, sweeper backup). |
| 9 | Who can act (Q9) | Posts: Active riders with an approved vehicle (BIKE 1 seat, CAR 1–4, within the vehicle's capacity). Accept and Agree: the rider must still be Active with the vehicle approved (`RIDER_NOT_AVAILABLE` to the passenger); both accounts ACTIVE (`ACCOUNT_RESTRICTED`); no block either way (`NOT_AVAILABLE`). Only OPEN, not paused, still valid posts of Active riders are listed. |
| 10 | Contract end (Q10) | At 00:00 Asia/Dhaka after the end date, `carpool-contract-end` sets the booking COMPLETED (`END_CONTRACT`) and the contract ENDED; the engine gives that one seat back (sweeper backup). Profile stats and the completion rate count carpool **sessions only**, never `CARPOOL_BOOKING` or contracts (tested). Reviews and Renew: B6b. |
| 11 | Agree (Q11, changed) | Each side presses Agree once while the seat is held (`HOLD_EXPIRED` after, `ALREADY_AGREED` twice); no "un-agree". The first Agree writes the chat line `CONTRACT_AGREED` and notifies the other person **in-app + push**: "<name> agreed — your turn, the hold ends at <time>" (new §14 row `CARPOOL_AGREE_REQUESTED`). The second re-checks everything, creates the contract (`CONTRACT_ACTIVE`, chat line `CONTRACT_ACTIVE`, "contract created" to both) and its sessions in one transaction. Price, duration and start date are fixed by the request. |
| 12 | Conflicts | The B2a multi-slot check runs for **both people** over every session start at the rider's accept and again at the second Agree, in the post's conflict group; a clash answers `TIME_CONFLICT` with `dates` (Asia/Dhaka, at most 30) and `total`, and nothing is held or created. Held seats do not block time; sessions do. |
| 13 | Sessions | One ACCEPTED `CARPOOL_SESSION` activity per ride day of the contract (rider = creator, passenger = accepter, conflict group = post), written in bulk with app-made UUID v7 ids (`utils/uuid.ts`). Sessions post into the booking's chat. Marking sessions: B6b. |
| 14 | Session timers (developer) | NOT_MARKED and ride-day reminder timers are queued only for sessions in the **next 7 days** (`rules.carpool.sessionTimerWindow`). The repeating daily job `carpool-session-timers` queues the following days; job ids are deterministic, so nothing is queued twice. A lost run loses nothing: the sweeper closes NOT_MARKED sessions and sends missed ride-day reminders by itself. |
| 15 | Activity and Upcoming (Q12) | Activity: a rider's posts under Requested by me with their requests and contracts inside (Active while not CLOSED or a booking is unfinished, never Ongoing, History otherwise); a passenger's requests, held seats and contracts under Accepted by me, by status. Upcoming: ACCEPTED sessions in the next 7 days; the rider sees one card per post and ride time with its passengers. |
| 16 | Screens | `/carpool` (Search with day, time, pickup and destination 1/2/5 km filters; My carpool posts for riders; My bookings), `/carpool/posts/new` and `/:id/edit`, `/carpool/posts/:id` (rider mini profile, stats, masked vehicle, rider's session cancellations, prices; the rider's requests with Accept/Decline; the passenger's request form with a server quote), `/carpool/bookings/:id` (hold, Agree, give up the seat, sessions). Open carpool posts on the public profile. Carpool notifications open the booking page. No map on lists. |
| 17 | Endpoints | `GET /api/carpool` (search), `/api/carpool/config`; posts: `POST /api/carpool/posts`, `GET` and `PATCH /:id`, `POST /:id/seats`, `/:id/pause`, `/:id/resume`, `DELETE /:id`, `GET /:id/quote`, `POST /:id/bookings`; bookings: `GET /api/carpool/bookings/:activityId`, `POST /:activityId/accept`, `/reject`, `/withdraw`, `/agree`. Giving up a held seat uses `POST /api/activities/:id/cancel`. |
