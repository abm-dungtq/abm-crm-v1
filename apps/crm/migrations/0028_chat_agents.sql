-- GoClaw agents that take part in internal chat. dm_agent_key answers direct chats with the caller's own
-- CRM credential; group_agent_key answers @mentions in groups and task threads and has no CRM tools.
CREATE TABLE chat_agent (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  display_name TEXT NOT NULL,
  dm_agent_key TEXT,
  group_agent_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (dm_agent_key IS NOT NULL OR group_agent_key IS NOT NULL)
);

CREATE TABLE chat_agent_member (
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  agent_id TEXT NOT NULL REFERENCES chat_agent(id),
  added_by_user_id TEXT REFERENCES app_user(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, agent_id)
);
