CREATE TABLE lead (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  next_action_task_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  lead_id TEXT,
  status TEXT NOT NULL,
  due_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE idempotency_key (
  key TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  entity TEXT,
  entity_id TEXT,
  action TEXT,
  after_json TEXT,
  created_at TEXT
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE _guard (ok INTEGER NOT NULL CHECK (ok = 1));
