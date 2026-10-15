# Deployment guide — HITEC Smart Campus

Student project proposal. Not officially endorsed by HITEC Schools & Colleges.

## What you need (all free tier)

1. **Node hosting** — the app is a standard Node.js + Express server with a
   SQLite file database (Node 24 built-in `node:sqlite`, zero native deps).
   Good free options:
   - **Render** (free web service, sleeps when idle — fine for demos)
   - **Railway** (free trial credits)
   - **Fly.io** (free allowances)
   - Any VPS you already have.
2. **Email provider** (for real absence-alert emails) — **Brevo** (300
   emails/day free) or **Resend** (100/day free). Without this the app runs in
   log-only demo mode; in-app notifications still work.
3. **SMS is optional and NOT free** — no SMS is sent unless you configure a
   Pakistani gateway (e.g. Telenor/Jazz/CLOUD bulk SMS APIs) and put the key
   in `.env`.

## Deploy steps (Render example)

1. Push this folder to a GitHub repo (do NOT commit `.env` or `data/*.db`).
2. Render → New → Web Service → connect repo.
   - Build command: `npm install`
   - Start command: `npm run migrate && npm run seed && npm start`
     (skip `seed` if you already have real data — seed only adds demo rows
     when tables are empty… actually the seed is idempotent for users but
     always inserts demo students; **do not run seed against real data**)
   - Environment: `NODE_ENV=production`, `SESSION_SECRET` (long random),
     `COOKIE_SECURE=1`, `APP_URL=https://<your-app>.onrender.com`
3. **SQLite persistence warning:** Render's free disk is ephemeral — the
   database file is wiped on redeploy/restart. For a real pilot use either
   Render's paid disk, or switch `src/db/index.js` to Postgres
   (the schema is standard SQL; only `AUTOINCREMENT` → `SERIAL` and the
   `node:sqlite` calls need a `pg` swap — ask before doing this).

## First-run checklist

- [ ] `cp .env.example .env` and set `SESSION_SECRET`, `APP_URL`, `COOKIE_SECURE=1`
- [ ] `npm install && npm run migrate && npm run seed` (demo) — or migrate only (real)
- [ ] Log in as `admin`, open **Management → fine types**: engine stays **OFF**
      until the institution approves the PKR 50/100 proposals
- [ ] Change ALL demo passwords immediately (`admin`, `principal`, teacher,
      student, parent accounts) — the seed passwords are public in this repo
      and must never be used in production
- [ ] Add real SMTP creds to `.env` to enable email alerts; test with
      `node scripts/notify-worker.js`
- [ ] Verify the disclaimer is visible on the homepage

## Security notes

- Passwords: bcrypt, never stored in plain text, never in CSV exports.
- Sessions: httpOnly + SameSite=lax cookies; set `COOKIE_SECURE=1` behind HTTPS.
- Rate limiting on `/login` (30 attempts / 15 min per IP).
- Role checks are server-side on every route; parents can only see
  verified-linked children (enforced in the SQL, not the UI).
- Run `npm test` (46 E2E checks) after any change before deploying.
