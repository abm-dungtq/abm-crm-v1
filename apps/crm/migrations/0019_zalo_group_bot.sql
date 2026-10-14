-- Bot replies inside Zalo groups: a per-group switch, agent and pause, the group member roster,
-- and the account's ABM staff whose messages never trigger the bot.
ALTER TABLE conversation ADD COLUMN bot_reply_enabled INTEGER NOT NULL DEFAULT 0 CHECK (bot_reply_enabled IN (0, 1));
ALTER TABLE conversation ADD COLUMN group_agent_key TEXT;
ALTER TABLE conversation ADD COLUMN bot_paused_until TEXT;

CREATE TABLE zalo_group_member (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, external_user_id)
);

CREATE TABLE zalo_staff_member (
  channel_account_id TEXT NOT NULL REFERENCES channel_account(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  display_name TEXT,
  marked_by_user_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel_account_id, external_user_id)
);

-- Groups the old code flipped to human start clean: the bot stays in ai and keeps no staff context.
UPDATE conversation SET mode = 'ai', staff_context_pending = NULL WHERE kind = 'group';
