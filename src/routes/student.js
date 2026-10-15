// Student portal — students see ONLY their own records (enforced by session, never by URL).
const express = require('express');
const { db, todayK } = require('../db');
const { requireRole } = require('../middleware/auth');
const { studentSummary } = require('../lib/attendance');

const router = express.Router();
router.use(requireRole('student'));
const sid = (req) => req.session.user.student_id;

function layout(title, user, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Student</title><style>
body{font-family:system-ui;margin:0;background:#E9F3FA;color:#0A5C99}
.bar{background:#0A5C99;color:#fff;padding:.9rem 1.1rem;display:flex;justify-content:space-between;align-items:center}
.wrap{max-width:720px;margin:0 auto;padding:1rem}
.card{background:#fff;border-radius:12px;padding:1rem;margin-bottom:.8rem;box-shadow:0 4px 14px rgba(10,92,153,.07)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:.7rem}
.big{font-size:1.7rem;font-weight:700;color:#0A5C99}
.btn{display:inline-block;background:#0A5C99;color:#fff;border:0;padding:.6rem 1.1rem;border-radius:9px;cursor:pointer;text-decoration:none;font-size:.9rem}
.nav{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.8rem}
.nav a{background:#fff;border:1px solid #c9d4e2;border-radius:9px;padding:.55rem .9rem;text-decoration:none;color:#0A5C99;font-size:.85rem}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:.85rem}
th,td{padding:.55rem;text-align:left;border-bottom:1px solid #e6ecf3}th{background:#0A5C99;color:#fff}
input,select,textarea{padding:.55rem;border:1px solid #c9d4e2;border-radius:8px;font-size:.9rem;width:100%;box-sizing:border-box}
.msg{background:#e7f6ec;border:1px solid #bfe6c9;padding:.7rem;border-radius:8px;margin-bottom:.8rem}
@media(max-width:560px){.grid{grid-template-columns:1fr}}
</style></head><body>
<div class="bar"><strong>Student Portal</strong><form method="post" action="/logout"><button style="background:#FFD21F;color:#0A5C99;border:0;padding:.45rem .9rem;border-radius:8px;cursor:pointer">${user.login}</button></form></div>
<div class="wrap"><div class="nav"><a href="/student">Home</a><a href="/student/attendance">Attendance</a><a href="/student/results">Results</a><a href="/student/fines">Fines</a><a href="/student/leave">Leave</a><a href="/student/notices">Notices</a></div>${body}</div></body></html>`;
}

router.get('/', (req, res) => {
  const id = sid(req);
  const st = db.prepare(`SELECT st.*, c.name AS cn, sc.name AS sn FROM students st
    LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN sections sc ON sc.id=st.section_id WHERE st.id=?`).get(id);
  const month = todayK().slice(0, 7) + '-01';
  const overall = studentSummary(id, '2000-01-01', todayK());
  const thisMonth = studentSummary(id, month, todayK());
  const recent = db.prepare(`SELECT s.date, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id
    WHERE r.student_id=? ORDER BY s.date DESC LIMIT 7`).all(id);
  const fines = db.prepare(`SELECT SUM(amount_pkr) t FROM fine_records WHERE student_id=? AND status='pending'`).get(id).t || 0;
  const unread = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL`).get(req.session.user.id).c;
  const dow = (new Date().getDay() + 1) % 7;
  const tt = db.prepare(`SELECT t.period_no, t.start_time, sub.name FROM timetable t LEFT JOIN subjects sub ON sub.id=t.subject_id
    WHERE t.class_id=? AND t.section_id=? AND t.day_of_week=? ORDER BY t.period_no LIMIT 6`).all(st.class_id, st.section_id, dow);
  res.send(layout('Home', req.session.user, `
<h2>Assalam o Alaikum, ${st.name.split(' ')[0]}! 👋</h2>
<div class="grid">
<div class="card">Attendance (overall)<div class="big">${overall.pct == null ? '—' : overall.pct + '%'}</div></div>
<div class="card">This month<div class="big">${thisMonth.pct == null ? '—' : thisMonth.pct + '%'}</div></div>
<div class="card">Pending fines<div class="big">PKR ${fines}</div></div>
<div class="card">Notifications<div class="big">${unread} new</div></div>
</div>
<div class="card"><strong>Today's classes</strong><br>${tt.map(t => `${t.period_no}. ${t.name || '—'} (${t.start_time})`).join('<br>') || 'No timetable set.'}</div>
<div class="card"><strong>Recent attendance</strong><br>${recent.map(r => `${r.date}: <b>${r.status}</b>`).join('<br>') || 'No records yet.'}</div>`));
});

router.get('/attendance', (req, res) => {
  const from = req.query.from || '2000-01-01', to = req.query.to || todayK();
  const rows = db.prepare(`SELECT s.date, r.status FROM attendance_records r JOIN attendance_sessions s ON s.id=r.session_id
    WHERE r.student_id=? AND s.date BETWEEN ? AND ? ORDER BY s.date DESC LIMIT 200`).all(sid(req), from, to);
  const sum = studentSummary(sid(req), from, to);
  res.send(layout('Attendance', req.session.user, `<h2>My attendance</h2>
<div class="card">Present ${sum.present} · Absent ${sum.absent} · Late ${sum.late} · Leave ${sum.leave} — <b>${sum.pct == null ? '—' : sum.pct + '%'}</b></div>
<form method="get" style="display:flex;gap:.5rem;margin-bottom:.8rem"><input type="date" name="from" value="${from}"><input type="date" name="to" value="${to}"><button class="btn">Filter</button></form>
<table><tr><th>Date</th><th>Status</th></tr>${rows.map(r => `<tr><td>${r.date}</td><td>${r.status}</td></tr>`).join('')}</table>`));
});

function gradeFor(pct) {
  const g = db.prepare(`SELECT grade FROM grade_schemes WHERE ? BETWEEN min_pct AND max_pct ORDER BY min_pct DESC LIMIT 1`).get(pct);
  return g ? g.grade : '—';
}

router.get('/results', (req, res) => {
  const exams = db.prepare(`SELECT * FROM exams WHERE class_id=(SELECT class_id FROM students WHERE id=?) AND status='published' ORDER BY id DESC`).all(sid(req));
  let html = '<h2>Published results</h2>';
  for (const ex of exams) {
    const marks = db.prepare(`SELECT m.obtained, m.max_marks, s.name FROM marks m JOIN subjects s ON s.id=m.subject_id
      WHERE m.exam_id=? AND m.student_id=?`).all(ex.id, sid(req));
    const tot = marks.reduce((a, m) => a + m.obtained, 0), max = marks.reduce((a, m) => a + m.max_marks, 0);
    const pct = max ? (100 * tot / max) : 0;
    html += `<div class="card"><strong>${ex.name}</strong> — ${tot}/${max} (${pct.toFixed(1)}%) Grade: <b>${gradeFor(pct)}</b>
    <table style="margin-top:.6rem"><tr><th>Subject</th><th>Marks</th></tr>
    ${marks.map(m => `<tr><td>${m.name}</td><td>${m.obtained}/${m.max_marks}</td></tr>`).join('')}</table></div>`;
  }
  res.send(layout('Results', req.session.user, html || '<div class="card">No published results yet.</div>'));
});

router.get('/fines', (req, res) => {
  const fines = db.prepare(`SELECT f.*, t.name AS tname FROM fine_records f LEFT JOIN fine_types t ON t.id=f.fine_type_id
    WHERE f.student_id=? ORDER BY f.date DESC`).all(sid(req));
  res.send(layout('Fines', req.session.user, `<h2>My fines</h2>
${fines.map(f => `<div class="card"><strong>${f.tname || f.reason}</strong> — PKR ${f.amount_pkr} <small>(${f.date})</small><br>Status: <b>${f.status}</b>
${f.status === 'pending' ? `<form method="post" action="/student/fines/${f.id}/dispute" style="margin-top:.5rem"><input name="reason" placeholder="Dispute reason" required><button class="btn" style="margin-top:.4rem">Submit dispute</button></form>` : ''}</div>`).join('') || '<div class="card">No fines. 🎉</div>'}`));
});

router.post('/fines/:id/dispute', (req, res) => {
  const f = db.prepare('SELECT * FROM fine_records WHERE id=? AND student_id=?').get(req.params.id, sid(req));
  if (!f || f.status !== 'pending') return res.status(400).send('Cannot dispute this fine.');
  db.prepare(`INSERT INTO fine_disputes (fine_id, raised_by, reason) VALUES (?,?,?)`).run(f.id, req.session.user.id, (req.body.reason || '').trim());
  db.prepare(`UPDATE fine_records SET status='disputed' WHERE id=?`).run(f.id);
  res.redirect('/student/fines');
});

router.get('/leave', (req, res) => {
  const leaves = db.prepare(`SELECT * FROM leave_requests WHERE student_id=? ORDER BY id DESC LIMIT 10`).all(sid(req));
  res.send(layout('Leave', req.session.user, `<h2>Leave requests</h2>
<div class="card"><form method="post" action="/student/leave">
<label>From<input type="date" name="from_date" required></label><br><br>
<label>To<input type="date" name="to_date" required></label><br><br>
<label>Reason<textarea name="reason" required rows="3"></textarea></label><br><br>
<button class="btn">Submit request</button></form></div>
${leaves.map(l => `<div class="card"><small>${l.from_date} → ${l.to_date} · <b>${l.status}</b><br>${l.reason}</small></div>`).join('')}`));
});

router.post('/leave', (req, res) => {
  const { from_date, to_date, reason } = req.body;
  if (!from_date || !to_date || !reason) return res.status(400).send('All fields required.');
  db.prepare(`INSERT INTO leave_requests (student_id, from_date, to_date, reason) VALUES (?,?,?,?)`)
    .run(sid(req), from_date, to_date, reason.trim());
  res.redirect('/student/leave');
});

router.get('/notices', (req, res) => {
  const ns = db.prepare(`SELECT * FROM notices WHERE published=1 AND audience IN ('public','students','all') ORDER BY id DESC LIMIT 20`).all();
  res.send(layout('Notices', req.session.user, `<h2>Notices</h2>` +
    (ns.map(n => `<div class="card"><strong>${n.title}</strong><br><small>${n.body}</small></div>`).join('') || '<div class="card">No notices.</div>')));
});

module.exports = router;
