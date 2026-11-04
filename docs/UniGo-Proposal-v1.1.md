# UniGo: Product Proposal & Feature Workflow (v1.1)

University Capstone Project · Version 1.1 · Nov 3, 2026 · Mukit

## 1. Overview

UniGo is a peer-to-peer platform where verified university students share rides, join recurring carpools, ask others to bring food, and request help with daily tasks. Every person is a User. Some users become admin-verified Riders and can also drive. Version 1.1 supports students from multiple universities.

### Problem statement

Students travel the same routes at the same times every day, yet most travel alone or depend on expensive, unpredictable transport. Small daily needs (food from outside campus, a parcel, a document from an office) also cost time that a nearby student could save. General ride-hailing and delivery apps serve the public, so they offer no student-only trust, no recurring campus carpools, and no way to ask a fellow student for a small favour.

### Objectives

1. Build a student-only platform where every user is a verified student and every driver is an admin-verified rider.
2. Provide four services in one app: Ride Sharing, Carpool, Food Delivery and Uni Service.
3. Make every activity traceable through one common status lifecycle, history, ratings and an admin audit log.
4. Keep the platform safe through verification, blind reviews, complaint handling and abuse limits.
5. Deliver a responsive Progressive Web App that works like a mobile app on phones.

### Product goals

- **Simple:** one clear action per screen, Pathao-style cards and bottom navigation.
- **Trusted:** only verified students can use services, and riders and their vehicles are verified by an admin.
- **Fair and flexible:** every user can request and accept food and service tasks; riders unlock driving features.
- **Transparent:** clear statuses, history, ratings and an admin audit log.

UniGo only matches students and records activity. It does not process payments in version 1.

## 2. What changed in version 1.1

Version 1.1 removes the conflicting rules of v1.0 and adds trust, safety and technical sections needed to build the system.

| Area | v1.0 | v1.1 |
| --- | --- | --- |
| Ride confirmation | Both press Confirm; 2-hour auto-cancel | Single confirmation: acceptance is the confirmation |
| Ride offer seats | One accepter per offer | Seat-based booking; Bike = 1 seat, Car = up to 4 |
| Carpool seats | One passenger per schedule | One post per schedule, 1–4 seats, one contract per passenger, FULL status |
| Statuses | Different names per feature | One common lifecycle plus feature sub-statuses |
| Completion | Either person marks Completed | Two-step completion, 24-hour auto-complete, Dispute option |
| Unmarked activities | Not defined | Auto-closed as NOT_MARKED 6 hours after start |
| Time conflicts | Only inside ride and inside carpool | One central check across all features, 90-minute window |
| Universities | Single university implied | Multi-university with email OTP or ID-card verification |
| Rider trust | Profile and rating | Verified vehicle details shown before booking |
| Notifications | In-app only | In-app, Web Push (PWA) and email fallback |
| Food money risk | Discussed in chat | Order confirmation, receipt image, No-Show report |
| Carpool payment | Full amount upfront | Monthly payment record per contract |
| Sub-areas | User-created | Admin-managed master list with search |
| Abuse | Report and block | Open-request limit, daily limit, chat rate limit, block rules |
| Contact privacy | Number and email shared | Number shared after acceptance; email stays private |
| Reviews | Visible immediately | Blind reviews, 7-day window |
| Disputes | Support request only | DISPUTED status and admin resolution workflow |
| Extras | — | bKash/Nagad/Cash records, Bangla/English UI, suggested ride fare |
| Build plan | Rider verification in Phase 4 | Basic rider verification moved to Phase 2; MVP priorities set |

## 3. Design direction (Pathao-inspired, minimal)

| Area | Guideline |
| --- | --- |
| Layout | Mobile-first. Phone: top bar + bottom tab bar. Desktop: top navbar only, content centred (about 1100 px wide). |
| Color | Light, clean backgrounds, one brand accent color (blue, matching the logo), dark text. Status colors only on small chips: green = completed, amber = open/pending, indigo = accepted, purple = in progress, red = cancelled/disputed, grey = expired/not marked. |
| Typography | One clean sans-serif font (for example Inter, with a Bangla-supporting font such as Hind Siliguri). Only three text sizes: title, body, caption. |
| Cards | Rounded corners (12–16 px), thin border or very light shadow, big tap area, icon + short label. |
| Icons | One outline icon set (for example Lucide). Each service card on Home has one picture of its service; no other heavy illustrations. |
| Forms | One column, short forms. Date, time and location pickers open as bottom sheets. Primary button sticks to the bottom on phones. |
| Feedback | Skeleton loaders, friendly empty states, small toast messages, confirm dialog before delete or cancel. |
| Language | Bangla and English UI, selected from Settings. |
| Accessibility | Touch targets at least 44 px, readable contrast in both light and dark themes. Light is the default theme; users can choose Light, Dark or System in Settings. |

## 4. Users, roles and verification

Every Rider is a User, but not every User is a Rider. A Rider can drive in one activity and be a passenger in another. Only verified students can use the main services.

| Action | Guest | Verified User | Verified & Active Rider | Admin |
| --- | --- | --- | --- | --- |
| See home page, spotlight, about us | Yes | Yes | Yes | Yes |
| Create passenger ride request | No | Yes | Yes | — |
| Book a ride offer seat | No | Yes | Yes | — |
| Offer a ride | No | No | Yes | — |
| Accept a passenger ride request | No | No | Yes | — |
| Create carpool schedule | No | No | Yes | — |
| Book a carpool seat | No | Yes | Yes | — |
| Create / accept food request | No | Yes | Yes | — |
| Create / accept service request | No | Yes | Yes | — |
| Apply to become a Rider | No | Yes | — | — |
| Manage users, riders, content, reports, disputes | No | No | No | Yes |

A Guest can look around, but any action (create, accept, book) sends them to login or register. A registered but unverified user can complete their profile and verification only.

### Registration

Name, phone number, email and university are required. Student ID, department, batch, location and sub-areas are added in the profile. Google sign-in is also supported. The user selects their university from an admin-managed list.

The default language is detected from the browser (English if it is not Bangla). The user's choice is saved to the account.

Password rules: 8–72 characters with at least one letter and one number. Phone numbers must be Bangladesh mobile numbers (01XXXXXXXXX, +8801… or 8801…); they are stored as +8801XXXXXXXXX and must be unique, like email.

### Multi-university support

UniGo serves students from multiple universities. Verified students from different universities can see and use each other's rides, carpools, food and service requests. Each profile shows the student's university and verification status.

### Student verification

1. **University email:** students with an official university email verify it with an email OTP or a verification link. Each university in the list stores its allowed email domains.
2. **Student ID card:** students without an official email upload a photo of their ID card. An admin reviews it and approves or rejects it with a reason.
3. Until verified, the user cannot create, accept or book anything.

Verification states: UNVERIFIED, PENDING, VERIFIED, REJECTED.

One university email can verify only one account.

### Forgot password

1. On the login page the user taps Forgot password and enters their registered email.
2. The system always shows the same message ("If this email is registered, a reset link has been sent"), so it never reveals which emails exist.
3. The email contains a single-use reset link (or 6-digit code) that expires in 15 minutes.
4. The user sets a new password that meets the password rules.
5. All existing sessions are logged out and the user receives a "password changed" email.

Reset requests are rate-limited (for example 3 per hour per email). Google-only accounts can use the same flow to set a first password.

## 5. App layout, Home and Account

### Navigation

- **Phone top bar:** UniGo logo on the left; notification bell and account icon (Account & Settings) on the right.
- **Phone bottom tab bar:** Home, Activity, Upcoming, All Services, Inbox. The active tab is highlighted and Inbox shows an unread badge.
- **Desktop top navbar:** logo on the left; Home, Services, Upcoming, Activity, Inbox, Notifications, Account & Settings on the right.

Each feature has its own page: Ride, Carpool, Food, Service. Other pages: Home, All Services, Activity, Upcoming, Inbox, Notifications and the Account & Settings sub-pages.

### Home / Dashboard

1. **Feature cards:** Ride, Carpool, Food, Service. Phone shows 2 × 2; desktop shows 1 × 4. Each card has an icon, name and one-line hint.
2. **Upcoming:** the next 3 accepted activities, nearest first, with a See all link. Empty state: a short message and a button to All Services.
3. **Quick actions:** a sideways-scrolling row: About Us, Saved Addresses, Add Home, My Sub-Areas, Promos, Drive with UniGo, Support, Rate Us.
4. **UniGo Spotlight:** admin-created story cards (picture or video) for offers, events and news. Full-screen swipe viewer, optional expiry date, optional link button, seen/unseen ring.

### Account & Settings

| Menu | What it does |
| --- | --- |
| Profile | Name*, phone*, email*, university*, student ID, department, batch, location, profile photo, verification status. Edit info, change password. Google-only accounts can set a password later. |
| Verification | Verify university email by OTP, or upload Student ID card for admin review. |
| Drive with UniGo | Rider and vehicle registration (section 6). Once approved, shows the Rider Dashboard and the Active/Inactive switch. |
| Saved Addresses | Home, hall, work and custom places, used to prefill forms. |
| My Sub-Areas | Search and select sub-areas from the admin master list; add or remove at any time. |
| Payment Methods | Information only: Cash, bKash, Nagad are recorded per activity. No online payment in v1. |
| Notifications | Turn Web Push on or off; email fallback preferences. |
| Language | Bangla or English. |
| Appearance | Light, Dark or System theme. System follows the device setting; the choice is saved to the account. |
| Blocked Users | View and unblock users. |
| Promos | Active offers with start and end date. |
| Support Request | Category, message and optional screenshot; track the status of each request. |
| Policy | Terms, privacy, safety and cancellation rules. |
| Rate Us | Quick in-app rating and feedback, stored as a support request (category: App Feedback). |
| Log out | Ends the session. |

Social media logos linking to UniGo pages sit at the bottom.

## 6. Drive with UniGo (rider and vehicle verification)

Only admin-approved, Active Riders can offer rides, accept passenger requests and create carpool schedules.

**Workflow:** verified user opens the page → reads requirements → fills the form and uploads files → submits → status PENDING → admin reviews → APPROVED (Rider badge and rider tools) or REJECTED (reason shown; the user can fix and re-apply).

**Form:** NID front and back, driving licence (car) and/or motorcycle licence, licence expiry date, and one or more vehicles. Each vehicle has type (BIKE or CAR), brand, model, colour, registration number, vehicle photo and passenger seat capacity (BIKE = 1, CAR = 1–4).

### Rules

- Documents are private. Only authorised admins can open them. Accepted files: JPG, PNG, PDF up to 5 MB.
- Vehicle details must be verified by the admin before they are shown to students.
- An approved Rider can switch Active / Inactive. Only Active Riders appear in matching and can accept requests.
- The admin can suspend a Rider at any time.
- Advanced controls (Phase 4): licence expiry reminders and re-verification, verification history, rider deactivation.
- Vehicle registration numbers are unique: the same vehicle cannot be registered by two riders.

### What students see before booking

Before booking any ride or carpool seat, a student sees the Rider's name, profile picture, Verified & Active Rider badge, verification status, rating and completion rate, and the vehicle's type, brand, model and a partially masked registration number (for example Dhaka Metro-LA 12-••34).

### Rider Dashboard

Total rides, accepted, completed, cancelled, completion rate, late cancellation rate, rating, active carpool contracts, carpool session cancellation history and earnings record.

## 7. Common activity rules (all features)

Ride Sharing, Carpool, Food and Service share one status lifecycle, one completion process and one time-conflict check, all enforced by the backend.

### 7.1 Unified status lifecycle

Main flow: OPEN → ACCEPTED → IN_PROGRESS → COMPLETED.

| Status | Meaning | Terminal |
| --- | --- | --- |
| OPEN | Available for acceptance or booking | No |
| ACCEPTED | Accepted or booked by another user | No |
| IN_PROGRESS | The activity has started | No |
| DISPUTED | A complaint or completion dispute is under admin review | No |
| COMPLETED | Finished and verified (by the other user or the 24-hour rule) | Yes |
| CANCELLED | Cancelled by an authorised user or admin | Yes |
| EXPIRED | Nobody accepted before the validity period ended | Yes |
| NOT_MARKED | Accepted, but nobody updated it within 6 hours of the start | Yes |

Feature sub-statuses add detail without changing the lifecycle: Ride `RIDE_CONFIRMED`; Carpool `CONTRACT_ACTIVE`; Food `ORDER_CONFIRMED`, `FOOD_COLLECTED`; Service `SERVICE_DELIVERED`; all features `COMPLETION_REQUESTED`. Parent posts (ride offers, carpool posts) have their own post status (OPEN, FULL, CLOSED), separate from each booking or contract status.

The backend must reject any transition not allowed for that feature and any change by a user who is not a participant.

### 7.2 Single confirmation

The acceptance itself is the confirmation. When a request is accepted or a seat is booked, the status becomes ACCEPTED immediately and both users are notified. There is no second confirm step, no confirmation deadline and no confirm auto-cancel. After acceptance, either side can cancel with a reason (section 15).

### 7.3 Two-step completion and disputes

1. Either participant marks the activity completed when it has actually finished (sub-status COMPLETION_REQUESTED).
2. The other participant is notified and can confirm completion or raise a dispute.
3. On confirmation, the status becomes COMPLETED.
4. With no response within 24 hours, the system marks it COMPLETED automatically.
5. A dispute raised inside the 24 hours stops auto-completion; the status becomes DISPUTED until an admin resolves it.

A dispute needs a reason; evidence images are optional. The admin decides the final status. Neither participant can finalise completion alone. Exception: carpool sessions are marked Completed or Cancelled in one step (section 9.3). Problems with a session go through a complaint.

### 7.4 Automatic closure (NOT_MARKED)

- If an activity is still ACCEPTED 6 hours after its scheduled start, the system closes it as NOT_MARKED and notifies both users.
- NOT_MARKED activities leave Active and Upcoming and move to Activity History.
- IN_PROGRESS, COMPLETED, CANCELLED, COMPLETION_REQUESTED and DISPUTED activities are never auto-closed by this rule.
- The system stores `auto_closed_at` and `closure_reason` for auditing.
- NOT_MARKED is not COMPLETED, CANCELLED or EXPIRED, and it does not count against anyone's completion rate.

### 7.5 Global time-conflict rule

- Every accepted activity blocks a 90-minute window: start_time to start_time + 90 minutes. No end_time field is needed.
- Before an accept or a booking, the system checks both participants across Ride, Carpool sessions, Food and Service.
- Only ACCEPTED and IN_PROGRESS activities create conflicts.
- A new activity is rejected if its window overlaps an existing active window.
- The check runs inside the same database transaction as the accept, so two simultaneous bookings cannot both pass.
- A service request with only a preferred date (no time) is excluded from the conflict check. For expiry, NOT_MARKED and Upcoming ordering, its effective start is the end of the preferred date (23:59, Asia/Dhaka).

### 7.6 Time limits for creating requests

| Feature | Earliest start | Latest start |
| --- | --- | --- |
| Ride request / offer | 15 minutes from now | 48 hours from now |
| Food request (expected delivery) | 15 minutes from now | 24 hours from now |
| Service request (preferred date/time) | 15 minutes from now | 7 days from now |
| Carpool booking start date | Tomorrow | Rider-defined, any date within the schedule |

Pickers disable invalid times, and the server repeats every check. An OPEN item that reaches its start time without an accepter becomes EXPIRED.

### 7.7 Editing and safe acceptance

- Before acceptance the creator can edit, upgrade (raise the offered amount) or delete. After acceptance details are locked; only cancellation is allowed.
- Nobody can accept or book their own post.
- Every accept/book uses an atomic update that succeeds only if the item is still OPEN (or a seat is still free). If not, the user sees "Already taken".
- Deleting a request is a soft delete: the record is kept for limits and auditing but hidden from users.

## 8. Ride Sharing

Ride Sharing has two post types: a passenger request (one-to-one) and a rider's ride offer (seat-based, several passengers).

### 8.1 Options

| Option | Who | What it does |
| --- | --- | --- |
| Need a Ride | Any verified user or rider | Form: pickup, destination, date, pickup time, offered amount, number of passengers, notes (optional), map. Creates a passenger request, sub-area. |
| Search a Ride | Any verified user or rider | Lists open ride offers. Filters: pickup, destination, date, time range, sub-area. Filters can be used one at a time or combined. |
| Offer a Ride | Verified & Active Riders | Pickup, destination, date, time, fare per seat, vehicle (BIKE or CAR), available seats, notes, sub-area (optional). Creates a ride offer. |

With no option selected, the Ride page shows the map and all open requests and offers, with filters. No filter means show everything.

### 8.2 Suggested fare

The system calculates the route distance from pickup and destination and shows a suggested fare (rate per km set by the admin). It is a recommendation only; the user sets the final amount.

### 8.3 Ride card

Route, date and time, amount, seats left, and a mini profile: name, photo, university, department, rating, completion rate, badges. Ride offers also show the verified vehicle (type, brand, model, masked registration number). Tapping opens the full profile with the person's open rides and carpool posts.

### 8.4 Seat rules for ride offers

- BIKE: exactly 1 passenger seat. CAR: 1–4 passenger seats (initial system limit). The rider is not counted.
- The system validates seats against the selected vehicle type and that vehicle's verified capacity.
- Each booking reserves 1 seat by default; a passenger may reserve extra seats for companions up to the seats left.
- Each booking has its own status, chat, completion and review. The offer becomes FULL when no seats are left and returns to OPEN if a booking is cancelled.

### 8.5 Who can accept what

- **Passenger request:** only a Verified & Active Rider whose vehicle has enough seats can accept it. One request has one accepter.
- **Ride offer:** any verified student can book a seat.
- A Rider who needs a ride acts as a passenger. A normal user can never accept a passenger request.

### 8.6 Workflow

1. Create a passenger request or a ride offer.
2. Others browse or get a sub-area/route notification and open the card.
3. Accept or book. This is the confirmation (section 7.2). Both see each other's phone number, profile and vehicle details, and a chat opens.
4. On ride day, either person can tap Start Ride → IN_PROGRESS.
5. Either marks Completed; the other confirms or disputes within 24 hours (section 7.3).
6. Both leave blind reviews (section 15).

End states: COMPLETED, CANCELLED, EXPIRED, NOT_MARKED.

## 9. Carpool

Carpool is for recurring weekly rides. Only Verified & Active Riders create schedules; any verified student can book a seat, and each passenger gets a separate contract.

### 9.1 Pages

- **Rider:** Create Schedule, My Carpool Posts, Booking Requests, Contracts & Sessions, Search.
- **Passenger:** Search, My Bookings, Contracts & Sessions.
- **Search filters:** day, time, pickup, destination.

### 9.2 Creating a carpool post

- Fields: day(s) of the week, time, pickup, destination, vehicle (BIKE or CAR), passenger seats, notes, and a fixed monthly price for each offered duration (1, 2, 3 or 4 months).
- BIKE allows exactly 1 seat; CAR allows 1–4 seats.
- One schedule creates only one Carpool Post, whatever the number of seats.
- A rider can have at most 12 independent schedules, each with its own day, time and route. A rider's own schedules must not overlap in time.
- Each post has a start date and an optional end date. Without an end date, the post stays available until the rider closes it. A contract cannot end after the post's end date.

### 9.3 Seat-based booking workflow

1. Passenger picks a post, a duration (1–4 months) and a start date, and sends a booking request for one seat.
2. Rider accepts or rejects each request independently.
3. After the rider accepts, the seat is held for 24 hours (or until the start date, whichever is sooner) and a chat opens.
4. Both press Agree. A contract is created for that passenger (sub-status CONTRACT_ACTIVE). If they do not agree within the hold, the seat returns to available.
5. The system generates a ride session for every agreed day of the contract.
6. On each ride day, either side can mark the session Completed or Cancelled (with a reason). The system records who cancelled.
7. A monthly history shows completed, cancelled and not-marked sessions and who cancelled each one.
8. When the contract ends, both can review each other and the passenger can request Renew.

### 9.4 Seat and post rules

- Each successful booking reserves exactly one seat. Duration and monthly price are managed per passenger.
- When all seats are booked, the post becomes FULL. When a passenger cancels or a contract ends, only that seat opens and the post returns to OPEN.
- Duplicate bookings and overbooking are prevented with database transactions.
- A passenger can hold several contracts, but not two whose sessions overlap (section 7.5).
- A rider cannot book their own post but can book other riders' posts as a passenger.
- A session nobody marks is shown as Not Marked and does not count against anyone.

### 9.5 Monthly payment record

- No full upfront payment. Each contract month has its own payment record, UNPAID at the start of the month.
- When the passenger pays, the rider marks that month PAID. Every month's history is kept separately.
- Method (Cash, bKash, Nagad) is agreed between rider and passenger. UniGo only records it.

### 9.6 Session cancellation and early termination

- A rider who cancels a session must give a reason, and every cancellation is recorded.
- Passengers can see a rider's session cancellation history before booking.
- For repeated cancellations, the admin can warn the rider or temporarily suspend their carpool access.
- Early termination: one side requests it and the other agrees. If they disagree, either side can raise a complaint (section 15). Refunds are handled outside the app.

## 10. Food Delivery

A student asks another student to buy and bring food. UniGo matches and records; the two users settle money between themselves.

### 10.1 Pages

All Available, My Orders (created by me), Accepted Orders (accepted by me), Search (location, date, sub-area).

### 10.2 Create a request

| Required | Optional |
| --- | --- |
| Restaurant name, restaurant location, food items, food details, quantity, estimated food budget, pickup location (prefilled from the restaurant, editable), delivery location, sub-area, expected delivery time | Offered delivery service amount |

### 10.3 Workflow

OPEN → ACCEPTED (ORDER_CONFIRMED → FOOD_COLLECTED) → IN_PROGRESS → COMPLETED.

1. Requester creates the request. Users who saved that sub-area are notified.
2. Another student accepts. Both see each other's name, phone number and profile, and a chat opens.
3. Both confirm the order details (items, price, delivery charge, payment method) in the app before purchase → ORDER_CONFIRMED.
4. The accepter buys the food and uploads a receipt or bill image → FOOD_COLLECTED, status IN_PROGRESS.
5. The accepter delivers to the delivery location.
6. Two-step completion (section 7.3), then blind reviews.

### 10.4 Rules

- Payment method (Cash, bKash, Nagad) is chosen by the two users. UniGo records the amounts and method only.
- If the real cost goes above the estimated budget, the accepter must get approval in chat before buying.
- Requester can edit, upgrade or delete before acceptance; after acceptance, cancel with the cancellation rules.
- Nobody can accept their own request. One request has one accepter.
- **Requester No-Show:** if the requester does not collect the food, the accepter can report a No-Show with evidence. The admin reviews it and can warn, restrict or ban the requester.

## 11. Uni Service

A student asks another student for help with a daily task, chosen from seven fixed categories.

### 11.1 Categories

Shopping & Purchasing; Parcel & Delivery; Pharmacy & Healthcare; Document & Academic Services; Warranty & Repair Services; Financial & Administrative Services; Custom / Other Services. The requester writes a custom service title inside the main category.

### 11.2 Request fields

| Required | Optional |
| --- | --- |
| Main category, service title, task title, detailed description, destination location, preferred date, offered service amount | Item details, quantity, reference image, pickup location, sub-area, preferred time, estimated budget, additional instructions |

Optional fields appear in Request Details only when filled.

### 11.3 Workflow

1. Requester creates the request; sub-area users are notified.
2. A student accepts. Both see name, phone number and profile, and a chat opens.
3. The accepter taps Start → IN_PROGRESS.
4. The accepter finishes → SERVICE_DELIVERED and requests completion.
5. Two-step completion (section 7.3), then blind reviews.

### 11.4 Rules and safety

- Same edit, upgrade, delete and cancel rules as Food.
- Pharmacy & Healthcare covers buying or collecting items only: no medical advice and no emergency help.
- Financial & Administrative shows a warning never to share passwords, PINs or OTP codes in chat.
- The admin can remove requests that break the policy.

## 12. All Services, Activity and Upcoming

### 12.1 All Services

A grid of Ride, Carpool, Food and Service. Each tile has a short description and two buttons: Create and Browse. Space is left for future services.

### 12.2 Activity

Activity uses the common status system. Filter chips: All, Ride Sharing, Carpool, Food Delivery, Uni Service; and Requested by me / Accepted by me. "Requested by me" means posts and requests I created; "Accepted by me" means other users' posts and requests I accepted or booked.

- **Active:** OPEN, ACCEPTED, IN_PROGRESS, DISPUTED.
- **Ongoing:** IN_PROGRESS only.
- **History:** COMPLETED, CANCELLED, EXPIRED, NOT_MARKED.

| Status | What the user can do |
| --- | --- |
| OPEN | Edit, upgrade amount, delete |
| ACCEPTED | View details, chat, call, start, cancel with reason |
| IN_PROGRESS | Chat, call, mark completed, cancel with reason |
| COMPLETION_REQUESTED | Confirm completion or raise a dispute (other user) |
| DISPUTED | View dispute status, add evidence |
| COMPLETED | View details, leave review (within 7 days) |
| CANCELLED / EXPIRED / NOT_MARKED | View details, create again with the same details |

### 12.3 Upcoming

- All future ACCEPTED activities from all four features in one list, nearest first.
- Filters by feature and by type (Requested or Accepted).
- Carpool shows only sessions in the next 7 days.
- Each card shows type, time, route or title, other person, status chip, and a countdown for the nearest item.

## 13. Inbox and Chat

- A chat is created automatically when a request is accepted, a ride seat is booked or a carpool booking is accepted. One chat per activity (per booking for seat-based posts).
- The list shows the other person, activity type, last message and unread count. Messages are real-time.
- Phone number and a Call button appear only after acceptance. Email is never shown.
- System messages appear for key events: accepted, started, completion requested, completed, cancelled, disputed.
- Food chats support image upload for receipts and bills.
- When the activity reaches a terminal status, the chat becomes read-only.
- Report and Block are available inside the chat. Blocked users cannot send new messages to each other.
- Rate limit: 10 messages per user per minute.

## 14. Notifications

UniGo sends notifications through three channels so users do not miss updates when the app is closed.

1. **In-app:** bell with unread count and a Notifications page.
2. **Web Push (PWA):** browser push even when UniGo is closed, if the user enables it and the device supports it.
3. **Email (fallback):** for important events: acceptance, booking, cancellation, disputes, verification results and reminders.

Users can turn Web Push on or off. The system sends notifications on status transitions and prevents duplicates (one notification per event per user per channel).

| Event | Who is notified | Channels |
| --- | --- | --- |
| Request accepted / seat booked | Creator | In-app, push, email |
| New carpool booking request | Rider | In-app, push |
| Booking request accepted or rejected | Passenger | In-app, push, email |
| Carpool contract created | Both | In-app, push, email |
| Carpool session reminder (ride day) | Both | In-app, push |
| Upcoming activity, 30 minutes before | Both | In-app, push |
| Completion requested | Other participant | In-app, push |
| Auto-completed / auto-closed (NOT_MARKED) | Both | In-app |
| Activity cancelled | Other participant | In-app, push, email |
| Dispute opened, updated or resolved | Both | In-app, push, email |
| New chat message | Receiver | In-app, push |
| New food or service request in my sub-area | Users who saved that sub-area (not blocked) | In-app, push |
| Student or rider verification result | Applicant | In-app, email |
| Request expired | Creator | In-app |
| Monthly carpool payment due | Passenger | In-app |
| Report or support update | Reporter | In-app |
| Promo, spotlight or announcement | All or selected users | In-app, push |
| Account status changed (warned, restricted, suspended, banned, unbanned) | Affected user | In-app, email |
| Password reset requested / password changed | Account owner | Email |

## 15. Trust, safety and privacy

### 15.1 Blind reviews

- After an activity is COMPLETED, both users can give 1–5 stars and an optional comment, within 7 days.
- A submitted review stays hidden until both have reviewed, or until the 7 days end; then reviews are published.
- One review per user per activity (per booking for seat-based posts). No edit or delete after submission; the admin can moderate.
- No reviews for CANCELLED, EXPIRED or NOT_MARKED activities.

### 15.2 Profile stats and badges

Average rating, total completed, completion rate (completed ÷ accepted, excluding NOT_MARKED), cancellation count and late cancellation rate. Badges: Verified Student, Verified Rider, Top Rated, Reliable.

### 15.3 Cancellation rules

- Before acceptance: free; the creator can delete at any time.
- After acceptance: either side can cancel with a reason; who cancelled is recorded.
- Cancelling less than 60 minutes before the start is a late cancellation. Repeated late cancellations show a warning on the profile and are visible to the admin.

### 15.4 Complaints and disputes

1. Either participant can file a complaint about an activity with a reason, description and optional evidence images.
2. The activity becomes DISPUTED and auto-completion stops.
3. The admin reviews the case, and can call both users or collect other information.
4. The admin records a decision: final activity status, and any action (warning, temporary suspension or permanent ban).
5. Both users are notified of the decision. Complaint history and resolution are stored.

### 15.5 Spam and abuse prevention

| Limit | Rule |
| --- | --- |
| Open requests | Max 3 OPEN items per user at a time: passenger requests, ride offers, food and service requests. Deleted items do not count. Carpool posts are excluded (max 12 schedules). |
| Daily creation | Max 4 new passenger requests, ride offers, food and service requests per user per day (resets at midnight, Asia/Dhaka). Deleted items still count. Carpool posts and bookings are excluded. |
| Chat | Max 10 messages per minute; sending is paused briefly when exceeded |
| Block | Blocked users never appear in each other's matching, sub-area notifications or new messages |

Account states (ACTIVE, RESTRICTED, SUSPENDED, BANNED) and admin moderation actions are defined in section 17.1.

### 15.6 Privacy and data protection

- After acceptance, both users can see each other's phone number for communication and emergencies. Email addresses always stay private.
- Student ID cards, NIDs and licences are stored in private storage and opened only by authorised admins through short-lived signed URLs. They are never visible to other users.
- Vehicle registration numbers are partially masked for students.
- The system keeps verification status and records; document retention rules are listed in the Policy page.

## 16. Payments

UniGo does not process any payment in version 1; it only records what users agree.

- Each activity (ride booking, food, service) stores amount, method (Cash, bKash, Nagad) and status (UNPAID, PAID).
- Carpool keeps one payment record per contract month (section 9.5).
- Food records the food cost and the delivery charge separately.
- Promos in version 1 are informational offers only.

## 17. Admin panel

**Dashboard:** total users, active users, verified students, verified riders, pending student and rider verifications, new requests today per feature, open disputes, open reports, No-Show reports.

| Module | What admins can do |
| --- | --- |
| Users | Full account management: see 17.1 User Account Management |
| Universities | Add, edit, remove universities and their allowed email domains |
| Rider Requests | Review documents and vehicles, approve or reject with reason, suspend riders |
| Ride Sharing | View and manage all requests, offers and bookings |
| Carpool | View posts, bookings, contracts, sessions, payment records and rider cancellation history; suspend carpool access |
| Food Delivery | View and manage requests; review No-Show reports |
| Uni Service | View and manage requests; remove policy-breaking requests |
| Disputes & Complaints | Review evidence, record decision and action, notify both users |
| Reports & Support | Review reports and support requests, take action |
| Sub-Areas | Add, edit, remove sub-areas in the master list |
| Fare Settings | Set the suggested fare rate per km |
| Promos, Spotlight, Banners | Add, edit, delete, set start and end date |
| Notifications | Send announcements to all or selected users |
| Audit Log | Read-only record of admin actions |

Audit Log fields: admin, action, time, affected user or content, old value and new value.

Admin levels: **Super Admin** (everything) and **Moderator** (verifications, reports, disputes, requests and content only).

### 17.1 User Account Management

Authorised admins manage every user account from the Admin Panel.

**Available actions**

- View user profiles and activity history.
- Verify or reject student verification.
- Warn users for policy violations.
- Restrict users from creating or accepting new activities.
- Temporarily suspend accounts for a specified period.
- Permanently ban accounts for serious or repeated violations.
- Unban previously banned users.
- Reactivate an account early (lift a restriction or suspension before its end date), and suspend or reinstate rider and carpool access.
- View account status and previous moderation history.

**Account status**

| Status | Meaning |
| --- | --- |
| `ACTIVE` | Normal account access |
| `RESTRICTED` | Cannot create or accept new activities |
| `SUSPENDED` | Temporarily unable to access the account |
| `BANNED` | Permanently disabled until an admin unbans the account |

**Admin action rules**

- A reason is required for every warning, restriction, suspension or ban.
- A temporary suspension must include a start and end date; the account returns to ACTIVE automatically at the end date.
- Users receive a notification when their account status changes.
- All admin actions are recorded in the Audit Log and in the user's moderation history.
- Only authorised admins can perform account management actions.
- When a user is restricted, suspended or banned, their OPEN posts are closed and the other participants of their accepted activities are notified.

## 18. Data model overview

A common `activities` table holds the shared lifecycle (type, status, sub-status, start_time, creator, accepter, auto_closed_at, closure_reason). Feature tables link to it, so chat, reviews, disputes, payments, notifications, Activity and Upcoming each work with one query.

| Group | Main tables |
| --- | --- |
| People | users, profiles, universities, university_domains, student_verifications, saved_addresses, blocks, moderation_actions, password_reset_tokens, refresh_tokens |
| Areas | sub_areas (admin master list), user_sub_areas |
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

IDs are time-ordered UUIDs (v7), so they cannot be guessed in URLs.

## 19. Technology and non-functional requirements

### 19.1 Stack

| Layer | Choice |
| --- | --- |
| Frontend | React, responsive and mobile-first, built as a PWA (installable, Web Push) |
| i18n | Bangla and English language files (for example react-i18next) |
| Backend | Node.js + Express, REST API |
| Database | MySQL with Prisma ORM |
| Auth | JWT access + refresh tokens, manual register/login and Google sign-in; roles USER, MODERATOR, SUPER_ADMIN plus verified-student and verified-rider flags |
| Real-time | Socket.IO for chat and live notifications |
| Background jobs | BullMQ + Redis (delayed jobs); node-cron acceptable for an early prototype |
| Email | SMTP / transactional email service for OTP and fallback notifications |
| Maps | OpenStreetMap + Leaflet; Nominatim for search (debounced, cached); OSRM for route distance and suggested fare |
| File storage | Private storage for verification documents (signed URLs); public storage for spotlight media |
| AI (later) | Python service with scikit-learn |

### 19.2 Background jobs

| Job | Trigger |
| --- | --- |
| Expire OPEN items | At start time |
| Auto-complete after 24 hours | 24 hours after completion request, unless disputed |
| Auto-close NOT_MARKED | 6 hours after start, if still ACCEPTED |
| Carpool seat hold release | 24 hours after rider accepts, or at start date |
| Generate carpool sessions | When a contract is created |
| Monthly payment records | Start of each contract month |
| Reminders | 30 minutes before start; carpool on ride day |
| Publish blind reviews | When both submit, or 7 days after completion |
| Licence expiry reminders (Phase 4) | Before expiry date |

### 19.3 Non-functional requirements

- **Concurrency:** accept, book and conflict check run in one transaction with conditional updates (`WHERE status = 'OPEN'` or a seat count check), so double acceptance and overbooking are impossible.
- **Time:** store all times in UTC; display in Asia/Dhaka. Every time rule is validated on the server, not only in pickers.
- **Security:** bcrypt password hashing, refresh-token rotation, hashed single-use password reset tokens (15-minute expiry), rate limiting on auth and chat, input validation and XSS sanitisation, MIME and size checks on uploads (JPG, PNG, PDF, max 5 MB), HTTPS only.
- **Authorisation:** every endpoint checks role, verification status and participation in the activity.
- **Performance:** main pages load under 3 seconds on a mid-range phone over 4G; chat messages delivered under 1 second.
- **Reliability:** idempotent background jobs; notifications de-duplicated.
- **Auditability:** every status change is stored in activity_status_history; every admin action in audit_logs.

## 20. AI-assisted matching (later phase)

Matching starts as an explainable rule-based score and moves to a trained model only when real data exists.

1. **Stage 1 – rule-based score:** rank riders and requests by pickup distance, route similarity, time difference, seats, rating and completion rate, with tunable weights.
2. **Stage 2 – learned model:** train on synthetic data plus pilot-usage data (accepted vs ignored suggestions).
3. **Service classification:** suggest the main category from the task description.
4. **Sub-area alerts:** rank who should be notified first.

Evaluation: precision@k of suggestions, suggestion acceptance rate, and time-to-accept compared with no ranking. AI only recommends; users always choose, and AI never approves users or riders.

## 21. MVP scope and build plan

### 21.1 Scope priority

| Priority | Features |
| --- | --- |
| Must have | Auth, student verification, basic rider verification, Ride Sharing, Food Delivery, common activity engine, chat, notifications (in-app + push), Activity, Upcoming, reviews, core admin |
| Should have | Carpool, Uni Service, disputes workflow, email fallback, Bangla UI, dark mode |
| Could have | AI matching, Spotlight, promos, banners, suggested fare |

### 21.2 Phases

| Phase | Work | Result |
| --- | --- | --- |
| 1. Foundation | Register, login, forgot password, Google sign-in, universities, student verification, profile, PWA shell, layouts, Home | Working shell |
| 2. Rider verification + Ride Sharing | Basic rider application (PENDING/APPROVED/REJECTED), vehicles, admin approval; then Need, Search, Offer a Ride, seat booking, map, suggested fare | Core feature |
| 3. Activity engine | Common statuses, two-step completion, auto-close, time-conflict check, background jobs, chat, notifications, Activity, Upcoming, blind reviews | Connected experience |
| 4. Advanced rider & admin | Licence expiry tracking, re-verification, suspension, verification history, admin dashboard, disputes, audit log | Trusted platform |
| 5. Carpool | Posts, seat booking, contracts, sessions, monthly payments, cancellation history | Recurring rides |
| 6. Food and Service | Both modules, sub-area master list, sub-area notifications, receipts, No-Show | All four features |
| 7. Content and polish | Spotlight, promos, banners, quick actions, support, Bangla UI, dark mode, email fallback | Complete product |
| 8. AI | Rule-based score, model, classification, evaluation | Smart recommendations |
| 9. Testing and release | Pilot, bug fixing, security checks, deployment, documentation | Final submission |

Dependency rule: Ride Offer creation and Passenger Request acceptance are not complete until rider application and admin approval work.

## 22. Evaluation, testing and risks

### 22.1 Success metrics (KPIs)

| Metric | Definition |
| --- | --- |
| Match rate | Requests accepted ÷ requests created |
| Time to accept | Average minutes from creation to acceptance |
| Completion rate | Completed ÷ accepted (excluding NOT_MARKED) |
| Late cancellation rate | Late cancellations ÷ accepted |
| Dispute rate | Disputed ÷ completed + disputed |
| User satisfaction | Average rating and pilot survey score |

Target values are set after the pilot baseline.

### 22.2 Testing plan

- **Unit tests:** status transitions, time rules, conflict check, seat counting, limits.
- **Integration tests:** API flows for each feature, including two users accepting at the same moment.
- **Job tests:** expiry, auto-complete, auto-close, seat hold release, session generation.
- **User acceptance test:** pilot with a small group of students from at least two universities, followed by a survey.
- **Security checks:** auth, authorisation per endpoint, upload validation, rate limits.

### 22.3 Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Scope too large for the timeline | MVP priorities (section 21.1); Carpool and Service as should-have |
| Too few users for matching (cold start) | Pilot in one area first; sub-area notifications |
| Fake or unsafe users | Student verification, rider and vehicle verification, blind reviews, disputes, bans |
| Money disputes in food and carpool | Order confirmation, receipts, monthly records, No-Show reports |
| Race conditions and double booking | Transactions and conditional updates |
| Free map API limits | Debounce, caching, self-hosted OSRM if needed |
| Missed notifications | Web Push plus email fallback |

### 22.4 Legal and ethical considerations

- UniGo is a student cost-sharing platform, not a commercial ride-hailing service; the legal position of paid peer rides needs to be stated in the Terms.
- Personal data and verification documents are collected only for verification and handled under the privacy rules in section 15.6.
- Users are informed that UniGo does not process payments and is not responsible for transactions between users.

## 23. Final decisions and future enhancements

### 23.1 Decisions confirmed in v1.1

| Question from v1.0 | Decision |
| --- | --- |
| Ride offer seats | Seat-based booking; BIKE = 1 seat, CAR = up to 4 |
| Confirm timeout | Removed; acceptance is the confirmation |
| Food and Service time limit | Food: up to 24 hours ahead. Service: up to 7 days ahead |
| Rating metric | Completion rate = completed ÷ accepted; late cancellation rate shown separately |
| Carpool hold | 24 hours after the rider accepts, ending earlier if the start date is sooner |
| Separate mobile app | No; responsive PWA with Web Push |

### 23.2 Future enhancements

- Academic holiday calendar and "Skip this date" for carpool sessions.
- SOS button, share-trip link and emergency contacts.
- Gender preference filter for rides and carpools.
- Online payment integration (bKash/Nagad API) and wallet.
- Native mobile apps.
