// Shared SQLite connection.
// Primary: Node's built-in node:sqlite (Node >= 22.5, zero native deps).
// Fallback: better-sqlite3 (prebuilt binaries, for hosts running older Node,
// e.g. free-tier containers). Both expose the same sync API surface we use
// (exec / prepare().run().get().all() / close), so the rest of the app is
// driver-agnostic.
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'hitec.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;
let DRIVER = 'node:sqlite';
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
} catch (e) {
  DRIVER = 'better-sqlite3';
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
  } catch (e2) {
    console.error(
      '[db] No SQLite driver available: node:sqlite needs Node >= 22.5, ' +
      'and better-sqlite3 is not installed. Run `npm install` (it is an ' +
      'optional dependency) or upgrade Node.'
    );
    throw e2;
  }
}
console.log(`[db] driver=${DRIVER} path=${DB_PATH}`);
db.exec('PRAGMA journal_mode = WAL;');

// Synchronous transaction helper (neither driver exposes a wrapper we use)
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

module.exports = { db, DB_PATH, DRIVER, todayK, nowK, transaction };
