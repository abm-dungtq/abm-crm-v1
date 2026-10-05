-- Admissions: journey steps per learner lead and partner contracts with their own checklist.

CREATE TABLE lead_step (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES lead(id),
  step_code TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  position INTEGER NOT NULL,
  -- Journey template version the row was copied from, so a later template change never rewrites old leads.
  template_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'skipped')),
  skip_reason TEXT,
  done_at TEXT,
  done_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  UNIQUE (lead_id, step_code)
);

CREATE TABLE partner_contract (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  account_id TEXT NOT NULL REFERENCES account(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'done', 'cancelled')),
  starts_on TEXT,
  ends_on TEXT,
  note TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

CREATE TABLE partner_contract_step (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES partner_contract(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  done_at TEXT,
  done_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX partner_contract_step_contract ON partner_contract_step(contract_id, position);

CREATE INDEX lead_pipeline_contact ON lead(pipeline, contact_id);
CREATE INDEX partner_contract_account_status ON partner_contract(account_id, status);
