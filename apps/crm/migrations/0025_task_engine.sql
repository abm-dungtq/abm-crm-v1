-- Task engine (PRD 19.2): CRM tasks keep lead_id and due_at; internal tasks have no lead, may have no due
-- date and may be 'in_progress'. 'in_progress' is internal-only so every lead rule that reads
-- status = 'open' keeps working. SQLite cannot drop NOT NULL, so task is rebuilt like app_user in 0006.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE task_backup AS SELECT * FROM task;
DROP TABLE task;
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'crm' CHECK (kind IN ('crm', 'internal')),
  lead_id TEXT REFERENCES lead(id),
  parent_task_id TEXT REFERENCES task(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at TEXT,
  assignee_user_id TEXT NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  outcome TEXT,
  completed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK (kind = 'internal' OR (lead_id IS NOT NULL AND due_at IS NOT NULL)),
  CHECK (kind = 'crm' OR lead_id IS NULL),
  CHECK (status <> 'in_progress' OR kind = 'internal')
);
INSERT INTO task (id, kind, lead_id, parent_task_id, title, description, priority, due_at, assignee_user_id, status,
  outcome, completed_at, created_by_user_id, created_at, updated_at, version, last_txn_id)
SELECT id, 'crm', lead_id, NULL, title, NULL, 'normal', due_at, assignee_user_id, status,
  outcome, completed_at, created_by_user_id, created_at, updated_at, version, last_txn_id
FROM task_backup;
DROP TABLE task_backup;
CREATE INDEX task_assignee ON task(assignee_user_id, status, due_at);
CREATE INDEX task_lead ON task(lead_id);
CREATE INDEX task_parent ON task(parent_task_id);

-- Collaborators: they see the task and its comments like the assignee does.
CREATE TABLE task_member (
  task_id TEXT NOT NULL REFERENCES task(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_member_user ON task_member(user_id);

-- Internal chat. D1 is the source of truth; the realtime hub (phase 02) only relays events.
-- kind 'task' is the comment thread of one task; 'direct' is a 1-1 chat keyed by the two sorted user ids.
CREATE TABLE chat_conversation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  kind TEXT NOT NULL CHECK (kind IN ('group', 'direct', 'task')),
  title TEXT,
  task_id TEXT UNIQUE REFERENCES task(id),
  direct_key TEXT UNIQUE,
  system_key TEXT UNIQUE,
  -- Direct chats only: 0 hides the chat from every member's connected MCP agents.
  agent_readable INTEGER NOT NULL DEFAULT 1 CHECK (agent_readable IN (0, 1)),
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  archived_at TEXT,
  CHECK ((kind = 'task') = (task_id IS NOT NULL)),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL))
);

CREATE TABLE chat_member (
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX chat_member_user ON chat_member(user_id);

-- author_agent_id points at chat_agent (added in 0028); no FK so this migration stays independent.
CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent', 'system')),
  author_user_id TEXT REFERENCES app_user(id),
  author_agent_id TEXT,
  parent_message_id TEXT REFERENCES chat_message(id),
  body TEXT NOT NULL,
  mentions_json TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((author_kind = 'user') = (author_user_id IS NOT NULL))
);
CREATE INDEX chat_message_conversation ON chat_message(conversation_id, created_at);
