-- Password login, temporary lockout, Lark identity link and server-side sessions (ADR-006).
ALTER TABLE app_user ADD COLUMN password_hash TEXT;
ALTER TABLE app_user ADD COLUMN password_salt TEXT;
ALTER TABLE app_user ADD COLUMN password_iterations INTEGER;
ALTER TABLE app_user ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE app_user ADD COLUMN temp_password_expires_at TEXT;
ALTER TABLE app_user ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE app_user ADD COLUMN locked_until TEXT;
ALTER TABLE app_user ADD COLUMN lark_open_id TEXT;
ALTER TABLE app_user ADD COLUMN lark_link_status TEXT NOT NULL DEFAULT 'unlinked'
  CHECK (lark_link_status IN ('unlinked', 'linked', 'unmatched', 'error'));
ALTER TABLE app_user ADD COLUMN lark_checked_at TEXT;
CREATE UNIQUE INDEX app_user_lark_open_id ON app_user(lark_open_id) WHERE lark_open_id IS NOT NULL;

-- The cookie carries a random token; only its SHA-256 is stored.
CREATE TABLE user_session (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX user_session_user ON user_session(user_id);
