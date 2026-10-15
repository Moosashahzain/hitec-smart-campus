// Parent portal — verified guardian relationships ONLY (enforced in every query).
const express = require('express');
const { db, todayK } = require('../db');
const { requireRole } = require('../middleware/auth');
const { studentSummary } = require('../lib/attendance');

const router = express.Router();
router.use(requireRole('parent'));
const pid = (req) => req.session.user.parent_id;

// Every child access goes through this: parent must be a VERIFIED guardian.
function childOf(req, studentId) {
  return db.prepare(`SELECT st.* FROM students st JOIN student_guardians sg ON sg.student_id=st.id
    WHERE sg.parent_id=? AND sg.student_id=? AND sg.verified=1`).get(pid(req), studentId);
}
function myChildren(req) {
  return db.prepare(`SELECT st.*, c.name AS cn, sc.name AS sn, sg.relationship FROM students st
    JOIN student_guardians sg ON sg.student_id=st.id
    LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN sections sc ON sc.id=st.section_id
    WHERE sg.parent_id=? AND sg.verified=1`).all(pid(req));
}

function layout(title, user, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Parent</title><style>
body{font-family:system-ui;margin:0;background:#E9F3FA;color:#0A5C99}
.bar{background:#0A5C99;color:#fff;padding:.9rem 1.1rem;display:flex;justify-content:space-between;align-items:center}
.wrap{max-width:720px;margin:0 auto;padding:1rem}
.card{background:#fff;border-radius:12px;padding:1rem;margin-bottom:.8rem;box-shadow:0 4px 14px rgba(10,92,153,.07)}
.btn{display:inline-block;background:#0A5C99;color:#fff;border:0;padding:.6rem 1.1rem;border-radius:9px;cursor:pointer;text-decoration:none;font-size:.9rem}
.big{font-size:1.6rem;font-weight:700}
.alert{background:#fff4e0;border-left:4px solid #b26a00;padding:.7rem;border-radius:8px;margin-bottom:.8rem;font-size:.88rem}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:.85rem}
th,td{padding:.55rem;text-align:left;border-bottom:1px solid #e6ecf3}th{background:#0A5C99;color:#fff}
</style></head><body>
<div class="bar"><strong>Parent Portal</strong><form method="post" action="/logout"><button style="background:#FFD21F;color:#0A5C99;border:0;padding:.45rem .9rem;border-radius:8px;cursor:pointer">${user.login}</button></form></div>
<div class="wrap">${body}</div></body></html>`;
}

router.get('/', (req, res) => {
  const kids = myChildren(req);
  const unread = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL`).get(req.session.user.id).c;
  let html = `<h2>My children</h2>${unread ? `<div class="alert">🔔 ${unread} unread notification${unread > 1 ? 's' : ''} — <a href="/parent/notifications">view</a></div>` : ''}`;
  for (const k of kids) {
    const sum = studentSummary(k.id, '2000-01-01', todayK());
    const fines = db.prepare(`SELECT SUM(amount_pkr) t FROM fine_records WHERE student_id=? AND status='pending'`).get(k.id).t || 0;
    const recent = db.prepare(`SELECT s.date, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id
      WHERE r.student_id=? AND r.status IN ('absent','late') ORDER BY s.date DESC LIMIT 3`).all(k.id);
    html += `<div class="card"><strong>${k.name}</strong> <small>(${k.cn || ''}-${k.sn || ''} · ${k.relationship})</small><br>
    Attendance: <b>${sum.pct == null ? '—' : sum.pct + '%'}</b> · Pending fines: <b>PKR ${fines}</b>
    ${recent.map(r => `<div class="alert">⚠️ ${r.date}: marked <b>${r.status}</b></div>`).join('')}
    <a class="btn" href="/parent/child/${k.id}">View details</a></div>`;
  }
  res.send(layout('Home', req.session.user, html || '<div class="card">No verified linked children. Contact the school office.</div>'));
});

router.get('/child/:id', (req, res) => {
  const k = childOf(req, req.params.id);
  if (!k) return res.status(403).send('Not authorized to view this student.');
  const sum = studentSummary(k.id, '2000-01-01', todayK());
  const hist = db.prepare(`SELECT s.date, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id
    WHERE r.student_id=? ORDER BY s.date DESC LIMIT 30`).all(k.id);
  const exams = db.prepare(`SELECT * FROM exams WHERE class_id=? AND status='published' ORDER BY id DESC`).all(k.class_id);
  const fines = db.prepare(`SELECT f.*, t.name AS tname FROM fine_records f LEFT JOIN fine_types t ON t.id=f.fine_type_id
    WHERE f.student_id=? ORDER BY f.date DESC`).all(k.id);
  let results = '';
  for (const ex of exams) {
    const marks = db.prepare(`SELECT m.obtained, m.max_marks, s.name FROM marks m JOIN subjects s ON s.id=m.subject_id
      WHERE m.exam_id=? AND m.student_id=?`).all(ex.id, k.id);
    if (!marks.length) continue;
    const tot = marks.reduce((a, m) => a + m.obtained, 0), max = marks.reduce((a, m) => a + m.max_marks, 0);
    results += `<div class="card"><strong>${ex.name}</strong>: ${tot}/${max} (${(100 * tot / max).toFixed(1)}%)</div>`;
  }
  res.send(layout(k.name, req.session.user, `<h2>${k.name}</h2>
<div class="card">Overall attendance: <b class="big">${sum.pct == null ? '—' : sum.pct + '%'}</b><br>
<small>Present ${sum.present} · Absent ${sum.absent} · Late ${sum.late} · Leave ${sum.leave}</small></div>
<h3>Recent attendance</h3><table><tr><th>Date</th><th>Status</th></tr>${hist.map(r => `<tr><td>${r.date}</td><td>${r.status}</td></tr>`).join('')}</table>
<h3>Results (published)</h3>${results || '<div class="card"><small>None yet.</small></div>'}
<h3>Fines</h3>${fines.map(f => `<div class="card"><small><b>${f.tname || f.reason}</b> — PKR ${f.amount_pkr} (${f.date}) · <b>${f.status}</b></small></div>`).join('') || '<div class="card"><small>No fines.</small></div>'}
<br><a class="btn" href="/parent">Back</a>`));
});

router.get('/notifications', (req, res) => {
  const ns = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30`).all(req.session.user.id);
  db.prepare(`UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL`).run(req.session.user.id);
  res.send(layout('Notifications', req.session.user, `<h2>Notifications</h2>` +
    (ns.map(n => `<div class="card"><strong>${n.title}</strong><br><small>${n.body}</small><br><small style="color:#8a97a8">${n.created_at}</small></div>`).join('') || '<div class="card">No notifications.</div>') +
    `<br><a class="btn" href="/parent">Back</a>`));
});

module.exports = router;
