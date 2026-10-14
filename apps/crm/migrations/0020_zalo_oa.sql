-- Zalo Official Account is its own channel, with rotating OAuth tokens stored per account
-- and delivery/seen receipts on each message.
-- SQLite cannot alter a CHECK constraint, so channel_account and channel_command are rebuilt.
-- Copy to a backup, drop, recreate under the same name and copy back. The "_new then RENAME"
-- shortcut breaks foreign keys from child tables once they hold data (see 0006).
-- Dropping channel_account fires ON DELETE CASCADE, so zalo_staff_member is parked first.

PRAGMA defer_foreign_keys = true;

CREATE TABLE zalo_staff_member_backup AS SELECT * FROM zalo_staff_member;

CREATE TABLE channel_account_backup AS SELECT * FROM channel_account;
DROP TABLE channel_account;
CREATE TABLE channel_account (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  channel TEXT NOT NULL CHECK (channel IN ('zalo', 'facebook', 'zalo_oa')),
  -- Zalo uid of the number or the Facebook page id; unknown until the account first connects.
  external_id TEXT,
  display_name TEXT NOT NULL,
  agent_key TEXT,
  bot_enabled INTEGER NOT NULL DEFAULT 1 CHECK (bot_enabled IN (0, 1)),
  send_paused INTEGER NOT NULL DEFAULT 0 CHECK (send_paused IN (0, 1)),
  daily_send_cap INTEGER NOT NULL DEFAULT 40 CHECK (daily_send_cap >= 0),
  -- Quiet hours as HH:MM in Vietnam time; both null means no quiet hours.
  quiet_start TEXT,
  quiet_end TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'qr_pending', 'connected', 'error')),
  qr_image TEXT,
  qr_expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_error TEXT,
  registration_policy INTEGER NOT NULL DEFAULT 0 CHECK (registration_policy IN (0, 1)),
  -- Group link for registration confirmations. Empty means the policy has no link to require.
  registration_group_url TEXT,
  UNIQUE (channel, external_id)
);
INSERT INTO channel_account (
  id, organization_id, channel, external_id, display_name, agent_key, bot_enabled, send_paused,
  daily_send_cap, quiet_start, quiet_end, status, qr_image, qr_expires_at, last_seen_at,
  created_at, updated_at, last_error
)
SELECT
  id, organization_id, channel, external_id, display_name, agent_key, bot_enabled, send_paused,
  daily_send_cap, quiet_start, quiet_end, status, qr_image, qr_expires_at, last_seen_at,
  created_at, updated_at, last_error
FROM channel_account_backup;
DROP TABLE channel_account_backup;

INSERT INTO zalo_staff_member SELECT * FROM zalo_staff_member_backup;
DROP TABLE zalo_staff_member_backup;

CREATE TABLE channel_command_backup AS SELECT * FROM channel_command;
DROP TABLE channel_command;
CREATE TABLE channel_command (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('send_zalo', 'send_messenger', 'run_completion', 'send_lark', 'zalo_login', 'zalo_logout', 'send_zalo_oa')),
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

CREATE TABLE zalo_oa_credential (
  channel_account_id TEXT PRIMARY KEY REFERENCES channel_account(id) ON DELETE CASCADE,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  -- Bumped on every refresh; a refresh writes only when the version it read is still current.
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE zalo_oa_oauth_state (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
ALTER TABLE message ADD COLUMN delivered_at TEXT;
ALTER TABLE message ADD COLUMN seen_at TEXT;
