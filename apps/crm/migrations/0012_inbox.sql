-- Omnichannel inbox: channel accounts (Zalo personal numbers, Facebook pages), conversations and
-- messages, the leased command queue shared by the Worker and the Zalo bridge sidecar, chatbot
-- lead intake awaiting classification, the staff roster, recurring group posts, and the
-- customer-facing bot switch.

CREATE TABLE channel_account (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  channel TEXT NOT NULL CHECK (channel IN ('zalo', 'facebook')),
  -- Zalo uid of the number or the Facebook page id; unknown until the account first connects.
  external_id TEXT,
  display_name TEXT NOT NULL,
  agent_key TEXT,
  bot_enabled INTEGER NOT NULL DEFAULT 1 CHECK (bot_enabled IN (0, 1)),
  send_paused INTEGER NOT NULL DEFAULT 0 CHECK (send_paused IN (0, 1)),
  daily_send_cap INTEGER NOT NULL DEFAULT 40 CHECK (daily_send_cap >= 0),
  -- Quiet hours as HH:MM in Vietnam time; both null means no quiet hours.
  quiet_start TEXT,
  quiet_end TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'qr_pending', 'connected', 'error')),
  qr_image TEXT,
  qr_expires_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel, external_id)
);

CREATE TABLE conversation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  channel_account_id TEXT NOT NULL REFERENCES channel_account(id),
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  external_thread_id TEXT NOT NULL,
  contact_id TEXT REFERENCES contact(id),
  display_name TEXT,
  mode TEXT NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'human', 'paused')),
  assignee_user_id TEXT REFERENCES app_user(id),
  assigned_at TEXT,
  handoff_reason TEXT,
  -- Staff/customer exchange from human or paused mode (last 1500 chars), prefixed to the bot's next turn, then cleared.
  staff_context_pending TEXT,
  ai_lock_until TEXT,
  last_message_at TEXT,
  last_inbound_at TEXT,
  last_staff_reply_at TEXT,
  sla_due_at TEXT,
  summary_enabled INTEGER NOT NULL DEFAULT 0 CHECK (summary_enabled IN (0, 1)),
  scheduled_opt_out INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_opt_out IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (channel_account_id, external_thread_id)
);
CREATE INDEX conversation_org_recent ON conversation(organization_id, last_message_at);
CREATE INDEX conversation_assignee_mode ON conversation(assignee_user_id, mode);

CREATE TABLE message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('customer', 'bot', 'staff_web', 'staff_phone', 'system')),
  sender_external_id TEXT,
  sent_by_user_id TEXT REFERENCES app_user(id),
  -- Null for an outgoing message until the channel confirms it; then unique per conversation.
  external_msg_id TEXT,
  body TEXT NOT NULL,
  attachments_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'pending', 'sent', 'failed')),
  created_at TEXT NOT NULL,
  UNIQUE (conversation_id, external_msg_id)
);
CREATE INDEX message_conversation_time ON message(conversation_id, created_at);

CREATE TABLE channel_command (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('send_zalo', 'send_messenger', 'run_completion', 'send_lark', 'zalo_login', 'zalo_logout')),
  target TEXT NOT NULL CHECK (target IN ('bridge', 'worker')),
  channel_account_id TEXT REFERENCES channel_account(id),
  conversation_id TEXT REFERENCES conversation(id),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claimed_at TEXT,
  lease_expires_at TEXT,
  next_run_at TEXT NOT NULL,
  result_json TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX channel_command_due ON channel_command(target, status, next_run_at);

CREATE TABLE lead_intake (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  contact_id TEXT REFERENCES contact(id),
  fields_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'classified', 'discarded')),
  lead_id TEXT REFERENCES lead(id),
  classified_by_user_id TEXT REFERENCES app_user(id),
  classified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lead_intake_status ON lead_intake(status, created_at);

CREATE TABLE inbox_roster (
  user_id TEXT PRIMARY KEY REFERENCES app_user(id),
  on_duty INTEGER NOT NULL DEFAULT 0 CHECK (on_duty IN (0, 1)),
  last_assigned_at TEXT
);

CREATE TABLE group_schedule (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  template_text TEXT NOT NULL,
  -- Bit 0 = Monday ... bit 6 = Sunday.
  weekdays_mask INTEGER NOT NULL CHECK (weekdays_mask BETWEEN 1 AND 127),
  -- HH:MM in Vietnam time.
  time_of_day TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'active', 'paused')),
  approved_by_user_id TEXT REFERENCES app_user(id),
  approved_at TEXT,
  next_run_at TEXT,
  last_run_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX group_schedule_due ON group_schedule(status, next_run_at);

-- enabled = 1 turns the customer-facing bot OFF, the same meaning as agent_kill_switch.
CREATE TABLE customer_bot_switch (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by_user_id TEXT REFERENCES app_user(id),
  updated_at TEXT
);
INSERT INTO customer_bot_switch (id, enabled) VALUES (1, 0);
