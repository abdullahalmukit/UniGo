- Project owner: **Mukit**

# UniGo

University-only, peer-to-peer PWA for verified students: Ride Sharing, Carpool, Food Delivery and Uni Service.

- Product specification: [`docs/UniGo-Proposal-v1.1.md`](docs/UniGo-Proposal-v1.1.md)
- Build rules and order: [`CLAUDE.md`](CLAUDE.md)

## Project layout

| Folder | What it is |
| --- | --- |
| `client/` | React + Vite PWA (router, layouts, theme, Bangla/English, API client) |
| `server/` | Express REST API + Prisma (MySQL) |
| `docs/` | Proposal / specification |

## Requirements

- Node.js 22 or newer
- MySQL 8 running locally

## First-time setup

1. Install everything (root, client and server):

   ```bash
   npm install
   ```

2. Create the database in MySQL. It **must** use the `utf8mb4` character set with the `utf8mb4_unicode_ci` collation (needed for Bangla text and emoji):

   ```sql
   CREATE DATABASE unigo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

3. Copy the example env files. In `server/.env`, fill in your MySQL user and password, two different JWT secrets (at least 32 characters each), a third different secret for private file links (`FILE_SIGNING_SECRET`) and your Google OAuth web client ID (`GOOGLE_CLIENT_ID`). Optionally set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` to get a Super Admin account from the seed:

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   Generate each secret with:

   ```bash
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```

4. Create the tables and add the two placeholder universities (Test University A and B) used for trying registration by hand:

   ```bash
   npm run db:migrate -w server
   npm run db:seed -w server
   ```

### Test database (integration tests)

The integration tests run against a separate MySQL database whose name must end in `_test`. **Every test empties it**, so never point it at real data.

1. Create it:

   ```sql
   CREATE DATABASE unigo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

2. Copy `server/.env.test.example` to `server/.env.test` (gitignored) and set its `DATABASE_URL`.

The test run applies the migrations to it automatically.

## Running

```bash
npm run dev
```

- API: http://localhost:4000 (health check: http://localhost:4000/api/health)
- Client: http://localhost:5173 (calls the API through the Vite proxy at `/api`)

## Other scripts

| Command | What it does |
| --- | --- |
| `npm test` | Run the client tests and all server tests (unit + integration; needs MySQL and `server/.env.test`) |
| `npm test -w client` | Client tests only (Vitest + jsdom, no server needed) |
| `npm run test:unit -w server` | Unit tests only (no database) |
| `npm run test:integration -w server` | Integration tests only, against the test database |
| `npm run build` | Build server (`server/dist`) and client (`client/dist`) |
| `npm run typecheck -w server` / `-w client` | Type-check one app |
| `npm run db:migrate -w server` | Create and apply migrations to the dev database |
| `npm run db:seed -w server` | Add the dev-only placeholder universities and, if `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` are set, a Super Admin account |
| `npm run db:generate -w server` | Regenerate the Prisma client after editing the schema |

## Client

| Path | Who | Page |
| --- | --- | --- |
| `/` | everyone | Home |
| `/services` | everyone | All Services |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | everyone | Auth pages (simple layout: full logo, language switch, "Back to Home") |
| `/register/google` | after Google sign-in | Phone, university and name for a new Google user |
| `/verify-student` | logged in | "Verify your student status" (the real verification comes in A6) |
| `/activity`, `/upcoming`, `/inbox`, `/notifications`, `/account` | logged in | Placeholders; guests go to `/login?next=…` |

- **Google sign-in:** set `VITE_GOOGLE_CLIENT_ID` in `client/.env` to the same OAuth web client ID as the server's `GOOGLE_CLIENT_ID`, and add the site's address (for example `http://localhost:5173`) to the client's Authorised JavaScript origins in Google Cloud Console.

- **Layout:** below 768 px a top bar and bottom tabs (Home, Activity, Upcoming, All Services, Inbox); from 768 px one top navbar with content about 1100 px wide.
- **Theme:** Light (default), Dark or System, from the tokens in `client/src/styles/tokens.css` (light and dark values, all WCAG AA, checked by `tokens.test.ts`). Saved in localStorage as `unigo.theme` and applied before the first paint.
- **Language:** Bangla or English, detected from the browser (English if it is not Bangla), saved as `unigo.language`. Every UI string is in `client/src/i18n/en.json` and `bn.json`.
- **API calls:** use `api()` from `client/src/lib/api.ts`. The access token stays in memory; on a 401 the client refreshes once and retries once. Only one refresh runs at a time across all open tabs, and the other tabs reuse its token (`client/src/lib/session.ts`).
- **Logo, icons and service pictures:** the sources are in `client/brand/` (the two UniGo logo files and the four service pictures in `brand/services/`; see `client/CREDITS.md`). Every file the app uses (transparent logo, wordmark, dark logo, favicon, PWA icons, the service pictures at 1x and 2x) is built from them:

  ```bash
  npm install --no-save sharp
  node client/scripts/build-brand-assets.mjs
  ```

## Health check

`GET /api/health`

- `200 { "status": "ok", "database": "up", "uptime", "timestamp" }`
- `503 { "status": "degraded", "database": "down", ... }` when MySQL cannot be reached

## Auth API

| Method | Path | Needs | What it does |
| --- | --- | --- | --- |
| GET | `/api/universities` | — | `{ universities: [{ id, name, shortName }] }`: active universities, by name |
| POST | `/api/auth/register` | — | `{ name, phone, email, universityId, password, language?, theme? }` → 201 with `{ user, accessToken, accessTokenExpiresAt }` and the refresh cookie |
| POST | `/api/auth/login` | — | `{ email, password }` → same response as register |
| POST | `/api/auth/refresh` | refresh cookie | Rotates the refresh token and returns a new access token |
| POST | `/api/auth/logout` | refresh cookie | Ends this session (204) |
| POST | `/api/auth/logout-all` | access token | Ends every session at once (204) |
| GET | `/api/auth/me` | access token | `{ user }`: the caller's own account |
| POST | `/api/auth/forgot-password` | — | `{ email }` → always 202 with the same message; emails a reset link if the account exists |
| POST | `/api/auth/reset-password` | — | `{ token, password }` → 204; ends every session |
| POST | `/api/auth/google` | — | `{ idToken }` → a session, or `{ needsRegistration, signupToken, email, name }`, or 409 `GOOGLE_LINK_REQUIRES_PASSWORD` with `linkToken` |
| POST | `/api/auth/google/register` | — | `{ signupToken, name, phone, universityId, language?, theme? }` → 201 with a session |
| POST | `/api/auth/google/link` | — | `{ linkToken, password }` → a session, with Google now linked |

- The access token goes in `Authorization: Bearer <token>` and lasts 15 minutes. Keep it in memory, not in storage.
- The refresh token is only ever in the `unigo_refresh` cookie (httpOnly, `SameSite=Lax`, path `/api/auth`, Secure in production). It lasts 30 days and changes on every refresh. Reusing an old one ends that whole login session, so the client must not send two refresh calls at the same time.
- Rate limits: login 10 per 15 min per IP and email, register 5 per hour per IP, refresh 30 per 15 min per IP, forgot password 3 per hour per email plus 10 per hour per IP, reset password 10 per 15 min per IP, Google endpoints 10 per 15 min per IP.
- The reset link is `CLIENT_URL/reset-password#token=…`; the reset page reads the token from the URL fragment and posts it to `/api/auth/reset-password`.

## Email

- **Development:** every email, reset links included, is printed to the server console. Set `EMAIL_TRANSPORT=smtp` and the `SMTP_*` values in `server/.env` to send real email instead.
- **Tests:** emails go to an in-memory outbox; nothing is printed or sent.
- **Production:** always SMTP. The server refuses to start without `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM`.
- Emails are written in the user's language (Bangla or English); the texts are in `server/src/modules/email/templates.ts`.

## Error shape

Every API error uses one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "No route for GET /api/nope" } }
```

`VALIDATION_ERROR` also lists the problem with each field:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid", "fields": { "phone": ["Enter a Bangladesh mobile number, for example 01712345678"] } } }
```

Some codes carry extra values the client needs, next to `code` and `message` (for example `GOOGLE_LINK_REQUIRES_PASSWORD` carries `linkToken` and `email`).

Auth error codes: `VALIDATION_ERROR`, `EMAIL_TAKEN`, `PHONE_TAKEN`, `UNIVERSITY_NOT_FOUND`, `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_REFRESH_TOKEN`, `ACCOUNT_SUSPENDED`, `ACCOUNT_BANNED`, `ACCOUNT_RESTRICTED`, `NOT_VERIFIED`, `FORBIDDEN`, `RATE_LIMITED`, `INVALID_RESET_TOKEN`, `INVALID_GOOGLE_TOKEN`, `GOOGLE_EMAIL_NOT_VERIFIED`, `GOOGLE_LINK_REQUIRES_PASSWORD`, `GOOGLE_ACCOUNT_CONFLICT`, `INVALID_GOOGLE_STEP_TOKEN`.
