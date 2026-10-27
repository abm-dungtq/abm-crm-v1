---
phase: 1
title: "Data model and quote reply (backend)"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 01: Data model and quote reply (backend)

## Goal
1. Migration `0031_lark_threads_groups.sql` adds every column and table this plan needs (threads, followers, group tree, topic mode, task source, notification kind `chat_thread`).
2. "Trả lời" becomes a real **quote reply**: `chat_message.reply_to_message_id` points at the quoted message, the reply stays in the main flow, and the API returns a quote preview. Old `parent_message_id` replies become quote replies.
3. Main-flow semantics for listing and unread are in place (`thread_root_id IS NULL OR also_in_main = 1`), so phase 02 only adds threads.
4. `GET /api/chat/messages/:id/context` returns the main-flow window around one message (jump to original, deep links).

Proves acceptance criteria 1 (server side), 14.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Work from `D:\TQD\CRM`; shell is PowerShell; `pnpm` is on PATH.
- Workers Free: at most 50 D1 queries per invocation (a `db.batch` counts as one); this plan caps at 40. Never loop `.run()` per row.
- No code may read `chat_message.parent_message_id` after this phase except the migration. Gate: `Select-String -Path apps/crm/src -Pattern 'parent_message_id' -Recurse` (use `Get-ChildItem apps/crm/src -Recurse -Include *.ts,*.tsx | Select-String 'parent_message_id'`) prints nothing.
- Do not put plan or phase ids in comments, test names or the migration name.

## Context (verified 2026-10-26)
- `chat_message` schema: `apps/crm/migrations/0025_task_engine.sql:83-97` (single `parent_message_id`, index `chat_message_conversation(conversation_id, created_at)`).
- `chat_conversation`: `0025_task_engine.sql:51-69`; `notification` with kind CHECK: `0027_notifications.sql:2-13`; `department`/`team`: `0001_init.sql:15-33`.
- `insertMessage`: `apps/crm/src/worker/chat.ts` (`export async function insertMessage`, ~line 520) — `INSERT OR IGNORE … WHERE ?6 IS NULL OR EXISTS (parent in same conversation)`, then `UPDATE chat_conversation SET last_message_at`.
- `listMessages`: `chat.ts` ~line 455; `listConversations` unread subquery ~line 245; `unreadTotal` ~line 290; `agentVisibleConversations` unread ~line 655; `AGENT_MESSAGE_SELECT`/`toAgentMessage` ~line 690.
- Callers of `insertMessage`: `chat-routes.ts:479` (POST messages), `chat.ts:728` (`postTaskComment`), `chat-agents.ts:517` (offline notice), `chat-agents.ts:618` (agent reply), `chat-agents.ts:663` (agent failure). `postInboxNotice` in `inbox-notices.ts` inserts top-level system messages and needs no change.
- `parentMessageId` users: `chat-routes.ts` POST body, `index.ts:124-137` (task comment POST), `chat.ts` `postTaskComment`, `chat-agents.ts` (`ChatCompletionPayload.parentMessageId`, history query `?3 IS NULL OR m.id = ?3 OR m.parent_message_id = ?3`, reply/offline/failure placement), `mcp` via `toAgentMessage.parent_id`.
- Tests referencing the old field: `test/chat.test.ts`, `test/chat-agents.test.ts`, `test/mcp-chat-tools.test.ts`.

## Files to Create / Modify
- Create: `apps/crm/migrations/0031_lark_threads_groups.sql`
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES`)
- Modify: `apps/crm/src/worker/chat.ts`, `apps/crm/src/worker/chat-routes.ts`, `apps/crm/src/worker/chat-agents.ts`, `apps/crm/src/worker/index.ts` (task comment POST only), `apps/crm/src/worker/notify.ts` (kind union only)
- Modify tests: `apps/crm/test/chat.test.ts`, `apps/crm/test/chat-agents.test.ts`, `apps/crm/test/mcp-chat-tools.test.ts` (only assertions about the reply field)

## Tasks

### Task 1.1 — Migration 0031
- Target: `apps/crm/migrations/0031_lark_threads_groups.sql` (new). Content:

```sql
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
```

- In `reset-db.ts` `TABLES`, insert `'chat_thread_follower', 'chat_thread',` directly before `'chat_agent_member'` (children before `chat_message`).
- Verify: `pnpm --filter @abm/crm test -- inbox-schema.test.ts chat.test.ts` exits 0 (proves the migration applies in the test D1).

### Task 1.2 — Message model: quote reply
- Target: `apps/crm/src/worker/chat.ts`.
- Steps:
  1. `ChatMessageItem`: remove `parentMessageId`; add `replyToMessageId: string | null`, `replyTo: { id: string; authorName: string | null; snippet: string; deleted: boolean; threadRootId: string | null } | null`, `threadRootId: string | null`, `alsoInMain: boolean`. `snippet` is `renderMentionText(body)` cut to 120 characters, empty when deleted.
  2. `InsertMessageInput`: replace `parentMessageId` with `replyToMessageId?: string | null`. In `insertMessage`, the INSERT writes `reply_to_message_id` and its guard becomes `?6 IS NULL OR EXISTS (SELECT 1 FROM chat_message p WHERE p.id = ?6 AND p.conversation_id = ?2 AND p.deleted_at IS NULL)`. The not-inserted branch keeps today's messages; rename the field in the error to `replyToMessageId` and the text to `'Tin được trả lời không thuộc hội thoại này'`. Duplicate detection and the returned item use the new fields (`threadRootId: null`, `alsoInMain: false` until phase 02).
  3. `listMessages(db, conversationId, opts)`: main flow only — add `AND (m.thread_root_id IS NULL OR m.also_in_main = 1)`; add `opts.after?: string` (ascending, then the result is still returned newest-first like today, so callers do not change); select `m.reply_to_message_id, m.thread_root_id, m.also_in_main` and the quote preview with `LEFT JOIN chat_message q ON q.id = m.reply_to_message_id LEFT JOIN app_user qu ON qu.id = q.author_user_id LEFT JOIN chat_agent qa ON qa.id = q.author_agent_id` (`q.body`, `q.deleted_at`, `q.thread_root_id`, author name with the same fallbacks as the message author). Still one query plus the attachment query.
  4. New `messageContext(db, actor, messageId)`: load the message (`id, conversation_id, thread_root_id, also_in_main, created_at`); `loadConversation(db, actor, conversation_id)` or return null; anchor = the thread root when `thread_root_id` is set and `also_in_main = 0`, else the message itself; return `{ conversationId, messageId, threadRootId, messages }` where `messages` = `listMessages(..., { before: <anchor created_at + 1 ms ISO>, limit: 26 })` merged with `listMessages(..., { after: <anchor created_at>, limit: 25 })`, de-duplicated by id, newest first. Two message queries plus their attachment queries.
  5. Main-flow unread: in `listConversations`, `unreadTotal` and `agentVisibleConversations`, add `AND (um.thread_root_id IS NULL OR um.also_in_main = 1)` (alias `m` in `unreadTotal`). Keep everything else.
  6. `postTaskComment`: rename the input field to `replyToMessageId`.
  7. Agent message helpers (`AGENT_MESSAGE_SELECT`, `toAgentMessage`): select `m.reply_to_message_id` and `m.thread_root_id`; `parent_id` = `reply_to_message_id ?? thread_root_id` (Lark meaning: the message answered, or the thread root). Phase 05 adds the remaining MCP fields.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.3 — Routes and callers
- Target: `chat-routes.ts`, `index.ts`, `chat-agents.ts`, `notify.ts`.
- Steps:
  1. `chat-routes.ts` POST `/conversations/:id/messages`: read `replyToMessageId`; if absent, accept the old name `parentMessageId` as the same value (an open tab from the previous release still sends it). Same type check as today. Pass `replyToMessageId` to `insertMessage`.
  2. `index.ts` POST `/tasks/:id/comments`: same alias (`replyToMessageId ?? parentMessageId`).
  3. New route `GET /messages/:id/context` in `chat-routes.ts` → `messageContext`; 404 `notFound` when null.
  4. `chat-agents.ts`:
     - `ChatCompletionPayload`: replace `parentMessageId` with `replyToMessageId: string | null`.
     - Group or task turn: `replyToMessageId = message.id` (the agent's answer quotes the question). Direct agent chat: `null`.
     - History query: the last 20 main-flow messages — replace the `?3 …` condition with `(m.thread_root_id IS NULL OR m.also_in_main = 1)` and drop the third bind.
     - Reply, offline notice and failure notice: pass `replyToMessageId` from the payload. Read only `replyToMessageId`; a command queued by the previous release (with `parentMessageId`) lands unquoted, which is acceptable.
  5. `notify.ts`: add `'chat_thread'` to `NotificationKind`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0, and `Get-ChildItem apps/crm/src -Recurse -Include *.ts,*.tsx | Select-String 'parent_message_id'` prints nothing.

### Task 1.4 — Tests
- Target: `apps/crm/test/chat.test.ts` (extend; reuse its existing helpers and seed users `u-lan`, `u-long`, `u-huy`), and update `chat-agents.test.ts`, `mcp-chat-tools.test.ts` only where they asserted `parentMessageId`/`parent_id`.
- Steps — add tests:
  1. Quote reply: `u-lan` posts A in a group; `u-long` posts B with `replyToMessageId: A`; `GET messages` returns B with `replyToMessageId = A`, `replyTo.authorName = 'Đỗ Ngọc Lan'`, `replyTo.snippet` = A's text, and both A and B are in the list (B is not nested or hidden).
  2. Old field: posting with `parentMessageId: A` stores `reply_to_message_id = A`.
  3. Quoting a message of another conversation, or a recalled message → 422 `VALIDATION_FAILED`.
  4. Recalling A after B quoted it → B's `replyTo.deleted = true` and `snippet = ''`.
  5. Context: post 60 messages, then `GET /messages/<10th>/context` returns `conversationId`, `threadRootId: null`, and a window that contains the 10th message with up to 25 on each side; a user who is not a member gets 404.
  6. Schema: `PRAGMA table_info(chat_message)` lists `reply_to_message_id`, `thread_root_id`, `also_in_main`; `PRAGMA table_info(task)` lists the three `source_*` columns; inserting a `notification` row with `kind 'chat_thread'` succeeds.
  7. Data fix statement: insert a message row with `parent_message_id` set and `reply_to_message_id` NULL directly, run the migration's `UPDATE chat_message SET reply_to_message_id = parent_message_id WHERE parent_message_id IS NOT NULL`, and check the value (guards the statement text; the live count is checked in phase 10).
  8. `chat-agents.test.ts`: a group @mention turn queues a payload with `replyToMessageId` = the question id, and the stored agent reply has `reply_to_message_id` = the question id.
- Verify: `pnpm --filter @abm/crm test -- chat.test.ts chat-agents.test.ts mcp-chat-tools.test.ts` exits 0, then `pnpm --filter @abm/crm typecheck` and `pnpm --filter @abm/crm test` both exit 0.

## Success criteria
- Migration applies; existing tests green; quote replies stored and listed in the main flow with preview; context endpoint works; no code reads `parent_message_id`.

## Risk
- Rebuilding `notification` inside a migration that also alters other tables: the `PRAGMA defer_foreign_keys` and backup copy follow 0025, which already ran on production. Phase 10 compares the notification count before and after.
- Existing tests that counted messages may now see quote previews in responses: only update field-name assertions, never weaken behavior checks.

## Rollback
Opus only, from the snapshot diff: Opus restores the files changed by this run from the pre-run snapshot tree and deletes the new migration. Executors never run git commands that change the work tree or index. Nothing remote changes in this phase.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to Opus with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Wait for Opus's instruction before doing anything else.
