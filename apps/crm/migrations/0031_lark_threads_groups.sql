-- Lark-style replies. reply_to_message_id is the quoted message and the reply stays in the main flow;
-- thread_root_id puts a message in the thread of that root; also_in_main shows a thread reply in the main flow too.
-- parent_message_id is kept as history: its replies become quote replies and no code reads it any more.
ALTER TABLE chat_message ADD COLUMN reply_to_message_id TEXT REFERENCES chat_message(id);
ALTER TABLE chat_message ADD COLUMN thread_root_id TEXT REFERENCES chat_message(id);
ALTER TABLE chat_message ADD COLUMN also_in_main INTEGER NOT NULL DEFAULT 0 CHECK (also_in_main IN (0, 1));
UPDATE chat_message SET reply_to_message_id = parent_message_id WHERE parent_message_id IS NOT NULL;
CREATE INDEX chat_message_thread ON chat_message(thread_root_id, created_at) WHERE thread_root_id IS NOT NULL;

-- One row per thread (or topic). Counters are kept here so thread cards and the followed-thread list need no scan.
CREATE TABLE chat_thread (
  root_message_id TEXT PRIMARY KEY REFERENCES chat_message(id),
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  is_topic INTEGER NOT NULL DEFAULT 0 CHECK (is_topic IN (0, 1)),
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_reply_at TEXT,
  last_activity_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL
);
CREATE INDEX chat_thread_conversation ON chat_thread(conversation_id, last_activity_at);

-- Followers get thread notifications and a per-thread unread count. muted keeps the follow without notifications.
CREATE TABLE chat_thread_follower (
  root_message_id TEXT NOT NULL REFERENCES chat_thread(root_message_id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  via TEXT NOT NULL CHECK (via IN ('author', 'reply', 'mention', 'manual')),
  muted INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  last_read_at TEXT,
  followed_at TEXT NOT NULL,
  PRIMARY KEY (root_message_id, user_id)
);
CREATE INDEX chat_thread_follower_user ON chat_thread_follower(user_id);

-- Group tree and topic mode. A department group has id and system_key 'dept:<department id>' and is kept in sync
-- with app_user.department_id; a subgroup points at its department group through parent_conversation_id.
ALTER TABLE chat_conversation ADD COLUMN parent_conversation_id TEXT REFERENCES chat_conversation(id);
ALTER TABLE chat_conversation ADD COLUMN department_id TEXT REFERENCES department(id);
ALTER TABLE chat_conversation ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat' CHECK (mode IN ('chat', 'topic'));
CREATE UNIQUE INDEX chat_conversation_department ON chat_conversation(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX chat_conversation_parent ON chat_conversation(parent_conversation_id) WHERE parent_conversation_id IS NOT NULL;

-- Where a task was created from in chat. No foreign keys: a task outlives chat clean-up.
ALTER TABLE task ADD COLUMN source_conversation_id TEXT;
ALTER TABLE task ADD COLUMN source_message_id TEXT;
ALTER TABLE task ADD COLUMN source_scope TEXT CHECK (source_scope IN ('message', 'thread'));

-- Thread replies notify followers with their own kind. SQLite cannot change a CHECK, so notification is rebuilt
-- like task in 0025. Nothing references notification.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE notification_backup AS SELECT * FROM notification;
DROP TABLE notification;
CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  kind TEXT NOT NULL CHECK (kind IN ('chat_direct', 'chat_mention', 'chat_thread', 'task_assigned', 'task_due', 'approval', 'inbox', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);
INSERT INTO notification (id, user_id, kind, title, body, link, dedupe_key, created_at, read_at)
SELECT id, user_id, kind, title, body, link, dedupe_key, created_at, read_at FROM notification_backup;
DROP TABLE notification_backup;
CREATE INDEX notification_user ON notification(user_id, read_at, created_at);
