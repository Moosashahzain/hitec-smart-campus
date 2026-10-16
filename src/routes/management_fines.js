// Management: fines, leave approvals, attendance correction approvals.
const express = require('express');
const { db } = require('../db');
const { requireManagement } = require('../middleware/auth');
const { decideCorrection } = require('../lib/attendance');
const { audit } = require('./auth');

const router = express.Router();
router.use(requireManagement);

const { portalShell } = require('../lib/layout');
const PORTAL_LINKS = [('/management', '← Dashboard'), ('/management/fines', 'Fines'), ('/management/fines/types', '⚙️ Configure')];
function layout(title, user, body) {
  return portalShell({ title, user, links: PORTAL_LINKS, body, home: '/management' });
}


// ---------- Fine types (config) ----------
router.get('/fines/types', (req, res) => {
  const types = db.prepare('SELECT * FROM fine_types ORDER BY id').all();
  const enabled = db.prepare(`SELECT value FROM system_settings WHERE key='fine_engine_enabled'`).get().value;
  res.send(layout('Fine types', req.session.user, `<h2>Fine configuration</h2>
${enabled !== '1' ? '<div class="warn">⚠️ Fine engine is OFF. Fines are proposed settings — require management approval before activating. No automatic fines are generated while off.</div>'
: '<div class="msg">Fine engine is ON — automatic fines generate on attendance submission.</div>'}
<form method="post" action="/management/fines/engine" class="inline">
<button class="btn ${enabled === '1' ? 'danger' : 'gold'}">${enabled === '1' ? 'Disable fine engine' : 'Enable fine engine (management approval)'}</button></form>
<table style="margin-top:1rem"><tr><th>Name</th><th>Amount (PKR)</th><th>Trigger</th><th>Active</th><th></th></tr>
${types.map(t => `<tr><td>${t.name}</td><td>${t.amount_pkr}</td><td>${t.trigger}</td><td>${t.active ? 'yes' : 'no'}</td>
<td><form class="inline" method="post" action="/management/fines/types/${t.id}/toggle"><button class="btn small">${t.active ? 'Deactivate' : 'Activate'}</button></form></td></tr>`).join('')}
</table>`));
});

router.post('/fines/engine', (req, res) => {
  const cur = db.prepare(`SELECT value FROM system_settings WHERE key='fine_engine_enabled'`).get().value;
  const next = cur === '1' ? '0' : '1';
  db.prepare(`UPDATE system_settings SET value=?, updated_at=datetime('now') WHERE key='fine_engine_enabled'`).run(next);
  audit(req.session.user.id, 'fine_engine_' + (next === '1' ? 'enabled' : 'disabled'), 'system_settings', null, null);
  res.redirect('/management/fines/types');
});

router.post('/fines/types/:id/toggle', (req, res) => {
  db.prepare(`UPDATE fine_types SET active = 1 - active WHERE id=?`).run(req.params.id);
  audit(req.session.user.id, 'fine_type_toggled', 'fine_type', req.params.id, null);
  res.redirect('/management/fines/types');
});

// ---------- Fine records ----------
router.get('/fines', (req, res) => {
  const { status = '' } = req.query;
  const where = status ? 'AND f.status=?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`SELECT f.*, st.name, st.student_id FROM fine_records f JOIN students st ON st.id=f.student_id
    WHERE 1=1 ${where} ORDER BY f.date DESC LIMIT 200`).all(...params);
  res.send(layout('Fines', req.session.user, `<h2>Fine records <a href="/management/fines/types">⚙️ configure</a></h2>
<form method="get" class="inline"><select name="status" onchange="this.form.submit()"><option value="">All</option>
${['pending', 'paid', 'waived', 'disputed'].map(s => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></form>
<table style="margin-top:.6rem"><tr><th>Date</th><th>Student</th><th>Reason</th><th>PKR</th><th>Status</th><th></th></tr>
${rows.map(f => `<tr><td>${f.date}</td><td>${f.name} (${f.student_id})</td><td>${f.reason}</td><td>${f.amount_pkr}</td><td>${f.status}</td>
<td>${f.status === 'pending' || f.status === 'disputed' ? `
<form class="inline" method="post" action="/management/fines/${f.id}/paid"><button class="btn small gold">Mark paid</button></form>
<form class="inline" method="post" action="/management/fines/${f.id}/waive"><button class="btn small">Waive</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan=6>No fines.</td></tr>'}</table>
<p style="font-size:.78rem;color:#8a97a8">Mark Paid only after payment is verified through an authorized process. No real payment integration is configured.</p>`));
});

router.post('/fines/:id/:action', (req, res) => {
  const { action } = req.params;
  if (!['paid', 'waive'].includes(action)) return res.status(400).send('Bad action');
  const f = db.prepare('SELECT * FROM fine_records WHERE id=?').get(req.params.id);
  if (!f || !['pending', 'disputed'].includes(f.status)) return res.status(400).send('Cannot change this fine.');
  const to = action === 'paid' ? 'paid' : 'waived';
  db.prepare(`UPDATE fine_records SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?`)
    .run(to, req.session.user.id, f.id);
  audit(req.session.user.id, 'fine_' + to, 'fine_record', f.id, `PKR ${f.amount_pkr}`);
  res.redirect('/management/fines');
});

// ---------- Leave approvals ----------
router.get('/leaves', (req, res) => {
  const rows = db.prepare(`SELECT l.*, st.name, st.student_id FROM leave_requests l JOIN students st ON st.id=l.student_id
    ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.id DESC LIMIT 100`).all();
  res.send(layout('Leave requests', req.session.user, `<h2>Leave requests</h2>
<table><tr><th>Student</th><th>From → To</th><th>Reason</th><th>Status</th><th></th></tr>
${rows.map(l => `<tr><td>${l.name} (${l.student_id})</td><td>${l.from_date} → ${l.to_date}</td><td>${l.reason}</td><td>${l.status}</td>
<td>${l.status === 'pending' ? `
<form class="inline" method="post" action="/management/leaves/${l.id}/approve"><button class="btn small gold">Approve</button></form>
<form class="inline" method="post" action="/management/leaves/${l.id}/reject"><button class="btn small danger">Reject</button></form>` : ''}</td></tr>`).join('')}</table>`));
});

router.post('/leaves/:id/:decision', (req, res) => {
  const { decision } = req.params;
  if (!['approve', 'reject'].includes(decision)) return res.status(400).send('Bad decision');
  const l = db.prepare('SELECT * FROM leave_requests WHERE id=? AND status=?').get(req.params.id, 'pending');
  if (!l) return res.status(400).send('Not pending.');
  db.prepare(`UPDATE leave_requests SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?`)
    .run(decision === 'approve' ? 'approved' : 'rejected', req.session.user.id, l.id);
  // notify the student's user
  const st = db.prepare('SELECT user_id FROM students WHERE id=?').get(l.student_id);
  if (st && st.user_id) {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?,?,?,?)`)
      .run(st.user_id, 'Leave ' + decision + 'd', `Leave ${decision}d`, `Your leave ${l.from_date} → ${l.to_date} was ${decision}d.`);
  }
  audit(req.session.user.id, 'leave_' + decision + 'd', 'leave_request', l.id, null);
  res.redirect('/management/leaves');
});

// ---------- Correction approvals ----------
router.get('/corrections', (req, res) => {
  const rows = db.prepare(`SELECT c.*, u.login AS requester FROM attendance_corrections c JOIN users u ON u.id=c.requested_by
    ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.id DESC LIMIT 100`).all();
  res.send(layout('Corrections', req.session.user, `<h2>Attendance corrections</h2>
<table><tr><th>#</th><th>By</th><th>Change</th><th>Reason</th><th>Status</th><th></th></tr>
${rows.map(c => `<tr><td>${c.id}</td><td>${c.requester}</td><td>${c.old_status} → <b>${c.new_status}</b></td><td>${c.reason}</td><td>${c.status}</td>
<td>${c.status === 'pending' ? `
<form class="inline" method="post" action="/management/corrections/${c.id}/approve"><button class="btn small gold">Approve</button></form>
<form class="inline" method="post" action="/management/corrections/${c.id}/reject"><button class="btn small danger">Reject</button></form>` : ''}</td></tr>`).join('')}</table>`));
});

router.post('/corrections/:id/:decision', (req, res) => {
  try {
    decideCorrection({ adminId: req.session.user.id, correctionId: +req.params.id, approve: req.params.decision === 'approve' });
    res.redirect('/management/corrections');
  } catch (e) { res.status(400).send(e.message); }
});

module.exports = router;
