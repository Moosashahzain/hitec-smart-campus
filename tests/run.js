// E2E + security test suite. Usage: node tests/run.js
// Spins up the app against a TEMP database (never touches data/hitec.db).
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hitec-test-')), 'test.db');
process.env.DB_PATH = tmpDb;
process.env.APP_URL = 'http://localhost:3210';
process.env.SESSION_SECRET = 'test-secret';

const { execSync } = require('child_process');
execSync('node scripts/migrate.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
execSync('node scripts/seed.js', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });

const app = require('../src/app');
const server = app.listen(3210);
const BASE = 'http://localhost:3210';
const today = new Date().toISOString().slice(0, 10);

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
class Jar {
  constructor() { this.c = ''; }
  async req(p, opt = {}) {
    const r = await fetch(BASE + p, { ...opt, headers: { ...(opt.headers || {}), Cookie: this.c }, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) this.c = sc.split(';')[0];
    const text = await r.text();
    return { s: r.status, t: text, loc: r.headers.get('location') };
  }
}
async function login(jar, login, pw) {
  const r = await jar.req('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `login=${login}&password=${encodeURIComponent(pw)}` });
  return r.s === 302 && !/\/login/.test(r.loc || '');
}

(async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(tmpDb);
  const { processEmailQueue } = require('../src/lib/notify');

  console.log('== auth ==');
  const anon = new Jar();
  check('health', (await anon.req('/health')).s === 200);
  check('anon /management redirects to login', (await anon.req('/management')).s === 302);
  const bad = new Jar();
  check('wrong password rejected', !(await login(bad, 'admin', 'wrong')));
  check('wrong password cannot reach dashboard', (await bad.req('/management')).s === 302);

  console.log('== roles & isolation ==');
  const admin = new Jar(), stu = new Jar(), tea = new Jar(), par = new Jar();
  check('admin login', await login(admin, 'admin', 'Admin@123'));
  check('student login', await login(stu, 'STU-2026-001', 'Student@123'));
  check('teacher login', await login(tea, 'T-1001', 'Teacher@123'));
  check('parent login', await login(par, 'P-1001', 'Parent@123'));
  check('admin dashboard 200', (await admin.req('/management')).s === 200);
  check('student blocked from /management (403)', (await stu.req('/management')).s === 403);
  check('student blocked from /teacher (403)', (await stu.req('/teacher')).s === 403);
  check('teacher blocked from /management (403)', (await tea.req('/management')).s === 403);
  check('teacher dashboard 200', (await tea.req('/teacher')).s === 200);
  check('parent cannot view unrelated child (403)', (await par.req('/parent/child/99999')).s === 403);
  check('parent views own child (200)', (await par.req('/parent/child/1')).s === 200);

  console.log('== management: students CSV ==');
  const csv = await admin.req('/management/students/export.csv');
  check('export 200 + csv body', csv.s === 200 && csv.t.startsWith('student_id,'), `s=${csv.s}`);
  check('export has no password column', !/password/i.test(csv.t));
  const imp = await admin.req('/management/students/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'student_id,roll_number,name,class,section\nSTU-2026-001,101,Dup,ICS-I,A\n,109,CSV Kid,ICS-I,A\n' });
  const ij = JSON.parse(imp.t);
  check('import: 1 created, 1 duplicate skipped', ij.created === 1 && ij.skipped_duplicate === 1 && ij.errors.length === 0, imp.t);

  console.log('== attendance engine ==');
  const sub = await tea.req('/teacher/mark', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `class_id=1&section_id=1&date=${today}&st_1=absent&st_2=present&st_3=late` });
  check('teacher submits attendance', sub.s === 200 && /submitted/i.test(sub.t), `s=${sub.s}`);
  const dup = await tea.req('/teacher/mark', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `class_id=1&section_id=1&date=${today}&st_1=present` });
  check('duplicate submission rejected (no silent overwrite)', dup.s === 409, `s=${dup.s}`);
  const un = await tea.req('/teacher/mark', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `class_id=999&section_id=1&date=${today}&st_1=present` });
  check('unassigned class rejected (403)', un.s === 403, `s=${un.s}`);
  const seen = await stu.req('/student/attendance');
  check('student sees own attendance record', seen.s === 200 && seen.t.includes(today));
  const pview = await par.req('/parent');
  check('parent sees absent alert for linked child', pview.s === 200 && /marked <b>absent<\/b>/.test(pview.t));

  console.log('== notification email queue ==');
  const eq = db.prepare("SELECT COUNT(*) c FROM notification_delivery_logs WHERE channel='email'").get().c;
  check('absence queued an email delivery row', eq > 0, `c=${eq}`);
  const qr = await processEmailQueue();
  check('worker runs safely in log-only mode (no SMTP)', qr.sent === 0 && qr.skipped > 0, JSON.stringify(qr));

  console.log('== corrections ==');
  const rec = db.prepare("SELECT id FROM attendance_records WHERE student_id=1 AND status='absent'").get();
  const cr = await tea.req('/teacher/corrections', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `record_id=${rec.id}&new_status=present&reason=test` });
  check('teacher requests correction', cr.s === 200, `s=${cr.s}`);
  const cid = db.prepare('SELECT id FROM attendance_corrections ORDER BY id DESC LIMIT 1').get().id;
  const ap = await admin.req(`/management/corrections/${cid}/approve`, { method: 'POST' });
  check('management approves correction', ap.s === 302);
  check('record updated', db.prepare('SELECT status FROM attendance_records WHERE id=?').get(rec.id).status === 'present');

  console.log('== fines (engine OFF by default) ==');
  check('fine engine OFF by default', db.prepare("SELECT value FROM system_settings WHERE key='fine_engine_enabled'").get().value === '0');
  check('no fines generated while OFF', db.prepare('SELECT COUNT(*) c FROM fine_records').get().c === 0);
  await admin.req('/management/fines/engine', { method: 'POST' });
  const ft = db.prepare("SELECT id FROM fine_types WHERE trigger='absent'").get().id;
  await admin.req(`/management/fines/types/${ft}/toggle`, { method: 'POST' });
  const d2 = '2099-01-02';
  await tea.req('/teacher/mark', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `class_id=1&section_id=1&date=${d2}&st_1=present&st_2=absent&st_3=present` });
  const fines = db.prepare('SELECT amount_pkr,status FROM fine_records').all();
  check('fine generated after management approval (PKR 100)', fines.length === 1 && fines[0].amount_pkr === 100, JSON.stringify(fines));
  const fid = db.prepare('SELECT id FROM fine_records LIMIT 1').get().id;
  await admin.req(`/management/fines/${fid}/waive`, { method: 'POST' });
  check('fine waived', db.prepare('SELECT status FROM fine_records WHERE id=?').get(fid).status === 'waived');

  console.log('== leave workflow ==');
  const lr = await stu.req('/student/leave', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'from_date=2099-02-01&to_date=2099-02-02&reason=test+leave' });
  check('student submits leave', lr.s === 302);
  const lid = db.prepare('SELECT id FROM leave_requests ORDER BY id DESC LIMIT 1').get().id;
  await admin.req(`/management/leaves/${lid}/approve`, { method: 'POST' });
  check('leave approved', db.prepare('SELECT status FROM leave_requests WHERE id=?').get(lid).status === 'approved');
  check('student notified of approval', db.prepare("SELECT COUNT(*) c FROM notifications WHERE title LIKE 'Leave%'").get().c > 0);

  console.log('== invitations (no shared passwords) ==');
  const add = await admin.req('/management/students', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=Invitee+Test&roll_number=110&gender=female&class_id=1&section_id=1' });
  const link = (add.t.match(/http:\/\/localhost:3210\/invite\/[a-f0-9]+/) || [])[0];
  check('setup link issued', !!link);
  const invPage = await anon.req(link.replace('http://localhost:3210', ''));
  check('invite page loads', invPage.s === 200);
  const acc = await anon.req(link.replace('http://localhost:3210', ''), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=Invitee@123&confirm=Invitee@123' });
  check('invitation accepted, password set', acc.s === 302);
  const acc2 = await anon.req(link.replace('http://localhost:3210', ''), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=X@12345678&confirm=X@12345678' });
  check('invitation single-use (reuse rejected)', acc2.s === 400);
  const newStu = new Jar();
  const newLogin = db.prepare("SELECT student_id FROM students WHERE name='Invitee Test'").get().student_id;
  check('new student logs in with own password', await login(newStu, newLogin, 'Invitee@123'));
  check('new student reaches own portal', (await newStu.req('/student')).s === 200);

  console.log('== password reset ==');
  const fp1 = await anon.req('/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'login=nosuchuser' });
  check('forgot-password non-enumerating (302)', fp1.s === 302);
  const crypto = require('crypto');
  const tok = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(tok).digest('hex');
  const uid = db.prepare("SELECT id FROM users WHERE login='STU-2026-002'").get().id;
  db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,datetime('now','+1 hour'))").run(uid, th);
  check('reset page loads', (await anon.req(`/reset-password?token=${tok}`)).s === 200);
  check('reset completes', (await anon.req(`/reset-password?token=${tok}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=BrandNew@123' })).s === 302);
  const s2 = new Jar();
  check('new password works', await login(s2, 'STU-2026-002', 'BrandNew@123'));
  check('reset token single-use', (await anon.req(`/reset-password?token=${tok}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=Another@123' })).s === 400);

  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH:', e); server.close(); process.exit(1); });
