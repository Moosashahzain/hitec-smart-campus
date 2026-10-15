// Attendance engine: validation, submission, summaries, correction workflow.
// Timezone: Asia/Karachi for all date logic. Missing session != confirmed absence.
const { db, todayK, nowK, transaction } = require('../db');
const { audit } = require('../routes/auth');
const { queueEmail } = require('./notify');

const VALID = ['present', 'absent', 'late', 'leave'];

function teacherCanMark(userId, classId, sectionId) {
  const t = db.prepare('SELECT id FROM teachers WHERE user_id=? AND status=?').get(userId, 'active');
  if (!t) return false;
  const a = db.prepare(`SELECT id FROM teacher_class_assignments
    WHERE teacher_id=? AND class_id=? AND (section_id IS NULL OR section_id=?)`).get(t.id, classId, sectionId);
  return !!a;
}

function submitAttendance({ userId, classId, sectionId, subjectId, date, periodNo, records }) {
  if (!teacherCanMark(userId, classId, sectionId)) {
    throw Object.assign(new Error('Not assigned to this class/section.'), { code: 403 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Invalid date.');
  const holiday = db.prepare('SELECT id FROM holidays WHERE date=?').get(date);
  if (holiday) throw new Error('Cannot mark attendance on a holiday.');
  const seen = new Set();
  for (const r of records) {
    if (!VALID.includes(r.status)) throw new Error('Invalid status: ' + r.status);
    if (seen.has(r.studentId)) throw new Error('Duplicate student in roster.');
    seen.add(r.studentId);
    const st = db.prepare('SELECT id FROM students WHERE id=? AND class_id=? AND section_id=? AND status=?')
      .get(r.studentId, classId, sectionId, 'active');
    if (!st) throw new Error('Student not in this class/section.');
  }

  const tx = transaction(() => {
    let sess = db.prepare(`SELECT * FROM attendance_sessions
      WHERE class_id=? AND section_id=? AND IFNULL(subject_id,-1)=IFNULL(?,-1) AND date=? AND IFNULL(period_no,-1)=IFNULL(?,-1)`)
      .get(classId, sectionId, subjectId || null, date, periodNo == null ? null : periodNo);
    if (sess && sess.status === 'submitted') {
      throw Object.assign(new Error('Attendance already submitted. Use the correction workflow.'), { code: 409 });
    }
    if (sess && sess.status === 'finalized') {
      throw Object.assign(new Error('Session is finalized. Request a correction.'), { code: 409 });
    }
    if (!sess) {
      const info = db.prepare(`INSERT INTO attendance_sessions
        (class_id, section_id, subject_id, date, period_no, status) VALUES (?,?,?,?,?, 'draft')`)
        .run(classId, sectionId, subjectId || null, date, periodNo == null ? null : periodNo);
      sess = db.prepare('SELECT * FROM attendance_sessions WHERE id=?').get(info.lastInsertRowid);
    }
    const upsert = db.prepare(`INSERT INTO attendance_records (session_id, student_id, status, marked_by)
      VALUES (?,?,?,?) ON CONFLICT(session_id, student_id) DO UPDATE SET status=excluded.status, marked_by=excluded.marked_by, marked_at=datetime('now')`);
    for (const r of records) upsert.run(sess.id, r.studentId, r.status, userId);
    db.prepare(`UPDATE attendance_sessions SET status='submitted', submitted_by=?, submitted_at=datetime('now') WHERE id=?`)
      .run(userId, sess.id);
    return sess.id;
  });

  const sessionId = tx();
  audit(userId, 'attendance_submitted', 'attendance_session', sessionId, `${records.length} records on ${date}`);
  queueAbsenceNotifications(sessionId, userId);
  maybeGenerateFines(sessionId, userId);
  return sessionId;
}

function requestCorrection({ userId, recordId, newStatus, reason }) {
  if (!VALID.includes(newStatus)) throw new Error('Invalid status.');
  if (!reason || !reason.trim()) throw new Error('Reason is required.');
  const rec = db.prepare(`SELECT r.*, s.class_id, s.section_id FROM attendance_records r
    JOIN attendance_sessions s ON s.id=r.session_id WHERE r.id=?`).get(recordId);
  if (!rec) throw new Error('Record not found.');
  if (!teacherCanMark(userId, rec.class_id, rec.section_id)) {
    throw Object.assign(new Error('Not your class.'), { code: 403 });
  }
  if (rec.status === newStatus) throw new Error('No change requested.');
  const info = db.prepare(`INSERT INTO attendance_corrections (record_id, old_status, new_status, reason, requested_by)
    VALUES (?,?,?,?,?)`).run(recordId, rec.status, newStatus, reason.trim(), userId);
  audit(userId, 'correction_requested', 'attendance_correction', info.lastInsertRowid, `${rec.status} -> ${newStatus}`);
  return info.lastInsertRowid;
}

function decideCorrection({ adminId, correctionId, approve }) {
  const c = db.prepare('SELECT * FROM attendance_corrections WHERE id=? AND status=?').get(correctionId, 'pending');
  if (!c) throw new Error('Correction not found or already decided.');
  const tx = transaction(() => {
    if (approve) {
      db.prepare('UPDATE attendance_records SET status=?, marked_at=datetime(\'now\') WHERE id=?').run(c.new_status, c.record_id);
      const rec = db.prepare('SELECT session_id FROM attendance_records WHERE id=?').get(c.record_id);
      queueAbsenceNotifications(rec.session_id, adminId);
    }
    db.prepare(`UPDATE attendance_corrections SET status=?, decided_by=?, decided_at=datetime('now') WHERE id=?`)
      .run(approve ? 'approved' : 'rejected', adminId, correctionId);
  });
  tx();
  audit(adminId, approve ? 'correction_approved' : 'correction_rejected', 'attendance_correction', correctionId, null);
}

// --- Summaries ---
function studentSummary(studentId, from, to) {
  const rows = db.prepare(`SELECT r.status, COUNT(*) c FROM attendance_records r
    JOIN attendance_sessions s ON s.id=r.session_id
    WHERE r.student_id=? AND s.date BETWEEN ? AND ? AND s.status IN ('submitted','finalized')
    GROUP BY r.status`).all(studentId, from, to);
  const o = { present: 0, absent: 0, late: 0, leave: 0 };
  rows.forEach(r => o[r.status] = r.c);
  const total = o.present + o.absent + o.late + o.leave;
  return { ...o, total, pct: total ? Math.round(100 * (o.present + o.late) / total) : null };
}

function classSummary(classId, sectionId, date) {
  const rows = db.prepare(`SELECT r.status, COUNT(*) c FROM attendance_records r
    JOIN attendance_sessions s ON s.id=r.session_id
    WHERE s.class_id=? AND s.section_id=? AND s.date=? AND s.status IN ('submitted','finalized')
    GROUP BY r.status`).all(classId, sectionId, date);
  const o = { present: 0, absent: 0, late: 0, leave: 0 };
  rows.forEach(r => o[r.status] = r.c);
  return o;
}

// --- Notifications (Phase 6 delivers; queue rows created now) ---
function queueAbsenceNotifications(sessionId, actorId) {
  const recs = db.prepare(`SELECT r.student_id, r.status, st.name FROM attendance_records r
    JOIN students st ON st.id=r.student_id WHERE r.session_id=? AND r.status IN ('absent','late')`).all(sessionId);
  for (const r of recs) {
    const guardians = db.prepare(`SELECT p.user_id FROM student_guardians sg JOIN parents p ON p.id=sg.parent_id
      WHERE sg.student_id=? AND sg.verified=1 AND p.user_id IS NOT NULL`).all(r.student_id);
    for (const g of guardians) {
      const title = r.status === 'absent' ? 'Absent alert' : 'Late arrival alert';
      const body = `${r.name} was marked ${r.status} today. Details in the parent portal.`;
      const ex = db.prepare(`SELECT id FROM notifications WHERE user_id=? AND type=? AND ref_type='attendance_record'
        AND ref_id IN (SELECT id FROM attendance_records WHERE session_id=? AND student_id=?)`).get(g.user_id, title, sessionId, r.student_id);
      if (ex) continue; // duplicate prevention
      const nid = db.prepare(`INSERT INTO notifications (user_id, type, title, body, ref_type, ref_id)
        VALUES (?,?,?,?,?,?)`).run(g.user_id, title, title, body, 'attendance_record', r.student_id).lastInsertRowid;
      db.prepare(`INSERT INTO notification_delivery_logs (notification_id, channel, status) VALUES (?, 'inapp', 'queued')`).run(nid);
      try { queueEmail(nid); } catch (e) { /* queue failure must not break attendance */ }
    }
  }
}

// --- Fine engine hook (OFF unless management enables it) ---
function maybeGenerateFines(sessionId, actorId) {
  const enabled = db.prepare(`SELECT value FROM system_settings WHERE key='fine_engine_enabled'`).get();
  if (!enabled || enabled.value !== '1') return;
  const types = db.prepare(`SELECT * FROM fine_types WHERE active=1`).all();
  const byTrigger = Object.fromEntries(types.map(t => [t.trigger, t]));
  const recs = db.prepare(`SELECT r.id, r.student_id, r.status FROM attendance_records r WHERE r.session_id=?`).all(sessionId);
  const sess = db.prepare(`SELECT date FROM attendance_sessions WHERE id=?`).get(sessionId);
  for (const r of recs) {
    const ft = byTrigger[r.status];
    if (!ft) continue;
    const onLeave = db.prepare(`SELECT id FROM leave_requests WHERE student_id=? AND status='approved' AND ? BETWEEN from_date AND to_date`)
      .get(r.student_id, sess.date);
    if (onLeave) continue; // approved leave: no penalty
    try {
      db.prepare(`INSERT INTO fine_records (student_id, fine_type_id, amount_pkr, reason, date, attendance_record_id, status)
        VALUES (?,?,?,?,?,?, 'pending')`).run(r.student_id, ft.id, ft.amount_pkr, `${ft.name} on ${sess.date}`, sess.date, r.id);
      audit(actorId, 'fine_generated', 'fine_record', db.prepare('SELECT last_insert_rowid() id').get().id, `${ft.name} PKR ${ft.amount_pkr}`);
    } catch (e) { /* duplicate fine prevented by UNIQUE constraint */ }
  }
}

module.exports = { teacherCanMark, submitAttendance, requestCorrection, decideCorrection, studentSummary, classSummary, VALID };
