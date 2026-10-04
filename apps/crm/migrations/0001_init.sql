-- CRM MVP1 evaluation schema: subset of docs/architecture/erd-v1.md.
-- Simplifications for the evaluation build: one role per user (no user_role table),
-- pipeline/stage/lost_reason live in packages/contracts, lead carries the pipeline (no deal split).
-- Every concurrently edited table has version + last_txn_id for the ADR-003 guard.

CREATE TABLE organization (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE department (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE team (
  id TEXT PRIMARY KEY,
  department_id TEXT NOT NULL REFERENCES department(id),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  department_id TEXT REFERENCES department(id),
  team_id TEXT REFERENCES team(id),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('sale', 'leader', 'head', 'director', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  tax_code TEXT,
  industry TEXT,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE UNIQUE INDEX account_tax_code_uq ON account(organization_id, tax_code) WHERE tax_code IS NOT NULL;

CREATE TABLE contact (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  display_name TEXT NOT NULL,
  job_title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE account_contact (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  role TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, contact_id)
);

CREATE TABLE contact_point (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  type TEXT NOT NULL CHECK (type IN ('phone', 'email')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX contact_point_lookup ON contact_point(type, normalized_value);

CREATE TABLE lead (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  department_id TEXT NOT NULL REFERENCES department(id),
  team_id TEXT REFERENCES team(id),
  account_id TEXT REFERENCES account(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  source TEXT NOT NULL,
  need_summary TEXT NOT NULL,
  expected_value INTEGER,
  currency TEXT NOT NULL DEFAULT 'VND',
  owner_user_id TEXT REFERENCES app_user(id),
  stage TEXT NOT NULL CHECK (stage IN ('new', 'contacted', 'qualified', 'consulting', 'quoted', 'negotiating', 'closing', 'won', 'lost')),
  status TEXT NOT NULL CHECK (status IN ('queue', 'active', 'won', 'lost')),
  next_action_task_id TEXT,
  lost_reason TEXT,
  lost_note TEXT,
  first_contact_at TEXT,
  assigned_at TEXT,
  stage_entered_at TEXT NOT NULL,
  last_activity_at TEXT,
  closed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  -- Forced Next Action (QĐ13): an assigned active lead always points at an open task.
  CHECK (status <> 'active' OR (owner_user_id IS NOT NULL AND next_action_task_id IS NOT NULL)),
  CHECK (status <> 'queue' OR owner_user_id IS NULL),
  CHECK (stage <> 'lost' OR lost_reason IS NOT NULL)
);
CREATE INDEX lead_owner ON lead(owner_user_id, status);
CREATE INDEX lead_team ON lead(team_id, status);
CREATE INDEX lead_department ON lead(department_id, status);

CREATE TABLE task (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES lead(id),
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'cancelled')),
  outcome TEXT,
  completed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX task_assignee ON task(assignee_user_id, status, due_at);
CREATE INDEX task_lead ON task(lead_id);

-- Append-only.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES lead(id),
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  actor_user_id TEXT REFERENCES app_user(id),
  actor_kind TEXT NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'agent', 'system')),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX activity_lead ON activity(lead_id, occurred_at);

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('owner_change', 'agent_stage_change')),
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
CREATE INDEX approval_status ON approval(status, created_at);

-- Append-only; retention >= 5 years (QĐ5).
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_kind TEXT NOT NULL,
  command TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_entity ON audit_log(entity, entity_id, created_at);
CREATE INDEX audit_created ON audit_log(created_at);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_key (
  actor_user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  command TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_user_id, key)
);

CREATE TABLE lead_counter (
  organization_id TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE _guard (ok INTEGER NOT NULL CHECK (ok = 1));
