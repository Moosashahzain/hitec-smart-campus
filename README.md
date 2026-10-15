# HITEC Smart Campus

Full-stack college management system — **student project proposal** for
HITEC Schools & Colleges, Taxila Cantt.
**Not officially approved or endorsed by HITEC Schools & Colleges.**
All demo data is fictional.

Public homepage + Management, Teacher, Student and Parent portals.
Attendance engine, configurable fines (OFF by default), leave workflow,
results, notifications (in-app + email queue), CSV import/export, PWA.

## Quick start

```bash
npm install
npm run migrate   # create tables
npm run seed      # fictional demo data (do NOT run on real data)
npm start         # http://localhost:3000
npm test          # 46 E2E checks
```

Copy `.env.example` to `.env` and set `SESSION_SECRET` (and SMTP for email).

## Demo logins (local only — change before any public deploy)

| Role | Login | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Principal | `principal` | `Principal@123` |
| Teacher | `T-1001` | `Teacher@123` |
| Student | `STU-2026-001` | `Student@123` |
| Parent | `P-1001` | `Parent@123` |

## Deploy

See `docs/DEPLOY.md`. One-click via `render.yaml` (Render Blueprint).
Backups: `docs/BACKUP.md`.

## Stack

Node 24 + Express + built-in `node:sqlite` (zero native deps),
server-rendered UI, bcrypt, express-session.
