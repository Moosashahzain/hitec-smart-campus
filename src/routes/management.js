// Management portal: students + teachers CRUD, CSV import/export, account provisioning.
const express = require('express');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { db, nowK } = require('../db');
const { requireManagement } = require('../middleware/auth');
const { provisionStudentAccount, provisionTeacherAccount, resendInvitation } = require('../lib/provision');
const { audit } = require('./auth');

const router = express.Router();
router.use(requireManagement);

const PAGE = 25;
function layout(title, user, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — HITEC Smart Campus</title><style>
body{font-family:system-ui;margin:0;background:#E9F3FA;color:#0A5C99}
.bar{background:#0A5C99;color:#fff;padding:.9rem 1.2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem}
.bar a{color:#FFD21F;text-decoration:none;margin-right:1rem;font-size:.9rem}
.wrap{max-width:1100px;margin:0 auto;padding:1.2rem}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;font-size:.88rem}
th,td{padding:.6rem .7rem;text-align:left;border-bottom:1px solid #e6ecf3}
th{background:#0A5C99;color:#fff}.row:hover{background:#f4f7fb}
.btn{display:inline-block;background:#0A5C99;color:#fff;border:0;padding:.5rem 1rem;border-radius:8px;cursor:pointer;text-decoration:none;font-size:.85rem}
.btn.gold{background:#FFD21F;color:#0A5C99}.btn.danger{background:#b3261e}.btn.small{padding:.3rem .7rem;font-size:.78rem}
form.inline{display:inline}.toolbar{display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center}
input,select{padding:.5rem;border:1px solid #c9d4e2;border-radius:8px;font-size:.9rem}
.msg{background:#e7f6ec;border:1px solid #bfe6c9;padding:.7rem;border-radius:8px;margin-bottom:1rem;font-size:.88rem}
@media(max-width:640px){table{font-size:.78rem}th,td{padding:.45rem}}
</style></head><body>
<div class="bar"><div><a href="/management">Dashboard</a><a href="/management/students">Students</a><a href="/management/teachers">Teachers</a><a href="/management/fines">Fines</a><a href="/management/leaves">Leaves</a><a href="/management/corrections">Corrections</a></div>
<div><span style="font-size:.85rem">${user.login} (${user.role})</span> <form class="inline" method="post" action="/logout"><button class="btn small">Logout</button></form></div></div>
<div class="wrap">${body}</div></body></html>`;
}

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const s = {
    students: db.prepare(`SELECT COUNT(*) c FROM students WHERE status='active'`).get().c,
    teachers: db.prepare(`SELECT COUNT(*) c FROM teachers WHERE status='active'`).get().c,
    classes: db.prepare(`SELECT COUNT(*) c FROM classes`).get().c,
    pendingLeaves: db.prepare(`SELECT COUNT(*) c FROM leave_requests WHERE status='pending'`).get().c,
    pendingFines: db.prepare(`SELECT COUNT(*) c FROM fine_records WHERE status='pending'`).get().c,
    unpublishedExams: db.prepare(`SELECT COUNT(*) c FROM exams WHERE status='draft'`).get().c,
  };
  const today = new Date().toISOString().slice(0, 10);
  const att = db.prepare(`SELECT r.status, COUNT(*) c FROM attendance_records r
    JOIN attendance_sessions s ON s.id=r.session_id WHERE s.date=? GROUP BY r.status`).all(today);
  const counts = { present: 0, absent: 0, late: 0, leave: 0 };
  att.forEach(r => counts[r.status] = r.c);
  const total = counts.present + counts.absent + counts.late + counts.leave;
  const pct = total ? Math.round(100 * (counts.present + counts.late) / total) : 0;
  const recent = db.prepare(`SELECT action, entity_type, created_at FROM audit_logs ORDER BY id DESC LIMIT 8`).all();
  res.send(layout('Management', req.session.user, `
<h2>Dashboard</h2>
<div class="toolbar">
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Active students<br><b style="font-size:1.6rem">${s.students}</b></div>
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Teachers<br><b style="font-size:1.6rem">${s.teachers}</b></div>
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Classes<br><b style="font-size:1.6rem">${s.classes}</b></div>
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Today: P ${counts.present} / A ${counts.absent} / L ${counts.late}<br><b>Attendance ${pct}%</b></div>
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Pending leaves<br><b style="font-size:1.6rem">${s.pendingLeaves}</b></div>
<div class="card" style="background:#fff;padding:1rem;border-radius:10px">Pending fines<br><b style="font-size:1.6rem">${s.pendingFines}</b></div>
</div>
<h3>Recent activity</h3>
<table><tr><th>Time</th><th>Action</th><th>Entity</th></tr>
${recent.map(r => `<tr class="row"><td>${r.created_at}</td><td>${r.action}</td><td>${r.entity_type || ''}</td></tr>`).join('')}
</table>
<p style="font-size:.78rem;color:#8a97a8">Figures are live database queries. Fine engine is OFF until management approves (system_settings.fine_engine_enabled=0).</p>`));
});

// ---------- Students ----------
router.get('/students', (req, res) => {
  const { q: search = '', status = '', page = 1 } = req.query;
  const where = ['1=1'], params = [];
  if (search) { where.push('(st.student_id LIKE ? OR st.name LIKE ? OR st.roll_number LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { where.push('st.status = ?'); params.push(status); }
  const total = db.prepare(`SELECT COUNT(*) c FROM students st WHERE ${where.join(' AND ')}`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(1, +page || 1), pages);
  const rows = db.prepare(`SELECT st.*, c.name AS class_name, sc.name AS section_name, u.status AS account_status
    FROM students st LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN sections sc ON sc.id=st.section_id
    LEFT JOIN users u ON u.id=st.user_id WHERE ${where.join(' AND ')}
    ORDER BY st.name LIMIT ? OFFSET ?`).all(...params, PAGE, (p - 1) * PAGE);
  res.send(layout('Students', req.session.user, `
<h2>Students (${total})</h2>
<div class="toolbar">
<form method="get" class="toolbar"><input name="q" placeholder="Search ID / name / roll" value="${search}">
<select name="status"><option value="">All statuses</option>${['active', 'suspended', 'archived'].map(s => `<option ${status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
<button class="btn">Search</button></form>
<a class="btn gold" href="/management/students/new">+ Add student</a>
<a class="btn" href="/management/students/export.csv">Export CSV</a>
<a class="btn" href="/management/students/import">Import CSV</a></div>
<table><tr><th>Student ID</th><th>Name</th><th>Class</th><th>Roll</th><th>Status</th><th>Account</th><th></th></tr>
${rows.map(r => `<tr class="row"><td>${r.student_id}</td><td>${r.name}</td><td>${r.class_name || ''}-${r.section_name || ''}</td>
<td>${r.roll_number || ''}</td><td>${r.status}</td><td>${r.account_status || 'none'}</td>
<td><a class="btn small" href="/management/students/${r.id}">View</a></td></tr>`).join('')}</table>
<p>Page ${p} of ${pages}</p>`));
});

router.get('/students/new', (req, res) => {
  const classes = db.prepare('SELECT c.id, c.name, s.id AS sid, s.name AS sname FROM classes c LEFT JOIN sections s ON s.class_id=c.id ORDER BY c.name, s.name').all();
  res.send(layout('Add student', req.session.user, `
<h2>Add student</h2>
<form method="post" action="/management/students">
<label>Full name<br><input name="name" required style="width:min(400px,100%)"></label><br><br>
<label>Class / Section<br><select name="section_id" required>${classes.filter(c => c.sid).map(c => `<option value="${c.sid}">${c.name} - ${c.sname}</option>`).join('')}</select></label><br><br>
<label>Roll number<br><input name="roll_number"></label><br><br>
<label>Date of birth<br><input type="date" name="dob"></label><br><br>
<label>Gender<br><select name="gender"><option value="">—</option><option>male</option><option>female</option><option>other</option></select></label><br><br>
<label>Phone<br><input name="phone"></label><br><br>
<label>Address<br><input name="address" style="width:min(400px,100%)"></label><br><br>
<button class="btn">Create student + provision account</button></form>
<p style="font-size:.8rem;color:#8a97a8">A unique Student ID is assigned automatically; a login account and setup invitation are created at once.</p>`));
});

function nextStudentId() {
  const year = new Date().getFullYear();
  const row = db.prepare(`SELECT student_id FROM students WHERE student_id LIKE ? ORDER BY student_id DESC LIMIT 1`).get(`STU-${year}-%`);
  const n = row ? parseInt(row.student_id.split('-')[2], 10) + 1 : 1;
  return `STU-${year}-${String(n).padStart(3, '0')}`;
}

router.post('/students', (req, res) => {
  const { name, section_id, roll_number, dob, gender, phone, address } = req.body;
  if (!name || !section_id) return res.status(400).send('Name and section required.');
  const sec = db.prepare('SELECT * FROM sections WHERE id=?').get(section_id);
  if (!sec) return res.status(400).send('Invalid section.');
  const sess = db.prepare('SELECT id FROM academic_sessions WHERE is_current=1').get();
  const sid = nextStudentId();
  try {
    const info = db.prepare(`INSERT INTO students (student_id, roll_number, name, class_id, section_id, session_id, admission_date, dob, gender, phone, address)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sid, roll_number || null, name.trim(), sec.class_id, sec.id, sess && sess.id, nowK().slice(0, 10), dob || null, gender || null, phone || null, address || null);
    const prov = provisionStudentAccount(info.lastInsertRowid, req.session.user.id);
    audit(req.session.user.id, 'student_created', 'student', info.lastInsertRowid, sid);
    res.send(layout('Student created', req.session.user, `<div class="msg">Student <b>${sid}</b> created.
      Login account: <b>${prov.login}</b> (${prov.created ? 'new invitation issued' : 'existing account linked'}).
      ${prov.invite ? `<br>Setup link (deliver securely): <code>${prov.invite}</code>` : ''}</div>
      <a class="btn" href="/management/students">Back to students</a>`));
  } catch (e) {
    res.status(400).send('Could not create student: ' + e.message);
  }
});

router.get('/students/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT st.student_id, st.roll_number, st.name, c.name AS class, sc.name AS section, st.admission_date, st.dob, st.gender, st.phone, st.address, st.status
    FROM students st LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN sections sc ON sc.id=st.section_id ORDER BY st.name`).all();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
  res.send(stringify(rows, { header: true })); // never includes passwords
});

// CSV import: POST text/csv body. Columns: student_id(optional), roll_number, name*, class, section, admission_date, dob, gender, phone, address
router.post('/students/import', express.text({ type: 'text/csv', limit: '2mb' }), (req, res) => {
  let records;
  try { records = parse(req.body || '', { columns: true, skip_empty_lines: true, trim: true }); }
  catch (e) { return res.status(400).json({ error: 'Invalid CSV: ' + e.message }); }
  const summary = { total: records.length, created: 0, skipped_duplicate: 0, errors: [] };
  const sess = db.prepare('SELECT id FROM academic_sessions WHERE is_current=1').get();
  records.forEach((r, i) => {
    const line = i + 2;
    try {
      if (!r.name) throw new Error('name is required');
      const sid = (r.student_id || '').trim();
      if (sid && db.prepare('SELECT id FROM students WHERE student_id=?').get(sid)) { summary.skipped_duplicate++; return; }
      const sec = db.prepare(`SELECT s.* FROM sections s JOIN classes c ON c.id=s.class_id
        WHERE c.name=? AND s.name=?`).get((r.class || '').trim(), (r.section || '').trim());
      if (!sec) throw new Error(`class/section not found: ${r.class}-${r.section}`);
      const newSid = sid || nextStudentId();
      if (db.prepare('SELECT id FROM students WHERE student_id=?').get(newSid)) { summary.skipped_duplicate++; return; }
      const info = db.prepare(`INSERT INTO students (student_id, roll_number, name, class_id, section_id, session_id, admission_date, dob, gender, phone, address)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(newSid, r.roll_number || null, r.name.trim(), sec.class_id, sec.id, sess && sess.id,
        r.admission_date || nowK().slice(0, 10), r.dob || null, r.gender || null, r.phone || null, r.address || null);
      provisionStudentAccount(info.lastInsertRowid, req.session.user.id);
      summary.created++;
    } catch (e) { summary.errors.push({ line, error: e.message, row: r }); }
  });
  audit(req.session.user.id, 'students_imported', 'student', null, JSON.stringify({ created: summary.created, duplicates: summary.skipped_duplicate, errors: summary.errors.length }));
  res.json(summary); // client offers error report download
});

router.get('/students/import', (req, res) => {
  res.send(layout('Import students', req.session.user, `
<h2>Import students (CSV)</h2>
<p style="font-size:.88rem">Columns: <code>student_id</code> (optional — assigned if blank), <code>roll_number</code>, <code>name</code>*,
<code>class</code>*, <code>section</code>*, <code>admission_date</code>, <code>dob</code>, <code>gender</code>, <code>phone</code>, <code>address</code>.
Duplicates by Student ID are skipped. Accounts + invitations are provisioned automatically. Passwords are never in CSV.</p>
<form id="f"><label>CSV file<br><input type="file" id="file" accept=".csv" required></label><br><br><button class="btn">Upload &amp; import</button></form>
<pre id="out" style="background:#fff;padding:1rem;border-radius:8px;white-space:pre-wrap"></pre>
<script>
document.getElementById('f').onsubmit = async e => {
  e.preventDefault();
  const text = await document.getElementById('file').files[0].text();
  const r = await fetch('/management/students/import', { method:'POST', headers:{'Content-Type':'text/csv'}, body:text });
  const j = await r.json();
  let s = 'Total: '+j.total+'  Created: '+j.created+'  Duplicates skipped: '+j.skipped_duplicate+'  Errors: '+j.errors.length;
  if (j.errors.length) s += '\\n\\nErrors (downloadable report below):\\n' + j.errors.map(x=>'line '+x.line+': '+x.error).join('\\n');
  document.getElementById('out').textContent = s;
  if (j.errors.length) {
    const blob = new Blob([JSON.stringify(j.errors, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'import-errors.json'; a.textContent = 'Download error report'; a.className='btn';
    document.getElementById('out').appendChild(document.createElement('br')); document.getElementById('out').appendChild(a);
  }
};
</script>`));
});

router.get('/students/:id', (req, res) => {
  const st = db.prepare(`SELECT st.*, c.name AS class_name, sc.name AS section_name, u.login, u.status AS account_status, u.last_login_at
    FROM students st LEFT JOIN classes c ON c.id=st.class_id LEFT JOIN sections sc ON sc.id=st.section_id
    LEFT JOIN users u ON u.id=st.user_id WHERE st.id=?`).get(req.params.id);
  if (!st) return res.status(404).send('Not found');
  const guardians = db.prepare(`SELECT p.name, sg.relationship, sg.verified FROM student_guardians sg JOIN parents p ON p.id=sg.parent_id WHERE sg.student_id=?`).all(st.id);
  res.send(layout('Student', req.session.user, `
<h2>${st.name} <span style="font-size:.9rem;color:#8a97a8">${st.student_id}</span></h2>
<table>
<tr><th>Roll</th><td>${st.roll_number || '—'}</td></tr>
<tr><th>Class</th><td>${st.class_name || ''}-${st.section_name || ''}</td></tr>
<tr><th>Status</th><td>${st.status}</td></tr>
<tr><th>Login</th><td>${st.login || '—'} (${st.account_status || 'no account'})</td></tr>
<tr><th>Last login</th><td>${st.last_login_at || '—'}</td></tr>
<tr><th>Guardians</th><td>${guardians.map(g => `${g.name} (${g.relationship}${g.verified ? ', verified' : ''})`).join('<br>') || '—'}</td></tr>
</table><br>
<div class="toolbar">
<form class="inline" method="post" action="/management/students/${st.id}/status"><select name="status">
${['active', 'suspended', 'archived'].map(s => `<option ${st.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
<button class="btn small">Set status</button></form>
${st.login ? `<form class="inline" method="post" action="/management/students/${st.id}/resend-invite"><button class="btn small gold">Resend setup invitation</button></form>` : ''}
</div>
<a class="btn" href="/management/students">Back</a>`));
});

router.post('/students/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended', 'archived'].includes(status)) return res.status(400).send('Bad status');
  db.prepare('UPDATE students SET status=? WHERE id=?').run(status, req.params.id);
  const st = db.prepare('SELECT user_id FROM students WHERE id=?').get(req.params.id);
  if (st && st.user_id) db.prepare('UPDATE users SET status=? WHERE id=?').run(status === 'active' ? 'active' : status, st.user_id);
  audit(req.session.user.id, 'student_status_' + status, 'student', req.params.id, null);
  res.redirect('/management/students/' + req.params.id);
});

router.post('/students/:id/resend-invite', (req, res) => {
  const st = db.prepare('SELECT user_id FROM students WHERE id=?').get(req.params.id);
  if (!st || !st.user_id) return res.status(400).send('No account to invite.');
  const link = resendInvitation(st.user_id, req.session.user.id);
  res.send(layout('Invitation resent', req.session.user, `<div class="msg">New setup link (deliver securely): <code>${link}</code><br>Previous unused links were invalidated.</div><a class="btn" href="/management/students/${req.params.id}">Back</a>`));
});

// ---------- Teachers ----------
router.get('/teachers', (req, res) => {
  const rows = db.prepare(`SELECT t.*, u.status AS account_status FROM teachers t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.name`).all();
  res.send(layout('Teachers', req.session.user, `
<h2>Teachers (${rows.length})</h2>
<div class="toolbar"><a class="btn gold" href="/management/teachers/new">+ Add teacher</a></div>
<table><tr><th>Staff ID</th><th>Name</th><th>Status</th><th>Account</th><th></th></tr>
${rows.map(r => `<tr class="row"><td>${r.staff_id}</td><td>${r.name}</td><td>${r.status}</td><td>${r.account_status || 'none'}</td>
<td><form class="inline" method="post" action="/management/teachers/${r.id}/status"><select name="status">
${['active', 'suspended', 'archived'].map(s => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
<button class="btn small">Set</button></form></td></tr>`).join('')}</table>`));
});

router.get('/teachers/new', (req, res) => {
  res.send(layout('Add teacher', req.session.user, `<h2>Add teacher</h2>
<form method="post" action="/management/teachers">
<label>Full name<br><input name="name" required style="width:min(400px,100%)"></label><br><br>
<label>Phone<br><input name="phone"></label><br><br><label>Email<br><input name="email" type="email"></label><br><br>
<button class="btn">Create teacher + provision account</button></form>`));
});

router.post('/teachers', (req, res) => {
  const { name, phone, email } = req.body;
  if (!name) return res.status(400).send('Name required.');
  const row = db.prepare(`SELECT staff_id FROM teachers WHERE staff_id LIKE 'T-%' ORDER BY staff_id DESC LIMIT 1`).get();
  const n = row ? parseInt(row.staff_id.slice(2), 10) + 1 : 1001;
  const staffId = 'T-' + n;
  try {
    const info = db.prepare(`INSERT INTO teachers (staff_id, name, phone, email) VALUES (?,?,?,?)`)
      .run(staffId, name.trim(), phone || null, email || null);
    const prov = provisionTeacherAccount(info.lastInsertRowid, req.session.user.id);
    audit(req.session.user.id, 'teacher_created', 'teacher', info.lastInsertRowid, staffId);
    res.send(layout('Teacher created', req.session.user, `<div class="msg">Teacher <b>${staffId}</b> created. Login: <b>${prov.login}</b>.
      ${prov.invite ? `<br>Setup link (deliver securely): <code>${prov.invite}</code>` : ''}</div><a class="btn" href="/management/teachers">Back</a>`));
  } catch (e) { res.status(400).send('Could not create teacher: ' + e.message); }
});

router.post('/teachers/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended', 'archived'].includes(status)) return res.status(400).send('Bad status');
  db.prepare('UPDATE teachers SET status=? WHERE id=?').run(status, req.params.id);
  const t = db.prepare('SELECT user_id FROM teachers WHERE id=?').get(req.params.id);
  if (t && t.user_id) db.prepare('UPDATE users SET status=? WHERE id=?').run(status === 'active' ? 'active' : status, t.user_id);
  audit(req.session.user.id, 'teacher_status_' + status, 'teacher', req.params.id, null);
  res.redirect('/management/teachers');
});

module.exports = router;
