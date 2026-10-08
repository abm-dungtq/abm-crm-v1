-- Backup D1 trước khi áp lên remote theo docs/engineering/deployment-baseline.md
-- contact_point also stores a Zalo user id (zalo_uid) and a Facebook page-scoped id (fb_psid).
-- SQLite cannot alter a CHECK constraint, so contact_point is rebuilt with the same columns.

PRAGMA defer_foreign_keys = ON;
CREATE TABLE contact_point_new (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  type TEXT NOT NULL CHECK (type IN ('phone', 'email', 'zalo_uid', 'fb_psid')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO contact_point_new (id, contact_id, type, value, normalized_value, created_at)
SELECT id, contact_id, type, value, normalized_value, created_at
FROM contact_point;
DROP TABLE contact_point;
ALTER TABLE contact_point_new RENAME TO contact_point;
CREATE INDEX contact_point_lookup ON contact_point(type, normalized_value);
