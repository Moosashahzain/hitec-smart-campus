// Authentication routes: login, logout, forgot/reset password, change password.
// Passwords: bcrypt hashes only. Setup/reset tokens: random, hashed, expiring.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { db, nowK } = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const ROLE_HOME = {
  super_admin: '/management', principal: '/management', attendance_admin: '/management',
  teacher: '/teacher', student: '/student', parent: '/parent',
};

function audit(actorId, action, entityType, entityId, details) {
  db.prepare(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
              VALUES (?,?,?,?,?)`).run(actorId, action, entityType, entityId, details || null);
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(ROLE_HOME[req.session.user.role] || '/');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Login — HITEC Smart Campus</title>
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0A5C99">
<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon-192.png">
<script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}</script><style>
body{font-family:system-ui;background:#E9F3FA;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;padding:2rem;border-radius:14px;box-shadow:0 10px 30px rgba(10,92,153,.12);width:min(380px,92%)}
h1{color:#0A5C99;font-size:1.3rem;margin:0 0 .3rem}.sub{color:#5a6b82;font-size:.85rem;margin-bottom:1.2rem}
label{display:block;font-size:.8rem;color:#0A5C99;margin:.7rem 0 .25rem}input{width:100%;padding:.65rem;border:1px solid #c9d4e2;border-radius:8px;font-size:1rem;box-sizing:border-box}
button{width:100%;margin-top:1.1rem;background:#0A5C99;color:#fff;border:0;padding:.75rem;border-radius:8px;font-size:1rem;cursor:pointer}
.err{background:#fde8e8;color:#a12020;padding:.6rem;border-radius:8px;font-size:.85rem;margin-bottom:.6rem}
.disclaimer{font-size:.72rem;color:#8a97a8;margin-top:1rem;text-align:center}
</style></head><body><div class="card">
<h1>HITEC Smart Campus</h1><div class="sub">Student project proposal — not officially endorsed by HITEC Schools &amp; Colleges.</div>
${req.query.e ? '<div class="err">Invalid login or inactive account.</div>' : ''}
<form method="post" action="/login">
<label>Student ID / Staff ID / Username<input name="login" required autocomplete="username"></label>
<label>Password<input type="password" name="password" required autocomplete="current-password"></label>
<button>Log in</button></form>
<div class="sub" style="margin-top:.8rem;text-align:center"><a href="/forgot-password">Forgot password?</a></div>
<div class="disclaimer">Demo accounts: admin / principal / T-1001 / STU-2026-001 / P-1001</div>
</div></body></html>`);
});

router.post('/login', (req, res) => {
  const { login, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE login = ?').get((login || '').trim());
  if (!u || u.status !== 'active' || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.redirect('/login?e=1');
  }
  let extra = {};
  if (u.role === 'student') {
    const s = db.prepare('SELECT id, student_id FROM students WHERE user_id = ?').get(u.id);
    if (s) extra = { student_id: s.id, student_code: s.student_id };
  } else if (u.role === 'teacher') {
    const t = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(u.id);
    if (t) extra = { teacher_id: t.id };
  } else if (u.role === 'parent') {
    const p = db.prepare('SELECT id FROM parents WHERE user_id = ?').get(u.id);
    if (p) extra = { parent_id: p.id };
  }
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowK(), u.id);
  req.session.user = { id: u.id, login: u.login, role: u.role, status: u.status, ...extra };
  audit(u.id, 'login', 'user', u.id, null);
  res.redirect(ROLE_HOME[u.role] || '/');
});

router.post('/logout', (req, res) => {
  const uid = req.session.user && req.session.user.id;
  req.session.destroy(() => {
    if (uid) audit(uid, 'logout', 'user', uid, null);
    res.redirect('/login');
  });
});

// --- Forgot / reset password (token emailed in production; logged for demo) ---
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function tokenHash(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

router.get('/forgot-password', (req, res) => {
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset password</title><style>body{font-family:system-ui;background:#E9F3FA;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;padding:2rem;border-radius:14px;width:min(380px,92%)}input{width:100%;padding:.65rem;border:1px solid #c9d4e2;border-radius:8px;box-sizing:border-box}
button{width:100%;margin-top:1rem;background:#0A5C99;color:#fff;border:0;padding:.75rem;border-radius:8px;cursor:pointer}</style></head>
<body><div class="card"><h3>Reset password</h3>
${req.query.sent ? '<p>A reset link was generated. In production this is emailed; in demo mode the token is logged server-side.</p>' : `
<form method="post"><label>Login ID<input name="login" required></label><button>Send reset link</button></form>`}
</div></body></html>`);
});

router.post('/forgot-password', (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE login = ?').get((req.body.login || '').trim());
  if (u) {
    const t = newToken();
    const exp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)`)
      .run(u.id, tokenHash(t), exp);
    console.log(`[DEMO] password reset token for user ${u.id}: /reset-password?token=${t}`);
    audit(u.id, 'password_reset_requested', 'user', u.id, null);
  }
  res.redirect('/forgot-password?sent=1'); // same response either way (no user enumeration)
});

router.get('/reset-password', (req, res) => {
  const r = db.prepare(`SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at > datetime('now')`)
    .get(tokenHash(req.query.token || ''));
  if (!r) return res.status(400).send('Invalid or expired reset link.');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set new password</title>
<style>body{font-family:system-ui;background:#E9F3FA;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;padding:2rem;border-radius:14px;width:min(380px,92%)}input{width:100%;padding:.65rem;border:1px solid #c9d4e2;border-radius:8px;box-sizing:border-box}
button{width:100%;margin-top:1rem;background:#0A5C99;color:#fff;border:0;padding:.75rem;border-radius:8px;cursor:pointer}</style></head>
<body><div class="card"><h3>Set new password</h3><form method="post" action="/reset-password?token=${encodeURIComponent(req.query.token)}">
<label>New password (min 8 chars)<input type="password" name="password" required minlength="8"></label><button>Set password</button></form></div></body></html>`);
});

router.post('/reset-password', (req, res) => {
  const pw = req.body.password || '';
  if (pw.length < 8) return res.status(400).send('Password must be at least 8 characters.');
  const r = db.prepare(`SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL AND expires_at > datetime('now')`)
    .get(tokenHash(req.query.token || ''));
  if (!r) return res.status(400).send('Invalid or expired reset link.');
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?')
    .run(bcrypt.hashSync(pw, 10), r.user_id);
  db.prepare('UPDATE password_resets SET used_at=datetime(\'now\') WHERE id=?').run(r.id);
  audit(r.user_id, 'password_reset_completed', 'user', r.user_id, null);
  res.redirect('/login');
});

// --- Change password (logged in) ---
router.post('/change-password', requireLogin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  const { current, next } = req.body;
  if (!bcrypt.compareSync(current || '', u.password_hash)) return res.status(400).json({ error: 'Current password incorrect' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?')
    .run(bcrypt.hashSync(next, 10), u.id);
  audit(u.id, 'password_changed', 'user', u.id, null);
  res.json({ ok: true });
});

module.exports = { router, audit };
