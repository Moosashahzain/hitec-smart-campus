// Seeds fictional DEMO data. All persons are invented. Usage: node scripts/seed.js
// Never run against real institutional data without authorization.
const path = require('path');
const { db } = require('../src/db');
const bcrypt = require('bcryptjs');

const DEMO = ' [DEMO]';

const hash = (pw) => bcrypt.hashSync(pw, 10);
const q = (sql, p = []) => db.prepare(sql).run(...p);
const one = (sql, p = []) => db.prepare(sql).get(...p);

function mkUser(login, role, pw) {
  const ex = one('SELECT id FROM users WHERE login = ?', [login]);
  if (ex) return ex.id;
  return q('INSERT INTO users (login, password_hash, role, status) VALUES (?,?,?,?)',
    [login, hash(pw), role, 'active']).lastInsertRowid;
}

db.exec('BEGIN');
try {
  q(`INSERT OR IGNORE INTO academic_sessions (name, start_date, end_date, is_current)
     VALUES ('2026-27','2026-04-01','2027-03-31',1)`);
  const sess = one(`SELECT id FROM academic_sessions WHERE is_current = 1`);

  const adminId = mkUser('admin', 'super_admin', 'Admin@123');
  const principalId = mkUser('principal', 'principal', 'Principal@123');

  // Class + section + subjects
  q(`INSERT OR IGNORE INTO classes (name, level, session_id) VALUES ('ICS-I','college',?)`, [sess.id]);
  const cls = one(`SELECT id FROM classes WHERE name='ICS-I'`);
  q(`INSERT OR IGNORE INTO sections (class_id, name) VALUES (?, 'A')`, [cls.id]);
  const sec = one(`SELECT id FROM sections WHERE class_id=? AND name='A'`, [cls.id]);
  for (const [n, c] of [['Computer Science','CS-101'],['Physics','PHY-101'],['Mathematics','MATH-101']]) {
    q(`INSERT OR IGNORE INTO subjects (name, code, class_id) VALUES (?,?,?)`, [n + DEMO, c, cls.id]);
  }

  // Teacher (fictional)
  const tUser = mkUser('T-1001', 'teacher', 'Teacher@123');
  q(`INSERT OR IGNORE INTO teachers (staff_id, name, user_id, status) VALUES (?,?,?,?)`,
    ['T-1001', 'Sir Imran Khalid' + DEMO, tUser, 'active']);
  const teacher = one(`SELECT id FROM teachers WHERE staff_id='T-1001'`);
  const subj = one(`SELECT id FROM subjects WHERE code='CS-101'`);
  q(`INSERT OR IGNORE INTO teacher_class_assignments (teacher_id, class_id, section_id, subject_id, session_id)
     VALUES (?,?,?,?,?)`, [teacher.id, cls.id, sec.id, subj.id, sess.id]);

  // Students (fictional)
  const demoStudents = [
    ['STU-2026-001', '101', 'Ali Hamza'],
    ['STU-2026-002', '102', 'Bilal Ahmed'],
    ['STU-2026-003', '103', 'Usman Tariq'],
  ];
  const studentIds = [];
  for (const [sid, roll, name] of demoStudents) {
    const u = mkUser(sid, 'student', 'Student@123');
    q(`INSERT OR IGNORE INTO students (student_id, roll_number, name, class_id, section_id, session_id, status, user_id)
       VALUES (?,?,?,?,?,?,?,?)`, [sid, roll, name + DEMO, cls.id, sec.id, sess.id, 'active', u]);
    studentIds.push(one(`SELECT id FROM students WHERE student_id=?`, [sid]).id);
  }

  // Parent linked to first student (fictional)
  const pUser = mkUser('P-1001', 'parent', 'Parent@123');
  q('UPDATE users SET email=? WHERE id=?', ['parent.demo@example.com', pUser]);
  q(`INSERT OR IGNORE INTO parents (name, user_id, status) VALUES (?,?,?)`,
    ['Rashid Mehmood' + DEMO, pUser, 'active']);
  const par = one(`SELECT id FROM parents WHERE user_id=?`, [pUser]);
  q(`INSERT OR IGNORE INTO student_guardians (student_id, parent_id, relationship, verified, is_primary)
     VALUES (?,?,?,?,?)`, [studentIds[0], par.id, 'father', 1, 1]);

  // Grade scheme + a published demo exam with marks
  q(`INSERT OR IGNORE INTO exams (name, session_id, class_id, status) VALUES ('First Term 2026'||' [DEMO]',?,?, 'published')`,
    [sess.id, cls.id]);
  const exam = one(`SELECT id FROM exams WHERE class_id=? ORDER BY id DESC`, [cls.id]);
  const subjects = db.prepare('SELECT id FROM subjects WHERE class_id=?').all(cls.id);
  const marksTable = [[85,100],[78,100],[92,100]];
  studentIds.forEach((stid, i) => {
    subjects.forEach((s, j) => {
      const m = marksTable[(i + j) % 3];
      q(`INSERT OR IGNORE INTO marks (exam_id, student_id, subject_id, obtained, max_marks, entered_by)
         VALUES (?,?,?,?,?,?)`, [exam.id, stid, s.id, m[0], m[1], adminId]);
    });
  });
  for (const [n, lo, hi, g] of [['A+',90,100,'A+'],['A',80,89.99,'A'],['B',70,79.99,'B'],['C',60,69.99,'C'],['D',50,59.99,'D'],['F',0,49.99,'F']]) {
    q(`INSERT OR IGNORE INTO grade_schemes (name, min_pct, max_pct, grade) VALUES ('Default',?,?,?)`, [lo, hi, g]);
  }

  // A public notice
  q(`INSERT OR IGNORE INTO notices (title, body, audience, published, created_by)
     VALUES (?,?, 'public', 1, ?)`,
    ['Admissions Open 2026-27 [DEMO]', 'Demo notice: admissions for session 2026-27 are open. Visit the campus office.', adminId]);

  q(`INSERT OR IGNORE INTO fine_types (name, amount_pkr, trigger, active) VALUES
     ('Late arrival', 50, 'late', 0),
     ('Unexcused absence', 100, 'absent', 0)`);

  db.exec('COMMIT');
  console.log('seeded demo data (fictional persons, labeled [DEMO])');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
db.close();
