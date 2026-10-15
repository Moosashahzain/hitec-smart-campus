-- 002: email addresses for notification delivery (Phase 6)
ALTER TABLE users ADD COLUMN email TEXT;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
