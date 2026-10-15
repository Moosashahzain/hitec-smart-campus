// Account provisioning: auto-create auth users for students/teachers/parents.
// Never assigns a shared password — accounts start 'invited' with an unusable
// hash plus a single-use setup token. Plaintext passwords are never stored.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, nowK } = require('../db');
const { audit } = require('../routes/auth');

const UNUSABLE = '!';
function tokenHash(t) { return crypto.createHash('sha256').update(t).digest('hex'); }

function createInvitation(userId, hours = 72) {
  const t = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO invitations (user_id, token_hash, expires_at) VALUES (?,?,?)')
    .run(userId, tokenHash(t), exp);
  return t; // caller delivers the link; in production this is emailed
}
function inviteLink(token) {
  const base = process.env.APP_URL || 'http://localhost:3000';
  return `${base}/invite/${token}`;
}

// Idempotent: returns existing user if already linked (no duplicates on re-import)
function ensureUser(login, role) {
  const ex = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (ex) return { user: ex, created: false, token: null };
  const info = db.prepare('INSERT INTO users (login, password_hash, role, status, must_change_password) VALUES (?,?,?,? ,1)')
    .run(login, UNUSABLE, role, 'invited');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = createInvitation(user.id);
  return { user, created: true, token };
}

function provisionStudentAccount(studentId, actorId) {
  const st = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!st) throw new Error('Student not found');
  if (st.user_id) return { login: st.student_id, created: false, invite: null };
  const { user, created, token } = ensureUser(st.student_id, 'student');
  db.prepare('UPDATE students SET user_id = ? WHERE id = ?').run(user.id, studentId);
  audit(actorId, created ? 'account_provisioned' : 'account_linked', 'student', studentId, `login=${st.student_id}`);
  return { login: st.student_id, created, invite: token ? inviteLink(token) : null };
}

function provisionTeacherAccount(teacherId, actorId) {
  const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId);
  if (!t) throw new Error('Teacher not found');
  if (t.user_id) return { login: t.staff_id, created: false, invite: null };
  const { user, created, token } = ensureUser(t.staff_id, 'teacher');
  db.prepare('UPDATE teachers SET user_id = ? WHERE id = ?').run(user.id, teacherId);
  audit(actorId, 'account_provisioned', 'teacher', teacherId, `login=${t.staff_id}`);
  return { login: t.staff_id, created, invite: token ? inviteLink(token) : null };
}

function provisionParentAccount(parentId, actorId) {
  const p = db.prepare('SELECT * FROM parents WHERE id = ?').get(parentId);
  if (!p) throw new Error('Parent not found');
  if (p.user_id) return { login: 'P-' + String(p.id).padStart(4, '0'), created: false, invite: null };
  const login = 'P-' + String(p.id).padStart(4, '0');
  const { user, created, token } = ensureUser(login, 'parent');
  db.prepare('UPDATE parents SET user_id = ? WHERE id = ?').run(user.id, parentId);
  audit(actorId, 'account_provisioned', 'parent', parentId, `login=${login}`);
  return { login, created, invite: token ? inviteLink(token) : null };
}

function resendInvitation(userId, actorId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('User not found');
  db.prepare('UPDATE invitations SET used_at = datetime(\'now\') WHERE user_id = ? AND used_at IS NULL').run(userId);
  const token = createInvitation(userId);
  audit(actorId, 'invitation_resent', 'user', userId, null);
  return inviteLink(token);
}

module.exports = { ensureUser, provisionStudentAccount, provisionTeacherAccount, provisionParentAccount, resendInvitation, inviteLink, tokenHash };
