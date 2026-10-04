-- Chat-agent gateway: per-user agent tokens (hash only), an agent write kill switch,
-- the agent_assign approval kind and Lark delivery status on outbox rows.

CREATE TABLE agent_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE INDEX agent_token_user ON agent_token(user_id);

CREATE TABLE agent_kill_switch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by_user_id TEXT,
  updated_at TEXT
);
INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0);

-- SQLite cannot alter a CHECK constraint, so approval is rebuilt with the same columns.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE approval_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('owner_change', 'agent_stage_change', 'agent_assign')),
  lead_id TEXT NOT NULL REFERENCES lead(id),
  target_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  requested_by_user_id TEXT REFERENCES app_user(id),
  requested_by_kind TEXT NOT NULL CHECK (requested_by_kind IN ('human', 'agent')),
  decided_by_user_id TEXT REFERENCES app_user(id),
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
INSERT INTO approval_new (id, kind, lead_id, target_version, payload_json, reason, status, requested_by_user_id,
  requested_by_kind, decided_by_user_id, decided_at, decision_note, created_at, updated_at, version, last_txn_id)
SELECT id, kind, lead_id, target_version, payload_json, reason, status, requested_by_user_id,
  requested_by_kind, decided_by_user_id, decided_at, decision_note, created_at, updated_at, version, last_txn_id
FROM approval;
DROP TABLE approval;
ALTER TABLE approval_new RENAME TO approval;
CREATE INDEX approval_status ON approval(status, created_at);
CREATE INDEX approval_lead_kind_status ON approval(lead_id, kind, status);

ALTER TABLE outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN last_error TEXT;
ALTER TABLE outbox ADD COLUMN sent_at TEXT;
