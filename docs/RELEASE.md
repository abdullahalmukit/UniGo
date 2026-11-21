# UniGo release checklist (B10)

Project owner: Mukit. This list covers what must be set or checked before UniGo
runs for real users. Business rules live in `CLAUDE.md` and
`docs/UniGo-Proposal-v1.1.md`; this file is only about running the app.

## 1. Before the first release

| Item | What to do | Why |
| --- | --- | --- |
| Policy text | Read `/policy` (texts in `client/src/i18n/en.json` and `bn.json`, key `info.policy`) and have it reviewed. | The page was written from the proposal's rules. It is not legal advice. |
| About text | Check `/about` (key `info.about`). | Same. |
| Barikoi key | In the Barikoi dashboard, restrict the key to the site's domain. | The map tiles need the key in the browser, so anyone can read it from the page. |
| Real SMTP | Set `EMAIL_TRANSPORT=smtp` and the `SMTP_*` values, then run `npm run email:test -w server -- you@example.com`. | Without SMTP no verification code, reset link or notification email reaches anyone. Production refuses to start without SMTP. |
| Web Push keys | `npx web-push generate-vapid-keys`, then set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. | Required in production; push is off without them. |
| Secrets | New random values (at least 32 characters, all different) for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FILE_SIGNING_SECRET`. | Never reuse the development values. |
| Google sign-in | Add the production site to the OAuth client's Authorised JavaScript origins; set `GOOGLE_CLIENT_ID` (server) and `VITE_GOOGLE_CLIENT_ID` (client). | Otherwise the Google button fails. |
| Super Admin | Create the first Super Admin on the production database (the dev seed refuses to run outside development). | Someone must review students and riders. |
| Universities | Add universities and their email domains in Admin › Universities. | Students cannot register or verify without them. |
| Fare rate | Set a rate per km in Admin › Fare Settings. | Without it there is no suggested fare. |
| Sub-areas | Add the sub-areas in Admin › Sub-Areas. | Requests need a sub-area. |

## 2. Server settings (`server/.env`)

| Setting | Production value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | The port the proxy forwards to |
| `CLIENT_URL` | The site's https address, e.g. `https://unigo.example` (CORS and email links) |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (usually `1`). Without it every user shares the proxy's IP, so login and chat rate limits would hit everyone at once. |
| `DATABASE_URL` | MySQL 8, a database only UniGo uses |
| `REDIS_URL` | Redis for the background jobs (expiry, reminders, payments, emails) |
| `PRIVATE_STORAGE_DIR` | A folder outside the web root that is backed up (ID cards, licences, receipts, photos) |
| `BARIKOI_API_KEY` | The Barikoi key (see above) |
| `SMTP_*`, `MAIL_FROM`, `VAPID_*`, `GOOGLE_CLIENT_ID`, secrets | See section 1 |

Client build (`client/.env`): `VITE_API_URL` (`/api` when the API is served
under `/api` on the same site, otherwise its full address) and
`VITE_GOOGLE_CLIENT_ID`.

## 3. Build and run

```
npm ci
npm run build                       # server (tsc) and client (vite)
npm exec -w server -- prisma migrate deploy   # apply every migration
npm run start -w server             # API, Socket.IO and the job worker
```

Serve `client/dist` as static files over HTTPS and send `/api` (including the
WebSocket upgrade for `/api/socket`) to the API. Only one API process: rate
limits are kept in memory (B2b decision 7). Running several API processes
needs a shared rate-limit store first.

## 4. Known limits

- `npm audit` reports a high-severity issue in `effect`, used only by the Prisma
  command-line tool (`@prisma/config`) for builds and migrations, not by the
  running server. The only offered fix downgrades Prisma; update Prisma when a
  fixed version is released.
- Rate limits reset when the API restarts (in memory).
- Live location is for rides only (not Food, Service or Carpool).
- AI matching is Stage 1 (rule-based). Stage 2 needs real usage data from
  `match_suggestions`.

## 5. Checks before each release

- `npm run test -w server` and `npm run test -w client` pass (the server's
  integration tests need the MySQL test database in `server/.env.test`).
- `npm run build` passes.
- In a browser, on a phone and a computer: register, verify a student, create
  and accept a ride, chat, complete and review; open a map (place picker and a
  ride's route) in light and dark theme.
- Pilot (proposal 22.2): a small group of students from at least two
  universities, then a short survey.
