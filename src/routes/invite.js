// Invitation acceptance: set your own password via a single-use token link.
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { tokenHash } = require('../lib/provision');
const { audit } = require('./auth');

const router = express.Router();

router.get('/invite/:token', (req, res) => {
  const inv = db.prepare(`SELECT i.*, u.login FROM invitations i JOIN users u ON u.id=i.user_id
    WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at > datetime('now')`)
    .get(tokenHash(req.params.token));
  if (!inv) return res.status(400).send('Invalid or expired invitation link.');
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up your account</title><style>
body{font-family:system-ui;background:#E9F3FA;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{background:#fff;padding:2rem;border-radius:14px;width:min(380px,92%)}
input{width:100%;padding:.65rem;border:1px solid #c9d4e2;border-radius:8px;box-sizing:border-box}
button{width:100%;margin-top:1rem;background:#0A5C99;color:#fff;border:0;padding:.75rem;border-radius:8px;cursor:pointer}</style></head>
<body><div class="card"><h3>Welcome!</h3><p>Account <b>${inv.login}</b> — choose your password (min 8 characters).</p>
<form method="post"><label>New password<input type="password" name="password" required minlength="8"></label><button>Activate account</button></form>
<p style="font-size:.75rem;color:#8a97a8">Student project proposal — not officially endorsed by HITEC Schools &amp; Colleges.</p></div></body></html>`);
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
