- Project owner: **Mukit**

# UniGo

University-only, peer-to-peer Progressive Web App (PWA) for verified students across universities: Ride Sharing, Carpool, Food Delivery and Uni Service.

- Product specification: [`docs/UniGo-Proposal-v1.1.md`](docs/UniGo-Proposal-v1.1.md)
- Build rules and order: [`CLAUDE.md`](CLAUDE.md)

---

## 🚀 Features

### 1. Multi-University Verification & Auth
- University domain email verification (OTP code) or Student ID card upload reviewed by Admin.
- NID, Driving Licence & Vehicle verification for verified student riders.
- JWT Access (15 min in memory) + Refresh Token rotation (30 days httpOnly cookie).
- Google OAuth 2.0 Sign-In and Forgot Password with 15-minute single-use secure reset link.

### 2. Four Core Services
- **Ride Sharing (বাইক ও কার রাইড):** Passenger requests and rider seat offers. 90-minute conflict checking, seat counting, suggested fare based on OSRM driving distance.
- **Carpool (সাপ্তাহিক কারপুল):** Weekly recurring rides with contracts, seat holds, and session generations.
- **Food Delivery (ফুড ডেলিভারি):** Student-to-student meal delivery. Confirmed order details, over-budget chat approvals, and receipt upload.
- **Uni Service (ক্যাম্পাস সার্ভিস):** Help in 7 fixed campus categories (Shopping, Parcels, Pharmacy, Academic Docs, Warranty/Repair, Financial/Admin, Custom).

### 3. Common Activity Engine & Grace Periods
- Finite state engine: `OPEN` ➜ `ACCEPTED` ➜ `IN_PROGRESS` ➜ `COMPLETED` (or `CANCELLED`, `EXPIRED`, `NOT_MARKED`, `DISPUTED`).
- **15-Minute Expiry Grace Period (B3a-1):** Open requests remain available for 15 minutes after scheduled start time before expiring.
- **Late Cancellation Window:** Cancellations within 60 minutes of start time are flagged as late cancellations and tracked in profile statistics.
- **Two-Step Completion:** One user marks completion requested, the other confirms (or auto-completed in 24 hours).
- **Global Time-Conflict Check:** 90-minute atomic conflict prevention across all features.

### 4. Content & Marketing (B8)
- **Campus Spotlight:** Interactive circular story cards with animated ring, full-screen viewer modal, auto-progress, and localStorage seen-tracking (`unigo_seen_stories`).
- **Promos:** Informational promotional vouchers and campus discounts with one-click code copy and toast notification.
- **Banners:** Dynamic promotional carousel on Home with direct in-app or external links.

### 5. Trust, Safety & Disputes (B7)
- **Disputes & Complaints:** Formal dispute resolution for rides, food, and services. Freezes auto-completion until admin decision.
- **No-Show Reports:** Food accepter reporting for requesters who fail to appear.
- **In-Chat User Reports:** Report harassment, scam, or offensive content directly from chat.
- **Blind Reviews:** 1–5 stars and comments, published only when both parties submit or after 7 days.
- **Support Requests & Feedback:** In-app help desk with screenshots, category routing, and admin resolution.

### 6. Full Admin Control Panel
- **Dashboard & Moderation:** User account restrictions, suspensions, and bans with required reasons.
- **Student & Rider Approvals:** Document verification with 5-minute signed secure preview links.
- **Audit Log:** Complete immutable history of all administrative actions.
- **Content Management:** Full CRUD management for Spotlight, Promos, and Banners.

---

## 🔑 Default Admin Credentials

- **Admin URL:** [http://localhost:5173/admin](http://localhost:5173/admin)
- **Email:** `admin@unigo.local`
- **Password:** `Admin1234`

---

## 🛠 Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript, Vite, CSS Modules, PWA, Lucide Icons |
| **Backend** | Node.js, Express, TypeScript, Prisma ORM |
| **Database** | MySQL 8 (`utf8mb4_unicode_ci`) |
| **Queue & Jobs** | Redis + BullMQ (activity sweeps, expiry, auto-complete) |
| **Realtime** | Socket.IO (instant chat, live status updates, notifications) |
| **i18n & Theme** | Bangla (`bn`) + English (`en`), Light + Dark themes |
| **Maps & Geo** | Leaflet, OpenStreetMap, Nominatim proxy with 1 req/sec rate limit |

---

## 💻 Requirements

- Node.js 22 or newer
- MySQL 8 running locally
- Redis (e.g., Memurai on Windows) running on port 6379

---

## 📦 Setup & Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```
   Set your MySQL credentials and JWT secrets in `server/.env`.

3. **Database migration & seed:**
   ```bash
   npm run db:migrate -w server
   npm run db:seed -w server
   ```

4. **Start development servers:**
   ```bash
   npm run dev
   ```
   - Client: [http://localhost:5173](http://localhost:5173)
   - Server API: [http://localhost:4000](http://localhost:4000)

---

## 🧪 Testing & Build

```bash
# Run client tests (260 passing unit & component tests)
npm test -w client

# Run server unit tests (198 passing unit tests)
npm run test:unit -w server

# Build production bundles (0 TypeScript errors)
npm run build
```

---

## 📁 Repository Structure

```
UniGo/
├── client/                           # React frontend PWA
│   ├── src/
│   │   ├── app/                      # Router & application providers
│   │   ├── components/               # UI components (Avatar, Sheets, Chips, Forms)
│   │   ├── features/
│   │   │   ├── account/              # Profile, settings, addresses, support
│   │   │   ├── activity/             # Feed, upcoming, dispute & report modals
│   │   │   ├── admin/                # Complete admin back-office panel
│   │   │   ├── all-services/         # Unified campus request feed
│   │   │   ├── auth/                 # Sign in, register, student verification
│   │   │   ├── content/              # Promos page
│   │   │   ├── food/                 # Food delivery feature
│   │   │   ├── home/                 # Spotlight stories, banners, quick actions
│   │   │   ├── inbox/                # Real-time chat & socket connection
│   │   │   ├── ride/                 # Ride sharing requests & offers
│   │   │   ├── rider/                # Rider onboarding & driver dashboard
│   │   │   └── service/              # Uni Service category requests
│   │   ├── i18n/                     # bn.json & en.json translations
│   │   └── styles/                   # Design tokens & CSS variables
├── server/                           # Express REST API
│   ├── prisma/                       # Schema, migrations, and seeds
│   └── src/
│       ├── config/                   # Central business rules (rules.ts)
│       ├── jobs/                     # BullMQ recurring & timer workers
│       ├── middleware/               # Auth, role check, rate limiting, validation
│       └── modules/                  # Modular domain services and routes
│           ├── activities/           # Central state machine & time rules
│           ├── admin/                # Admin dashboards & audit logs
│           ├── all-requests/         # Cross-service unified request queries
│           ├── chat/                 # Real-time messaging
│           ├── content/              # Spotlight, promo, and banner service
│           ├── disputes/             # Dispute filing & resolution engine
│           ├── food/                 # Food delivery & no-show handling
│           ├── notifications/        # In-app, web push & email notifications
│           ├── ride/                 # Ride matching, fares, and bookings
│           ├── service/              # Uni Service operations
│           └── support/              # Help desk & customer support
└── docs/                             # Architecture specifications & proposal
```
