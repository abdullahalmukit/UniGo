# UniGo

University peer-to-peer mobility and service platform (website).
This version has: register, login (email and Google), JWT auth, USER/ADMIN roles, and the home page.

```
unigo/
  backend/    Node.js + Express + Prisma + MySQL
  frontend/   React (Vite) website
```

## 1. Create the database (MySQL Workbench)

1. Open MySQL Workbench and connect to your local server (root).
2. Open a new SQL tab and run:

```sql
CREATE DATABASE IF NOT EXISTS unigo_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

3. Click the refresh icon in the Schemas panel. You should see `unigo_db`.

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env     # Windows: copy .env.example .env
```

Open `.env` and set your real `DB_PASSWORD`, a long `JWT_SECRET`, and the Google client ID.
If your MySQL password contains special characters (`@ # / : ? %`), write them URL-encoded in `DATABASE_URL` (for example `@` becomes `%40`).

Then create the tables and the first admin:

```bash
npx prisma migrate dev --name init_auth
npm run seed
npm run dev
```

Check http://localhost:5000/api/health. You should see `{"status":"ok"}`.
In Workbench, refresh `unigo_db`, and you will see the `users` table with your admin inside.

If `migrate dev` complains about permissions, run `npx prisma db push` instead.

## 3. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173.

## 4. Google sign-in setup

1. Google Cloud Console, then APIs & Services, then Credentials.
2. Configure the OAuth consent screen.
3. Create credentials, then OAuth client ID, type **Web application**.
4. Under **Authorized JavaScript origins** add `http://localhost:5173` (and your real site address later).
5. Copy the client ID into `frontend/.env` as `VITE_GOOGLE_CLIENT_ID` and into `backend/.env` as `GOOGLE_CLIENT_IDS`.
6. Restart both servers.

The backend only accepts ID tokens made for the client IDs listed in `GOOGLE_CLIENT_IDS`.

## 5. How authorization works

- Register and login return a JWT. The website sends it as `Authorization: Bearer <token>`.
- `authenticate` middleware checks the token and loads the user from the database.
- `requireRole('ADMIN')` blocks everyone who is not an admin.
- The role is always read from the database, never from the request body or token.
- Registration only reads `fullName`, `email`, `password` and `universityName`, so nobody can choose a role.
- Admins are created only with `npm run seed` or directly in the database.

## 6. Google account linking (how takeover is prevented)

- The backend verifies the Google ID token with Google and requires `email_verified`.
- Same Google ID: log in.
- Same verified email as an existing manual account: link `googleId` to that account, so there is no duplicate user.
- If that manual account never verified its email, its password is removed when linking. This stops a person who registered with someone else's email from keeping access after the real owner signs in with Google.
- Google users have no password and no university yet. `universityVerified` is `false` for everyone. Verification is a separate step to build later.

## 7. Logout and token limits

JWTs are stateless, so the server does not store them.

- Logout removes the token from the browser. The `/api/auth/logout` endpoint only confirms it.
- A copied token still works until it expires (7 days by default). The server cannot cancel it.
- If a user is deleted, their token stops working, because the middleware checks the database.
- The token is kept in `localStorage`. This is simple, but any XSS bug on the site could read it. A stronger option for later is an httpOnly cookie.
- Later options for real revocation: short-lived tokens with refresh tokens stored in the database, or a `tokenVersion` column on the user that you increase to invalidate old tokens.

## 8. Postman tests

Base URL: `http://localhost:5000`. Header: `Content-Type: application/json`.

| # | Request | Expected |
|---|---------|----------|
| 1 | `POST /api/auth/register` `{"fullName":"Test User","email":"test@uni.edu","password":"password123","universityName":"DIU"}` | 201, token, user with `role: "USER"` |
| 2 | Same request again | 409 duplicate email |
| 3 | Register with no `universityName` | 400 |
| 4 | Register with password `123` | 400 |
| 5 | Register with an extra `"role":"ADMIN"` | 201, but `role` is `USER` |
| 6 | `POST /api/auth/login` with correct details | 200, token |
| 7 | Login with a wrong password | 401 "Incorrect email or password" |
| 8 | `GET /api/auth/me` with `Authorization: Bearer <token>` | 200, user, no `passwordHash` |
| 9 | `GET /api/auth/me` with no token | 401 |
| 10 | `GET /api/auth/me` with a broken token | 401 |
| 11 | `GET /api/admin/users` with a USER token | 403 |
| 12 | Log in as the seeded admin, then `GET /api/admin/users` | 200, list of users |
| 13 | `POST /api/auth/logout` with token | 200, message |
| 14 | `POST /api/auth/google` `{"idToken":"fake"}` | 401 |
| 15 | `POST /api/auth/google` with an empty body | 400 |

Real Google test: use the button on the website. To test linking, register manually with your Gmail, log out, then sign in with Google using the same Gmail. Workbench should still show one row for that email.

## 9. Git

```bash
git checkout -b feature/auth
git add .
git commit -m "feat: add auth (register, login, Google, JWT, roles) and home page"
git push -u origin feature/auth
```
