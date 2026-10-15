// Shared SQLite connection via Node's built-in node:sqlite (no native deps).
// WAL mode for concurrent reads.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'hitec.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

// Synchronous transaction helper (node:sqlite has no built-in wrapper)
function transaction(fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const r = fn.apply(null, args);
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    }
  };
}

// Asia/Karachi helpers — store ISO local date strings
function todayK() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date()); // YYYY-MM-DD
}
function nowK() {
  return new Date().toISOString();
}

module.exports = { db, DB_PATH, todayK, nowK, transaction };
