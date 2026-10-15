# Backup & restore — HITEC Smart Campus

The database is a single SQLite file: `data/hitec.db`
(SQLite WAL mode also creates `hitec.db-wal` / `hitec.db-shm` while running).

## Manual backup (safe while the app is running)

Use SQLite's online backup — never just `cp` the file while WAL is active:

```bash
cd ~/workspace/hitec-smart-campus
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('./data/hitec.db');
db.exec(\"VACUUM INTO 'backup/hitec-\$(date +%F).db'\");
console.log('backup done');"
```

Or with the sqlite3 CLI if installed:

```bash
sqlite3 data/hitec.db ".backup 'backup/hitec-$(date +%F).db'"
```

## Restore

1. Stop the app.
2. Replace `data/hitec.db` with the backup file (delete `-wal`/`-shm` if present).
3. Start the app and run `npm test` to verify.

## Scheduled backups (example cron, daily 02:00)

```cron
0 2 * * * cd /home/hatch/workspace/hitec-smart-campus && node -e "const{DatabaseSync}=require('node:sqlite');new DatabaseSync('./data/hitec.db').exec(\"VACUUM INTO 'backup/hitec-\$(date +\%F).db'\")" && find backup -name 'hitec-*.db' -mtime +30 -delete
```

Keeps 30 days of daily backups, prunes older ones.

## What is backed up

- Everything: users, students, teachers, attendance, fines, results,
  notifications, audit logs, invitations.
- What is NOT in the DB: uploaded files (none yet), `.env` secrets —
  back those up separately and keep them out of git.
