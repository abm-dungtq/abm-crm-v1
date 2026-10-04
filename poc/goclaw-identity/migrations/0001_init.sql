PRAGMA foreign_keys = ON;
CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
CREATE TABLE lark_group_binding (id TEXT PRIMARY KEY, department TEXT NOT NULL);
CREATE TABLE channel_identity (
  channel_instance TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  PRIMARY KEY (channel_instance, sender_id)
);
CREATE TABLE mcp_credential (
  token_hash TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
);
CREATE TABLE agent_kill_switch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
);
INSERT INTO agent_kill_switch VALUES (1, 0);
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  lead_ref TEXT NOT NULL,
  note TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL UNIQUE REFERENCES activity(id),
  executing_actor TEXT NOT NULL CHECK (executing_actor = 'goclaw'),
  initiating_user TEXT REFERENCES user(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Enforce the switch at mutation time, including when requests race its update.
CREATE TRIGGER block_agent_activity BEFORE INSERT ON activity
WHEN COALESCE((SELECT enabled FROM agent_kill_switch WHERE id = 1), 1) = 1
BEGIN
  SELECT RAISE(ABORT, 'KILL_SWITCH_ON');
END;
