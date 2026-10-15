// Email queue worker. Usage: node scripts/notify-worker.js
// Safe to run on a schedule (cron every 5-15 min). Without SMTP configured it
// only marks queued emails as skipped — never sends, never crashes.
process.env.DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'hitec.db');
const { processEmailQueue } = require('../src/lib/notify');

processEmailQueue().then((r) => {
  console.log(`email queue: sent=${r.sent} failed=${r.failed} skipped=${r.skipped}` +
    (process.env.SMTP_HOST ? '' : ' (SMTP not configured — log-only mode)'));
  process.exit(0);
}).catch((e) => { console.error('worker error:', e.message); process.exit(1); });
