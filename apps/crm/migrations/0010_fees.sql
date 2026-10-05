-- Fee ledger. A charge balance is the nominal amount minus allocations still in force.
-- That balance is never stored. A refund is only a payment row and is never allocated.

CREATE TABLE org_setting (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL UNIQUE REFERENCES organization(id),
  bank_name TEXT,
  bank_account_no TEXT,
  bank_account_holder TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);

-- One settings row per organization that already exists. id always equals organization_id.
INSERT INTO org_setting (id, organization_id, created_at, updated_at, version)
SELECT id, id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1 FROM organization;

CREATE TABLE fee_counter (
  organization_id TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE charge (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  code TEXT NOT NULL,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  enrollment_id TEXT REFERENCES enrollment(id),
  kind TEXT NOT NULL CHECK (kind IN ('tuition', 'deposit', 'material', 'adjustment')),
  amount_vnd INTEGER NOT NULL,
  product_name TEXT,
  sessions_count INTEGER,
  note TEXT,
  invoice_ref TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'void')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  UNIQUE (organization_id, code),
  CHECK (kind = 'adjustment' OR amount_vnd > 0)
);
CREATE INDEX charge_contact ON charge(contact_id);
CREATE INDEX charge_enrollment ON charge(enrollment_id);

CREATE TABLE payment (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'refund')),
  method TEXT NOT NULL CHECK (method IN ('transfer', 'cash')),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
  received_at TEXT NOT NULL,
  memo TEXT,
  payer_note TEXT,
  -- Set only for a refund, so that refund can appear on one learner's ledger. Incoming money is matched through allocations.
  contact_id TEXT REFERENCES contact(id),
  recorded_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX payment_org_received ON payment(organization_id, received_at);
CREATE INDEX payment_contact ON payment(contact_id);

CREATE TABLE payment_allocation (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment(id),
  charge_id TEXT NOT NULL REFERENCES charge(id),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
  created_by_user_id TEXT REFERENCES app_user(id),
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX payment_allocation_charge ON payment_allocation(charge_id);
CREATE INDEX payment_allocation_payment ON payment_allocation(payment_id);
