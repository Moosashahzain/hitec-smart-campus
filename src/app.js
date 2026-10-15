// HITEC Smart Campus — application entry
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('./db'); // ensures DB file exists

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false })); // CSP tightened before production
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('src/public'));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/login', loginLimiter);

app.use(session({
  name: 'hsc.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1', maxAge: 12 * 60 * 60 * 1000 },
}));

const { router: authRouter } = require('./routes/auth');
const inviteRouter = require('./routes/invite');
const managementRouter = require('./routes/management');
const managementFinesRouter = require('./routes/management_fines');
const teacherRouter = require('./routes/teacher');
const studentRouter = require('./routes/student');
const parentRouter = require('./routes/parent');
app.use('/', authRouter);
app.use('/', inviteRouter);
app.use('/management', managementRouter);
app.use('/management', managementFinesRouter);
app.use('/teacher', teacherRouter);
app.use('/student', studentRouter);
app.use('/parent', parentRouter);

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/', (req, res) => {
  let notices = [];
  try {
    const { db } = require('./db');
    notices = db.prepare(`SELECT title, body, created_at FROM notices WHERE published=1 AND audience='public' ORDER BY id DESC LIMIT 3`).all();
  } catch (e) { /* public page must never 500 on DB hiccup */ }
  const PWA = `<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0A5C99">
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon-192.png">
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}</script>`;
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HITEC Smart Campus — College Management System</title>
<meta name="description" content="Student project proposal: attendance, results, fines and portals for HITEC Schools & Colleges, Taxila Cantt.">
${PWA}<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#E9F3FA;color:#0A5C99}
.hero{background:linear-gradient(135deg,#0A5C99 60%,#084E7D);color:#fff;padding:3.5rem 1.5rem 3rem;text-align:center}
.hero .mark{width:72px;height:72px;margin:0 auto 1rem}
.hero h1{margin:0 0 .4rem;font-size:2.1rem;letter-spacing:.5px}.gold{color:#FFD21F}
.hero p{opacity:.85;max-width:560px;margin:.4rem auto}
.cta{display:inline-block;margin-top:1.2rem;background:#FFD21F;color:#0A5C99;font-weight:700;padding:.8rem 1.8rem;border-radius:10px;text-decoration:none}
.wrap{max-width:1024px;margin:0 auto;padding:2rem 1rem}
.sec{margin:2.2rem 0}.sec h2{font-size:1.25rem;margin:0 0 .8rem}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
.card{background:#fff;border-radius:14px;padding:1.4rem;box-shadow:0 6px 18px rgba(10,92,153,.08)}
.card h3{margin:.2rem 0 .4rem}.card p{font-size:.88rem;color:#5a6b82;margin:.2rem 0 .8rem}
.card a{display:inline-block;background:#0A5C99;color:#fff;padding:.55rem 1.1rem;border-radius:8px;text-decoration:none;font-size:.9rem}
.feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.8rem}
.feat div{background:#fff;border-radius:12px;padding:1rem;text-align:center;font-size:.85rem}
.feat .e{font-size:1.5rem}
.media{background:#0A5C99;color:#fff;border-radius:14px;padding:1.6rem;text-align:center}
.media a{color:#FFD21F}
.notice-card{background:#fff;border-left:4px solid #FFD21F;border-radius:8px;padding:.9rem 1.1rem;margin-bottom:.6rem}
.notice-card small{color:#8a97a8}
footer{background:#0A5C99;color:#cfd9e6;padding:1.6rem 1rem;text-align:center;font-size:.82rem;margin-top:2rem}
footer a{color:#FFD21F}
.disclaimer{font-size:.75rem;opacity:.75;margin-top:.8rem}
</style></head><body>
<div class="hero">
<img class="mark" src="/logo.png" alt="HITEC logo" style="border-radius:50%;background:#fff">
<h1>HITEC <span class="gold">Smart Campus</span></h1>
<p>Attendance, results, fines &amp; parent-teacher connection — one secure system for HITEC Schools &amp; Colleges, Taxila Cantt.</p>
<a class="cta" href="/login">Open portals</a>
</div>
<div class="wrap">
<div class="sec"><h2>Portals</h2><div class="cards">
<div class="card"><h3>🏫 Management</h3><p>Students, teachers, admissions, attendance oversight, fines &amp; reports.</p><a href="/login">Management login</a></div>
<div class="card"><h3>✋ Teacher</h3><p>Mark attendance from any phone in under a minute. Corrections via approval.</p><a href="/login">Teacher login</a></div>
<div class="card"><h3>🎒 Student</h3><p>Attendance %, published results, timetable, fines, leave requests.</p><a href="/login">Student login</a></div>
<div class="card"><h3>👨‍👩‍👧 Parent</h3><p>Instant absence alerts, results &amp; fines for linked children only.</p><a href="/login">Parent login</a></div>
</div></div>
<div class="sec"><h2>What it does</h2><div class="feat">
<div><div class="e">📋</div>Paperless attendance with duplicate protection</div>
<div><div class="e">🔔</div>Instant parent alerts on absence</div>
<div><div class="e">🧾</div>Configurable fines — off until management approves</div>
<div><div class="e">📊</div>Published results with grading schemes</div>
<div><div class="e">📥</div>CSV import / export for admissions</div>
<div><div class="e">🔐</div>No shared passwords — secure invitation links</div>
</div></div>
<div class="sec"><h2>Latest notices</h2>
${notices.length ? notices.map(n => `<div class="notice-card"><strong>${n.title}</strong><br><small>${n.body}</small><br><small>${n.created_at}</small></div>`).join('') : '<div class="notice-card">No public notices yet.</div>'}
<p><a href="/notices">All notices →</a></p></div>
<div class="sec"><div class="media">
<h2 style="margin-top:0">Campus life</h2>
<p>Photos &amp; videos appear here once the institution authorizes media use.<br>
Meanwhile, explore the official gallery: <a href="https://hitec.edu.pk/picture-gallery/" target="_blank" rel="noopener">hitec.edu.pk/picture-gallery</a></p>
</div></div>
<div class="sec"><h2>Contact the institution</h2><div class="card">
<p style="margin:.2rem 0">📞 +92-51-9043100, +92-51-9043101<br>🌐 <a href="https://hitec.edu.pk/" target="_blank" rel="noopener">hitec.edu.pk</a><br>
<small style="color:#8a97a8">Official contact details from the public website. This demo project has no affiliation.</small></p>
</div></div>
</div>
<footer>
HITEC Smart Campus — a student project proposal.<br>
<a href="/login">Portals</a> · <a href="/notices">Notices</a> · <a href="https://hitec.edu.pk/" target="_blank" rel="noopener">hitec.edu.pk</a>
<div class="disclaimer">Not officially approved or endorsed by HITEC Schools &amp; Colleges. All demo data is fictional. Proposed branding only — not the official logo.</div>
</footer></body></html>`);
});

// Portal stubs (full dashboards land in their phases)
const { requireLogin, requireRole } = require('./middleware/auth');

// Public notices (only published, public audience — never private data)
app.get('/notices', (req, res) => {
  const { db } = require('./db');
  const ns = db.prepare(`SELECT title, body, created_at FROM notices WHERE published=1 AND audience='public' ORDER BY id DESC LIMIT 20`).all();
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notices — HITEC Smart Campus</title><style>
body{font-family:system-ui;margin:0;background:#E9F3FA;color:#0A5C99}
.wrap{max-width:720px;margin:0 auto;padding:2rem 1rem}
.card{background:#fff;border-radius:12px;padding:1.2rem;margin-bottom:.8rem}
a{color:#0A5C99}</style></head><body><div class="wrap">
<h2>Public notices</h2><p><a href="/">← Home</a></p>
${ns.map(n => `<div class="card"><strong>${n.title}</strong><br><small>${n.body}</small><br><small style="color:#8a97a8">${n.created_at}</small></div>`).join('') || '<div class="card">No notices published.</div>'}
</div></body></html>`);
});

app.use((req, res) => res.status(404).send('Not found'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`HITEC Smart Campus on http://localhost:${PORT}`));
}
module.exports = app;
