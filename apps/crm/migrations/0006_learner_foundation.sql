-- Learner pipeline foundation: three new roles, learner leads, customer ownership with a hold window,
-- product catalogue, products attached to customers and per-purpose consent.
-- SQLite cannot alter a CHECK constraint, so app_user and lead are rebuilt. The rebuild copies the rows
-- to a backup table, drops the original, recreates it and copies the rows back; the "_new then RENAME"
-- shortcut breaks foreign keys from child tables once they hold data.
PRAGMA defer_foreign_keys = ON;

-- app_user: widen the role CHECK.
CREATE TABLE app_user_backup AS SELECT * FROM app_user;
DROP TABLE app_user;
CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  department_id TEXT REFERENCES department(id),
  team_id TEXT REFERENCES team(id),
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('sale', 'leader', 'head', 'director', 'admin', 'academic', 'teacher', 'accountant')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  temp_password_expires_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  lark_open_id TEXT,
  lark_link_status TEXT NOT NULL DEFAULT 'unlinked' CHECK (lark_link_status IN ('unlinked', 'linked', 'unmatched', 'error')),
  lark_checked_at TEXT
);
INSERT INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, status, created_at, updated_at,
  version, last_txn_id, password_hash, password_salt, password_iterations, must_change_password, temp_password_expires_at,
  failed_login_count, locked_until, lark_open_id, lark_link_status, lark_checked_at)
SELECT id, organization_id, department_id, team_id, display_name, email, role, status, created_at, updated_at,
  version, last_txn_id, password_hash, password_salt, password_iterations, must_change_password, temp_password_expires_at,
  failed_login_count, locked_until, lark_open_id, lark_link_status, lark_checked_at
FROM app_user_backup;
DROP TABLE app_user_backup;
CREATE UNIQUE INDEX app_user_lark_open_id ON app_user(lark_open_id) WHERE lark_open_id IS NOT NULL;
CREATE INDEX app_user_org ON app_user(organization_id);

-- lead: add pipeline and partner contract, widen the stage CHECK, add the learner rules.
CREATE TABLE lead_backup AS SELECT * FROM lead;
DROP TABLE lead;
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
  stage TEXT NOT NULL CHECK (stage IN ('new', 'contacted', 'qualified', 'consulting', 'quoted', 'negotiating', 'closing',
    'trial_booked', 'trial_done', 'won', 'lost', 'not_fit')),
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
  won_note TEXT,
  pipeline TEXT NOT NULL DEFAULT 'b2b' CHECK (pipeline IN ('b2b', 'learner')),
  -- Checked by the command that sets it (no foreign key), so the partner table can arrive in a later migration.
  partner_contract_id TEXT,
  -- Forced Next Action (QĐ13): an assigned active lead always points at an open task.
  CHECK (status <> 'active' OR (owner_user_id IS NOT NULL AND next_action_task_id IS NOT NULL)),
  CHECK (status <> 'queue' OR owner_user_id IS NULL),
  CHECK (stage <> 'lost' OR lost_reason IS NOT NULL),
  CHECK (stage <> 'not_fit' OR lost_reason IS NOT NULL),
  CHECK (pipeline <> 'learner' OR status <> 'queue')
);
INSERT INTO lead (id, code, organization_id, department_id, team_id, account_id, contact_id, source, need_summary, expected_value,
  currency, owner_user_id, stage, status, next_action_task_id, lost_reason, lost_note, first_contact_at, assigned_at,
  stage_entered_at, last_activity_at, closed_at, created_by_user_id, created_at, updated_at, version, last_txn_id, won_note)
SELECT id, code, organization_id, department_id, team_id, account_id, contact_id, source, need_summary, expected_value,
  currency, owner_user_id, stage, status, next_action_task_id, lost_reason, lost_note, first_contact_at, assigned_at,
  stage_entered_at, last_activity_at, closed_at, created_by_user_id, created_at, updated_at, version, last_txn_id, won_note
FROM lead_backup;
DROP TABLE lead_backup;
CREATE INDEX lead_owner ON lead(owner_user_id, status);
CREATE INDEX lead_team ON lead(team_id, status);
CREATE INDEX lead_department ON lead(department_id, status);
CREATE INDEX lead_org_updated ON lead(organization_id, updated_at);
CREATE INDEX lead_contact ON lead(contact_id);
CREATE INDEX lead_account ON lead(account_id);

-- contact: owner and hold window for the learner flow.
ALTER TABLE contact ADD COLUMN owner_user_id TEXT REFERENCES app_user(id);
ALTER TABLE contact ADD COLUMN hold_started_at TEXT;
ALTER TABLE contact ADD COLUMN hold_expires_at TEXT;
ALTER TABLE contact ADD COLUMN archived_at TEXT;
CREATE INDEX contact_owner ON contact(owner_user_id);

CREATE TABLE product (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  name TEXT NOT NULL,
  description TEXT,
  price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE customer_product (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  product_id TEXT NOT NULL REFERENCES product(id),
  attached_by_user_id TEXT REFERENCES app_user(id),
  attached_at TEXT NOT NULL,
  detached_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX customer_product_active_uq ON customer_product(contact_id, product_id) WHERE detached_at IS NULL;

-- Append-only. The current state of a (contact, purpose) pair is its newest row.
CREATE TABLE consent (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('enrollment', 'fee', 'attendance', 'marketing', 'image')),
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  note TEXT,
  recorded_by_user_id TEXT REFERENCES app_user(id),
  recorded_at TEXT NOT NULL
);
CREATE INDEX consent_contact_purpose ON consent(contact_id, purpose, recorded_at);
