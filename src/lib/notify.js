// Notification delivery: in-app is instant; email goes through a queue.
// Without SMTP configured (demo default), emails are logged, never sent.
const nodemailer = require('nodemailer');
const { db } = require('../db');

function transporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +(process.env.SMTP_PORT || 587),
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

// Queue an email delivery attempt for a notification (idempotent per notification)
function queueEmail(notificationId) {
  const ex = db.prepare(`SELECT id FROM notification_delivery_logs WHERE notification_id=? AND channel='email'`).get(notificationId);
  if (ex) return ex.id;
  return db.prepare(`INSERT INTO notification_delivery_logs (notification_id, channel, status) VALUES (?, 'email', 'queued')`)
    .run(notificationId).lastInsertRowid;
}

// Process the queue: send pending emails (max 50/run). Returns {sent, failed, skipped}.
async function processEmailQueue(limit = 50) {
  const rows = db.prepare(`SELECT l.id AS log_id, n.title, n.body, u.email
    FROM notification_delivery_logs l
    JOIN notifications n ON n.id = l.notification_id
    JOIN users u ON u.id = n.user_id
    WHERE l.channel='email' AND l.status='queued' ORDER BY l.id LIMIT ?`).all(limit);
  const t = transporter();
  let sent = 0, failed = 0, skipped = 0;
  for (const r of rows) {
    if (!r.email || !t) {
      db.prepare(`UPDATE notification_delivery_logs SET status='failed', attempts=attempts+1, provider_response=? WHERE id=?`)
        .run(!r.email ? 'no email address on file' : 'SMTP not configured (demo log-only mode)', r.log_id);
      skipped++;
      continue;
    }
    try {
      const info = await t.sendMail({
        from: process.env.SMTP_FROM || 'noreply@example.com',
        to: r.email,
        subject: `[HITEC Smart Campus] ${r.title}`,
        text: r.body,
      });
      db.prepare(`UPDATE notification_delivery_logs SET status='sent', attempts=attempts+1, provider_response=? WHERE id=?`)
        .run(info.messageId || 'ok', r.log_id);
      sent++;
    } catch (e) {
      db.prepare(`UPDATE notification_delivery_logs SET status='failed', attempts=attempts+1, provider_response=? WHERE id=?`)
        .run(String(e.message).slice(0, 300), r.log_id);
      failed++;
    }
  }
  return { sent, failed, skipped };
}

module.exports = { queueEmail, processEmailQueue, transporter };
