// Invitation acceptance: set your own password via a single-use token link.
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { tokenHash } = require('../lib/provision');
const { audit } = require('./auth');
const { publicShell } = require('../lib/layout');

const router = express.Router();

router.get('/invite/:token', (req, res) => {
  const inv = db.prepare(`SELECT i.*, u.login FROM invitations i JOIN users u ON u.id=i.user_id
    WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at > datetime('now')`)
    .get(tokenHash(req.params.token));
  if (!inv) return res.status(400).send('Invalid or expired invitation link.');
  const body = `<section class="section" style="padding-top:7.5rem;min-height:100svh;display:flex;align-items:center"><div class="wrap" style="width:100%">
  <div class="split reveal in" style="max-width:920px;margin:0 auto">
    <div class="split-media"><img src="/media/campus.webp" alt=""><div class="veil"></div>
      <div class="cap"><h3>You're invited 🎉</h3><p>Join the HITEC Smart Campus demo.</p></div></div>
    <div class="split-body">
      <h1 style="margin:0 0 .3rem;font-size:1.6rem">Welcome!</h1>
      <p style="color:var(--muted)">Account <b>${inv.login}</b> — choose your password (min 8 characters).</p>
      <form method="post"><div class="field"><label>New password<input type="password" name="password" required minlength="8" placeholder="••••••••"></label></div>
      <button class="btn gold btn-block">Activate account →</button></form>
      <div class="disclaimer">Student project proposal — not officially endorsed by HITEC Schools &amp; Colleges.</div>
    </div>
  </div></div></section>`;
  res.send(publicShell({ title: 'Set up your account — HITEC Smart Campus', body, active: '' }));
});

router.post('/invite/:token', (req, res) => {
  const pw = req.body.password || '';
  if (pw.length < 8) return res.status(400).send('Password must be at least 8 characters.');
  const inv = db.prepare(`SELECT i.*, u.id AS uid FROM invitations i JOIN users u ON u.id=i.user_id
    WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at > datetime('now')`)
    .get(tokenHash(req.params.token));
  if (!inv) return res.status(400).send('Invalid or expired invitation link.');
  db.prepare('UPDATE users SET password_hash=?, status=?, must_change_password=0 WHERE id=?')
    .run(bcrypt.hashSync(pw, 10), 'active', inv.uid);
  db.prepare('UPDATE invitations SET used_at=datetime(\'now\') WHERE id=?').run(inv.id);
  audit(inv.uid, 'account_activated', 'user', inv.uid, null);
  res.redirect('/login');
});

module.exports = router;
