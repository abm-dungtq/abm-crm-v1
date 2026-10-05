-- A request to access, correct, withdraw consent, or delete one customer's personal data.
-- Hiding a contact changes the name and contact points only. Money rows stay.

CREATE TABLE privacy_request (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  contact_id TEXT NOT NULL REFERENCES contact(id),
  kind TEXT NOT NULL CHECK (kind IN ('access', 'correct', 'withdraw_consent', 'delete')),
  detail TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
  resolution TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  resolved_by_user_id TEXT REFERENCES app_user(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT
);
CREATE INDEX privacy_request_contact ON privacy_request(contact_id, status);
