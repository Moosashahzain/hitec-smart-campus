// HITEC Smart Campus — application entry
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('./db'); // ensures DB file exists
const { publicShell, head, DISCLAIMER } = require('./lib/layout');

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
  let notices = [], stats = { students: 0, teachers: 0, classes: 0 };
  try {
    const { db } = require('./db');
    notices = db.prepare(`SELECT title, body, created_at FROM notices WHERE published=1 AND audience='public' ORDER BY id DESC LIMIT 3`).all();
    stats.students = db.prepare(`SELECT COUNT(*) c FROM students WHERE status='active'`).get().c;
    stats.teachers = db.prepare(`SELECT COUNT(*) c FROM teachers WHERE status='active'`).get().c;
    stats.classes = db.prepare(`SELECT COUNT(*) c FROM classes`).get().c;
  } catch (e) { /* public page must never 500 on DB hiccup */ }

  const body = `
<header class="hero">
  <div class="hero-bg"></div><div class="hero-veil"></div>
  <div class="hero-content">
    <span class="hero-badge"><span class="dot"></span>Admissions open · Session 2026</span>
    <h1>HITEC <span class="gold">Smart Campus</span></h1>
    <p class="lead">Attendance, results, fines &amp; parent-teacher connection — one secure digital campus for HITEC Schools &amp; Colleges, Taxila Cantt.</p>
    <div class="hero-ctas">
      <a class="btn gold" href="/login">Open portals →</a>
      <a class="btn ghost" href="#features">Explore features</a>
    </div>
    <div class="hero-stats">
      <div class="hstat"><b data-count="${stats.students}">0</b><span>Students</span></div>
      <div class="hstat"><b data-count="${stats.teachers}">0</b><span>Teachers</span></div>
      <div class="hstat"><b data-count="${stats.classes}">0</b><span>Classes</span></div>
      <div class="hstat"><b data-count="4">0</b><span>Portals</span></div>
    </div>
  </div>
  <div class="scroll-hint">Scroll</div>
</header>

<div class="marquee"><div class="marquee-track">
<span><i>✦</i> Paperless attendance</span><span><i>✦</i> Instant parent alerts</span><span><i>✦</i> Published results</span><span><i>✦</i> Smart fines</span><span><i>✦</i> CSV import / export</span><span><i>✦</i> Secure invitations</span>
<span><i>✦</i> Paperless attendance</span><span><i>✦</i> Instant parent alerts</span><span><i>✦</i> Published results</span><span><i>✦</i> Smart fines</span><span><i>✦</i> CSV import / export</span><span><i>✦</i> Secure invitations</span>
</div></div>

<section class="section" id="portals"><div class="wrap">
  <div class="sec-head reveal"><span class="kicker">Role-based access</span>
    <h2>One campus, four portals</h2>
    <p>Everyone sees exactly what they need — nothing more. Secure login, no shared passwords.</p></div>
  <div class="portal-grid">
    <div class="pcard reveal" style="--d:.0s"><div class="pcard-img">🏫</div><div class="pcard-body">
      <h3>Management</h3><p>Students, teachers, admissions, attendance oversight, fines, leave approvals &amp; reports.</p>
      <a class="btn" href="/login">Management login</a></div></div>
    <div class="pcard reveal" style="--d:.1s"><div class="pcard-img">✋</div><div class="pcard-body">
      <h3>Teacher</h3><p>Mark a full class attendance from any phone in under a minute. Corrections via approval.</p>
      <a class="btn" href="/login">Teacher login</a></div></div>
    <div class="pcard reveal" style="--d:.2s"><div class="pcard-img">🎒</div><div class="pcard-body">
      <h3>Student</h3><p>Attendance %, published results, timetable, fines and leave requests — all in one place.</p>
      <a class="btn" href="/login">Student login</a></div></div>
    <div class="pcard reveal" style="--d:.3s"><div class="pcard-img">👨‍👩‍👧</div><div class="pcard-body">
      <h3>Parent</h3><p>Instant absence alerts, results &amp; fines for linked children only. Total privacy.</p>
      <a class="btn" href="/login">Parent login</a></div></div>
  </div>
</div></section>

<section class="section" id="features" style="background:#fff"><div class="wrap">
  <div class="sec-head reveal"><span class="kicker">Capabilities</span>
    <h2>Built for a real campus</h2>
    <p>Every workflow a school office handles daily — digitized, secured and audited.</p></div>
  <div class="feat-grid">
    <div class="feat reveal" style="--d:0s"><div class="e">📋</div><h3>Paperless attendance</h3><p>Duplicate protection, leave-aware marking and one-tap class sessions.</p></div>
    <div class="feat reveal" style="--d:.08s"><div class="e">🔔</div><h3>Instant parent alerts</h3><p>The moment a student is marked absent, parents are notified automatically.</p></div>
    <div class="feat reveal" style="--d:.16s"><div class="e">🧾</div><h3>Configurable fines</h3><p>Fine engine stays off until management explicitly approves each policy.</p></div>
    <div class="feat reveal" style="--d:.24s"><div class="e">📊</div><h3>Published results</h3><p>Grading schemes, exam publishing workflow and per-student report cards.</p></div>
    <div class="feat reveal" style="--d:.32s"><div class="e">📥</div><h3>CSV import / export</h3><p>Admissions season made easy — bulk onboard students and teachers.</p></div>
    <div class="feat reveal" style="--d:.4s"><div class="e">🔐</div><h3>Secure invitations</h3><p>No shared passwords. Every account is provisioned with a unique expiring link.</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="stats-band reveal">
    <div class="stat"><b><span data-count="${stats.students}">0</span>+</b><span>Active students</span></div>
    <div class="stat"><b><span data-count="${stats.teachers}">0</span>+</b><span>Faculty members</span></div>
    <div class="stat"><b><span data-count="${stats.classes}">0</span></b><span>Classes managed</span></div>
    <div class="stat"><b><span data-count="100">0</span>%</b><span>Paperless vision</span></div>
  </div>
</div></section>

<section class="section" id="gallery" style="padding-top:0"><div class="wrap">
  <div class="sec-head reveal"><span class="kicker">Campus life</span>
    <h2>Glimpses of the campus</h2>
    <p>Illustrative imagery for this student proposal — real photography appears once the institution authorizes media use.</p></div>
  <div class="gal-grid">
    <figure class="gal reveal" style="--d:0s;margin:0"><img src="/media/campus.webp" alt="Campus building" loading="lazy"><figcaption>Modern campus block</figcaption></figure>
    <figure class="gal reveal" style="--d:.1s;margin:0"><img src="/media/classroom.webp" alt="Smart classroom" loading="lazy"><figcaption>Smart classrooms</figcaption></figure>
    <figure class="gal reveal" style="--d:.2s;margin:0"><img src="/media/library.webp" alt="Library" loading="lazy"><figcaption>Library &amp; study halls</figcaption></figure>
  </div>
  <p class="reveal" style="text-align:center;margin-top:1.4rem"><a href="https://hitec.edu.pk/picture-gallery/" target="_blank" rel="noopener">Official gallery: hitec.edu.pk/picture-gallery →</a></p>
</div></section>

<section class="section" id="about" style="padding-top:0"><div class="wrap">
  <div class="split reveal">
    <div class="split-media"><img src="/media/classroom.webp" alt="Students in a smart classroom" loading="lazy"><div class="veil"></div>
      <div class="cap"><h3>Digital-first schooling</h3><p>Designed with Taxila Cantt's classrooms in mind.</p></div></div>
    <div class="split-body">
      <span class="kicker">Why Smart Campus</span>
      <h2 style="margin:.4rem 0 1rem;font-size:1.7rem">Less paperwork.<br>More teaching.</h2>
      <p style="color:var(--muted);line-height:1.7">Registers get lost. Phone calls get missed. Smart Campus keeps every attendance mark, result and fine in one audited system — so teachers teach, parents stay informed, and management sees the whole picture at a glance.</p>
      <div style="margin-top:1.4rem"><a class="btn gold" href="/login">Try the live demo</a></div>
    </div>
  </div>
</div></section>

<section class="section" id="notices" style="padding-top:0"><div class="wrap" style="max-width:820px">
  <div class="sec-head reveal"><span class="kicker">Bulletin</span><h2>Latest notices</h2></div>
  ${notices.length ? notices.map(n => `<div class="notice-card reveal"><strong>${n.title}</strong><br><small>${n.body}</small><br><small>${n.created_at}</small></div>`).join('') : '<div class="notice-card">No public notices yet.</div>'}
  <p class="reveal" style="text-align:center"><a href="/notices">All notices →</a></p>
</div></section>

<section class="section" id="contact" style="padding-top:0"><div class="wrap" style="max-width:820px">
  <div class="card reveal" style="text-align:center;padding:2.6rem">
    <span class="kicker">Get in touch</span>
    <h2 style="margin:.4rem 0 .8rem">Contact the institution</h2>
    <p style="color:var(--muted)">📞 +92-51-9043100, +92-51-9043101<br>🌐 <a href="https://hitec.edu.pk/" target="_blank" rel="noopener">hitec.edu.pk</a></p>
    <p class="disclaimer">Official contact details from the public website. This demo project has no affiliation.</p>
  </div>
</div></section>`;

  res.send(publicShell({
    title: 'HITEC Smart Campus — College Management System',
    desc: 'Student project proposal: attendance, results, fines and portals for HITEC Schools & Colleges, Taxila Cantt.',
    body, active: 'home',
  }));
});

// Public notices (only published, public audience — never private data)
app.get('/notices', (req, res) => {
  const { db } = require('./db');
  const ns = db.prepare(`SELECT title, body, created_at FROM notices WHERE published=1 AND audience='public' ORDER BY id DESC LIMIT 20`).all();
  const body = `<section class="section" style="padding-top:7rem"><div class="wrap" style="max-width:760px">
<h2 style="font-size:2rem;margin:0 0 .4rem">Public notices</h2>
<p style="margin:0 0 1.6rem"><a href="/">← Home</a></p>
${ns.map(n => `<div class="notice-card reveal in"><strong>${n.title}</strong><br><small>${n.body}</small><br><small style="color:#8a97a8">${n.created_at}</small></div>`).join('') || '<div class="notice-card">No notices published.</div>'}
</div></section>`;
  res.send(publicShell({ title: 'Notices — HITEC Smart Campus', body, active: 'notices' }));
});

app.use((req, res) => res.status(404).send('Not found'));

if (require.main === module) {
  app.listen(PORT, () => console.log(`HITEC Smart Campus on http://localhost:${PORT}`));
}
module.exports = app;
