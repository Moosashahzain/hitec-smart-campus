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

const { publicShell } = require('../lib/layout');

// Split-screen auth card: photo side + form side
function authPage(title, formHtml, img, imgTitle, imgText) {
  const body = `<section class="section" style="padding-top:7.5rem;min-height:100svh;display:flex;align-items:center"><div class="wrap" style="width:100%">
  <div class="split reveal in" style="max-width:920px;margin:0 auto">
    <div class="split-media"><img src="${img}" alt=""><div class="veil"></div>
      <div class="cap"><h3>${imgTitle}</h3><p>${imgText}</p></div></div>
    <div class="split-body">
      <a href="/" style="display:inline-flex;align-items:center;gap:.5rem;text-decoration:none;font-weight:800;margin-bottom:1.2rem"><img src="/logo.png" alt="" style="width:34px;height:34px;border-radius:50%;background:#fff">HITEC Smart Campus</a>
      <h1 style="margin:0 0 .3rem;font-size:1.6rem">${title}</h1>
      ${formHtml}
      <div class="disclaimer">Student project proposal — not officially endorsed by HITEC Schools &amp; Colleges.<br>Demo accounts: admin / principal / T-1001 / STU-2026-001 / P-1001</div>
    </div>
  </div></div></section>`;
  return publicShell({ title: title + ' — HITEC Smart Campus', body, active: '' });
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(ROLE_HOME[req.session.user.role] || '/');
  res.send(authPage('Welcome back',
    `${req.query.e ? '<div class="err">Invalid login or inactive account.</div>' : ''}
    <form method="post" action="/login">
      <div class="field"><label>Student ID / Staff ID / Username<input name="login" required autocomplete="username" placeholder="e.g. STU-2026-001"></label></div>
      <div class="field"><label>Password<input type="password" name="password" required autocomplete="current-password" placeholder="••••••••"></label></div>
      <button class="btn gold btn-block" style="margin-top:.4rem">Log in →</button>
    </form>
    <p style="text-align:center;margin-top:1rem;font-size:.88rem"><a href="/forgot-password">Forgot password?</a></p>`,
    '/media/classroom.webp', 'One login, every role', 'Management, teachers, students and parents — each with their own secure portal.'));
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
  res.send(authPage('Reset password',
    req.query.sent
      ? '<div class="msg">A reset link was generated. In production this is emailed; in demo mode the token is logged server-side.</div><p style="text-align:center"><a href="/login">← Back to login</a></p>'
      : `<form method="post">
        <div class="field"><label>Login ID<input name="login" required placeholder="Your username / ID"></label></div>
        <button class="btn btn-block" style="margin-top:.4rem">Send reset link</button>
      </form><p style="text-align:center;margin-top:1rem;font-size:.88rem"><a href="/login">← Back to login</a></p>`,
    '/media/library.webp', 'Locked out?', 'Reset your password securely with an emailed link.'));
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
  res.send(authPage('Set new password',
    `<form method="post" action="/reset-password?token=${encodeURIComponent(req.query.token)}">
      <div class="field"><label>New password (min 8 chars)<input type="password" name="password" required minlength="8" placeholder="••••••••"></label></div>
      <button class="btn gold btn-block" style="margin-top:.4rem">Set password</button>
    </form>`,
    '/media/campus.webp', 'Almost there', 'Choose a strong new password for your account.'));
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
