-- A Zalo group the company number has left stays in the list. `left_at` is when Zalo
-- confirmed the leave. `leave_requested_at` is set while that confirmation is still outstanding.
ALTER TABLE conversation ADD COLUMN left_at TEXT;
ALTER TABLE conversation ADD COLUMN leave_requested_at TEXT;

-- SQLite cannot change a CHECK in place. Rebuild channel_command so a leave can be queued.
-- Nothing references this table, so the drop does not cascade into conversations or messages.
PRAGMA defer_foreign_keys = true;

CREATE TABLE channel_command_backup AS SELECT * FROM channel_command;
DROP TABLE channel_command;
CREATE TABLE channel_command (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('send_zalo', 'send_messenger', 'run_completion', 'send_lark', 'zalo_login', 'zalo_logout', 'send_zalo_oa', 'leave_zalo_group')),
  target TEXT NOT NULL CHECK (target IN ('bridge', 'worker')),
  channel_account_id TEXT REFERENCES channel_account(id),
  conversation_id TEXT REFERENCES conversation(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at TEXT,
  lease_expires_at TEXT,
  next_run_at TEXT NOT NULL,
  result_json TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO channel_command (
  id, kind, target, channel_account_id, conversation_id, payload_json, status, attempts,
  claimed_at, lease_expires_at, next_run_at, result_json, dedupe_key, created_at, updated_at
)
SELECT
  id, kind, target, channel_account_id, conversation_id, payload_json, status, attempts,
  claimed_at, lease_expires_at, next_run_at, result_json, dedupe_key, created_at, updated_at
FROM channel_command_backup;
DROP TABLE channel_command_backup;
CREATE INDEX channel_command_due ON channel_command(target, status, next_run_at);
