-- Backup D1 trước khi áp lên remote theo docs/engineering/deployment-baseline.md
-- Lead stores selected program (product_id) and optional cohort (course_id).
-- contact_point adds zalo_oa_uid and migrates existing Zalo OA thread uids from zalo_uid.

ALTER TABLE lead ADD COLUMN product_id TEXT REFERENCES product(id);
ALTER TABLE lead ADD COLUMN course_id TEXT REFERENCES course(id);

PRAGMA defer_foreign_keys = ON;
CREATE TABLE contact_point_new (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contact(id),
  type TEXT NOT NULL CHECK (type IN ('phone', 'email', 'zalo_uid', 'fb_psid', 'zalo_oa_uid')),
  value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO contact_point_new (id, contact_id, type, value, normalized_value, created_at)
SELECT
  cp.id,
  cp.contact_id,
  CASE
    WHEN cp.type = 'zalo_uid' AND EXISTS (
      SELECT 1
      FROM conversation c
      JOIN channel_account ca ON ca.id = c.channel_account_id
      WHERE ca.channel = 'zalo_oa' AND c.external_thread_id = cp.value
    ) THEN 'zalo_oa_uid'
    ELSE cp.type
  END,
  cp.value,
  cp.normalized_value,
  cp.created_at
FROM contact_point cp;
DROP TABLE contact_point;
ALTER TABLE contact_point_new RENAME TO contact_point;
CREATE INDEX contact_point_lookup ON contact_point(type, normalized_value);
