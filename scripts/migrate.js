// Applies SQL migrations in order. Usage: node scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { db, DB_PATH, transaction } = require('../src/db');

db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);

const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
const files = fs.readdirSync(path.join(__dirname, '..', 'migrations'))
  .filter(f => f.endsWith('.sql')).sort();

const run = transaction((name, sql) => {
  db.exec(sql);
  db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
});

for (const f of files) {
  if (applied.has(f)) { console.log('skip', f); continue; }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');
  run(f, sql);
  console.log('applied', f);
}
console.log('done ->', DB_PATH);
db.close();
