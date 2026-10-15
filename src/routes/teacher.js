// Teacher portal — mobile-first attendance marking.
const express = require('express');
const { db, todayK } = require('../db');
const { requireRole } = require('../middleware/auth');
const { submitAttendance, requestCorrection, classSummary } = require('../lib/attendance');

const router = express.Router();
router.use(requireRole('teacher'));

function layout(title, user, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Teacher</title><style>
body{font-family:system-ui;margin:0;background:#E9F3FA;color:#0A5C99}
.bar{background:#0A5C99;color:#fff;padding:.9rem 1.1rem;display:flex;justify-content:space-between;align-items:center}
.wrap{max-width:720px;margin:0 auto;padding:1rem}
.card{background:#fff;border-radius:12px;padding:1rem;margin-bottom:.8rem;box-shadow:0 4px 14px rgba(10,92,153,.07)}
.btn{display:block;width:100%;background:#0A5C99;color:#fff;border:0;padding:.9rem;border-radius:10px;font-size:1rem;cursor:pointer;text-align:center;text-decoration:none;box-sizing:border-box}
.btn.gold{background:#FFD21F;color:#0A5C99}
.stu{display:flex;align-items:center;gap:.7rem;padding:.7rem .2rem;border-bottom:1px solid #e6ecf3}
.stu .nm{flex:1}.stu .nm small{display:block;color:#8a97a8}
.seg{display:flex;gap:.3rem}.seg button{border:1px solid #c9d4e2;background:#fff;border-radius:8px;padding:.55rem .6rem;font-size:.8rem;cursor:pointer;min-width:44px;min-height:44px}
.seg button.on-p{background:#1a7f37;color:#fff;border-color:#1a7f37}
.seg button.on-a{background:#b3261e;color:#fff;border-color:#b3261e}
.seg button.on-l{background:#b26a00;color:#fff;border-color:#b26a00}
.seg button.on-v{background:#5a6b82;color:#fff;border-color:#5a6b82}
.toolbar{display:flex;gap:.5rem;margin-bottom:.8rem;flex-wrap:wrap}
.toolbar a{flex:1;text-align:center;background:#fff;border:1px solid #c9d4e2;border-radius:10px;padding:.7rem;text-decoration:none;color:#0A5C99;font-size:.85rem}
select,input{padding:.6rem;border:1px solid #c9d4e2;border-radius:8px;font-size:.95rem}
.msg{background:#e7f6ec;border:1px solid #bfe6c9;padding:.7rem;border-radius:8px;margin-bottom:.8rem}
.err{background:#fde8e8;border:1px solid #f3c2c2;padding:.7rem;border-radius:8px;margin-bottom:.8rem}
</style></head><body>
<div class="bar"><strong>Teacher Portal</strong><form method="post" action="/logout"><button style="background:#FFD21F;color:#0A5C99;border:0;padding:.45rem .9rem;border-radius:8px;cursor:pointer">${user.login}</button></form></div>
<div class="wrap">${body}</div>
<script>
function setStatus(btn, val){ const seg = btn.parentElement; seg.querySelectorAll('button').forEach(b=>b.className=''); btn.className='on-'+val[0]; seg.nextElementSibling.value = val; }
</script></body></html>`;
}

function teacherId(req) { return req.session.user.teacher_id; }

router.get('/', (req, res) => {
  const tid = teacherId(req);
  const assigns = db.prepare(`SELECT a.*, c.name AS class_name, s.name AS section_name, sub.name AS subject_name
    FROM teacher_class_assignments a JOIN classes c ON c.id=a.class_id
    LEFT JOIN sections s ON s.id=a.section_id LEFT JOIN subjects sub ON sub.id=a.subject_id
    WHERE a.teacher_id=?`).all(tid);
  const today = todayK();
  const submitted = db.prepare(`SELECT s.id, s.date, c.name AS cn, sc.name AS sn, s.status, s.submitted_at
    FROM attendance_sessions s JOIN classes c ON c.id=s.class_id JOIN sections sc ON sc.id=s.section_id
    WHERE s.submitted_by=? ORDER BY s.date DESC, s.id DESC LIMIT 10`).all(req.session.user.id);
  const sum = assigns.length ? classSummary(assigns[0].class_id, assigns[0].section_id, today) : null;
  res.send(layout('Dashboard', req.session.user, `
<div class="toolbar"><a href="/teacher/mark">✋ Mark attendance</a><a href="/teacher/corrections">Corrections</a></div>
${assigns.length === 0 ? '<div class="err">No classes assigned yet. Contact management.</div>' : ''}
<h3>My classes</h3>
${assigns.map(a => `<div class="card"><strong>${a.class_name}-${a.section_name || ''}</strong><br><small>${a.subject_name || 'Class teacher'}</small></div>`).join('')}
${sum ? `<h3>Today (${today}) — ${assigns[0].class_name}</h3><div class="card">Present ${sum.present} · Absent ${sum.absent} · Late ${sum.late} · Leave ${sum.leave}</div>` : ''}
<h3>Recent submissions</h3>
${submitted.map(s => `<div class="card"><small>${s.date} — ${s.cn}-${s.sn} · ${s.status}</small></div>`).join('') || '<div class="card"><small>No submissions yet.</small></div>'}`));
});

router.get('/mark', (req, res) => {
  const tid = teacherId(req);
  const assigns = db.prepare(`SELECT a.*, c.name AS class_name, s.name AS section_name
    FROM teacher_class_assignments a JOIN classes c ON c.id=a.class_id LEFT JOIN sections s ON s.id=a.section_id
    WHERE a.teacher_id=?`).all(tid);
  const { class_id, section_id, date } = req.query;
  let roster = '', existing = null;
  if (class_id && section_id) {
    const d = date || todayK();
    existing = db.prepare(`SELECT * FROM attendance_sessions WHERE class_id=? AND section_id=? AND date=? AND period_no IS NULL`)
      .get(class_id, section_id, d);
    const students = db.prepare(`SELECT id, student_id, roll_number, name FROM students
      WHERE class_id=? AND section_id=? AND status='active' ORDER BY roll_number, name`).all(class_id, section_id);
    const marks = existing ? Object.fromEntries(db.prepare(`SELECT student_id, status FROM attendance_records WHERE session_id=?`).all(existing.id).map(r => [r.student_id, r.status])) : {};
    roster = `<h3>Roster (${students.length}) — ${d}</h3>
    ${existing && existing.status === 'submitted' ? '<div class="err">Already submitted for this date. Use Corrections to request a change.</div>' : ''}
    <form method="post" action="/teacher/mark">
    <input type="hidden" name="class_id" value="${class_id}"><input type="hidden" name="section_id" value="${section_id}">
    <input type="hidden" name="date" value="${d}">
    <div class="toolbar"><button type="button" class="btn gold" onclick="document.querySelectorAll('.stsel').forEach(s=>{s.value='present';s.previousElementSibling.querySelectorAll('button').forEach(b=>b.className='');s.previousElementSibling.querySelector('button').className='on-p'})">Mark all present</button></div>
    ${students.map(s => { const m = marks[s.id] || 'present'; return `
    <div class="stu"><div class="nm">${s.name}<small>${s.roll_number || ''} · ${s.student_id}</small></div>
    <div class="seg">
      <button type="button" class="${m === 'present' ? 'on-p' : ''}" onclick="setStatus(this,'present')">P</button>
      <button type="button" class="${m === 'absent' ? 'on-a' : ''}" onclick="setStatus(this,'absent')">A</button>
      <button type="button" class="${m === 'late' ? 'on-l' : ''}" onclick="setStatus(this,'late')">L</button>
      <button type="button" class="${m === 'leave' ? 'on-v' : ''}" onclick="setStatus(this,'leave')">Lv</button>
    </div><input type="hidden" class="stsel" name="st_${s.id}" value="${m}"></div>`; }).join('')}
    <br><button class="btn">Review &amp; submit</button></form>`;
  }
  res.send(layout('Mark attendance', req.session.user, `
<h3>Select class &amp; date</h3>
<form method="get" action="/teacher/mark" class="card">
<select name="class_id" required><option value="">Class…</option>
${[...new Map(assigns.map(a => [a.class_id + '-' + a.section_id, a])).values()].map(a => `<option value="${a.class_id}" data-sec="${a.section_id}" ${String(a.class_id) === String(class_id) ? 'selected' : ''}>${a.class_name}-${a.section_name}</option>`).join('')}</select>
<input type="hidden" name="section_id" id="sec"><input type="date" name="date" value="${date || todayK()}">
<button class="btn" style="margin-top:.6rem">Load roster</button></form>
<script>var cs=document.querySelector('select[name=class_id]');function syncSec(){var o=cs.selectedOptions[0];if(o&&o.dataset.sec)document.getElementById('sec').value=o.dataset.sec}cs.addEventListener('change',syncSec);syncSec();</script>
${roster}`));
});

router.post('/mark', (req, res) => {
  try {
    const { class_id, section_id, date } = req.body;
    const records = Object.keys(req.body).filter(k => k.startsWith('st_'))
      .map(k => ({ studentId: +k.slice(3), status: req.body[k] }));
    if (!records.length) throw new Error('Empty roster.');
    const sid = submitAttendance({ userId: req.session.user.id, classId: +class_id, sectionId: +section_id, subjectId: null, date, periodNo: null, records });
    res.send(layout('Submitted', req.session.user, `<div class="msg">✅ Attendance submitted — ${records.length} students, session #${sid}.</div><a class="btn" href="/teacher">Back to dashboard</a>`));
  } catch (e) {
    res.status(e.code || 400).send(layout('Error', req.session.user, `<div class="err">${e.message}</div><a class="btn" href="/teacher/mark">Back</a>`));
  }
});

router.get('/corrections', (req, res) => {
  const mine = db.prepare(`SELECT c.*, r.status AS cur FROM attendance_corrections c
    JOIN attendance_records r ON r.id=c.record_id WHERE c.requested_by=? ORDER BY c.id DESC LIMIT 20`).all(req.session.user.id);
  res.send(layout('Corrections', req.session.user, `<h3>My correction requests</h3>
${mine.map(c => `<div class="card"><small>#${c.id}: ${c.old_status} → <b>${c.new_status}</b> · ${c.status}<br>Reason: ${c.reason}</small></div>`).join('') || '<div class="card"><small>None yet.</small></div>'}
<h3>Request a correction</h3><div class="card"><form method="post" action="/teacher/corrections">
<label>Attendance record ID<br><input name="record_id" required inputmode="numeric"></label><br><br>
<label>Correct status<br><select name="new_status"><option>present</option><option>absent</option><option>late</option><option>leave</option></select></label><br><br>
<label>Reason<br><input name="reason" required style="width:100%"></label><br><br>
<button class="btn">Submit request</button></form>
<p style="font-size:.78rem;color:#8a97a8">Record IDs are shown on the management attendance reports. Finalized attendance can only change through this approval workflow.</p></div>`));
});

router.post('/corrections', (req, res) => {
  try {
    const id = requestCorrection({ userId: req.session.user.id, recordId: +req.body.record_id, newStatus: req.body.new_status, reason: req.body.reason });
    res.send(layout('Requested', req.session.user, `<div class="msg">Correction request #${id} sent for management approval.</div><a class="btn" href="/teacher/corrections">Back</a>`));
  } catch (e) { res.status(e.code || 400).send(layout('Error', req.session.user, `<div class="err">${e.message}</div><a class="btn" href="/teacher/corrections">Back</a>`)); }
});

module.exports = router;
