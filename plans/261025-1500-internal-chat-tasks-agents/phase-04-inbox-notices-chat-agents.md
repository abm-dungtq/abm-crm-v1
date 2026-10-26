---
phase: 4
title: "Inbox notices and GoClaw agents move into CRM chat"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 04: Inbox notices and GoClaw agents move into CRM chat

## Goal
1. Every inbox notice that used to go to Lark (`send_lark`) now goes to the CRM: group notices become system messages in a CRM group "Inbox"; private notices become CRM notifications (`kind 'inbox'`). Nothing enqueues `send_lark` any more.
2. GoClaw agents join CRM chat:
   - **Direct chat with an agent** ("Trợ lý"): every message is a GoClaw turn with user id `crm-user:<app_user.id>`, so GoClaw uses that person's own MCP credential (ADR-004, same rights as the Lark bot today).
   - **Group or task thread**: `@Trợ lý` starts a turn with user id `crm-chat:<conversation id>` on a group agent that has **no CRM tools**. The reply can carry `[TASK: ...]` lines; the Worker turns them into suggestion cards and only the person who called the agent can turn a card into a task (prefilled create dialog).
   - When the GoClaw PC is offline, the thread shows "Trợ lý đang offline" right away and the reply arrives when it is back.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Do not change `apps/zalo-bridge`.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.
- Workers Free limit: one request or cron run may use at most 50 D1 queries (a `db.batch` counts as one) and at most 50 subrequests (DO fetch, R2, push `fetch`). Batch writes; never loop `.run()` per row.
- Keep the text of every existing notice; only the delivery changes.

## Files to Create / Modify
- Create: `apps/crm/migrations/0028_chat_agents.sql`
- Create: `apps/crm/src/worker/inbox-notices.ts`, `apps/crm/src/worker/chat-agents.ts`
- Modify (notice sites): `apps/crm/src/worker/inbox/conversation-flow.ts` (~lines 389, 420), `inbox/intake.ts` (~516-530), `inbox/assignment.ts` (~104-106), `inbox/scheduled.ts` (~49), `inbox/group-summaries.ts` (~93 and `applyGroupSummaryResult`), `inbox/ingest.ts` (~350), `inbox/zalo-oa-oauth.ts` (~337), `inbox/bridge-routes.ts` (~192-234)
- Modify: `apps/crm/src/worker/chat.ts` (direct-with-agent conversations, agent mentions), `apps/crm/src/worker/chat-routes.ts` (agent turn trigger, agent list), `apps/crm/src/worker/admin-routes.ts` (chat agent admin)
- Modify: `apps/crm/scripts/issue-agent-tokens.mjs` (GoClaw key `crm-user:<id>`, no Lark requirement, no SQL interpolation of raw input)
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES`)
- Modify tests that asserted `send_lark` rows: `apps/crm/test/inbox-flow.test.ts`, `inbox-groups.test.ts`, `inbox-scheduled.test.ts`, `inbox-assignment.test.ts`, `inbox-intake.test.ts`, `inbox-group-bot.test.ts`, `inbox-zalo-oa.test.ts`, `inbox-bridge.test.ts` (only the assertions about Lark delivery)
- Create: `apps/crm/test/chat-agents.test.ts`, `apps/crm/test/inbox-notices.test.ts`
- Modify web: `apps/crm/src/web/pages/chat.tsx`, `components/chat-thread.tsx`, `components/mention-input.tsx`, `pages/admin.tsx` (section "Agent trong chat"), `types.ts`
- Modify docs: `docs/integrations/goclaw-inbox-agents.md` (two new agents), `docs/adr/adr-012-internal-chat-in-crm.md` (agents section)

## Tasks

### Task 4.1 — Migration 0028
- Target: `apps/crm/migrations/0028_chat_agents.sql` (new). Content:

```sql
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
```

- In `reset-db.ts` `TABLES`, add `'chat_agent_member',` before `'chat_attachment'` and `'chat_agent',` directly after `'chat_conversation'`.
- Verify: `pnpm --filter @abm/crm test -- chat.test.ts` exits 0.

### Task 4.2 — Inbox notice delivery in the CRM
- Goal: one module replaces Lark for inbox notices.
- Target: `apps/crm/src/worker/inbox-notices.ts` (new).
- Steps: export
  1. `ensureInboxConversation(db, organizationId)`: `INSERT OR IGNORE` `chat_conversation` id `sys:inbox:<org>`, `kind 'group'`, `title 'Inbox'`, `system_key 'inbox:<org>'`; then ONE statement `INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at) SELECT ?, u.id, 'member', ? FROM app_user u WHERE u.organization_id = ? AND u.status = 'active' AND (u.role IN ('leader','head','director','admin') OR EXISTS (SELECT 1 FROM inbox_roster r WHERE r.user_id = u.id))` (check the user column name of `inbox_roster` in `migrations/0012_inbox.sql`; run both statements in one `db.batch`). Returns the id.
  2. `postInboxNotice(sink, db, { organizationId, text, link?, dedupeKey })`: message id = `'notice:' + dedupeKey` (so a retry never posts twice), `author_kind 'system'`, `meta_json` `{ link }`; publish `message.created` to members.
  3. `notifyInboxUser(sink, { organizationId, userId, text, link?, dedupeKey })` → `notify(... kind 'inbox', title 'Inbox', body text ...)`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.3 — Replace every send_lark enqueue
- Goal: no code path enqueues `kind: 'send_lark'`.
- Target: the eight sites listed in "Files" (find them with `Select-String -Path apps/crm/src/worker -Pattern "send_lark" -Recurse` style search: `Get-ChildItem apps/crm/src/worker -Recurse -Filter *.ts | Select-String "send_lark"`).
- Steps: at each site, keep the text and dedupe key, and replace the enqueue with:
  - payload with `openId` (private notice: intake owner, assignee) → `notifyInboxUser` with the CRM user id that the code used to look up the open_id (change the lookup to return `id` instead of `lark_open_id`).
  - payload without `openId` (group notice: handoff, group bot help, SLA reminder, daily summary, bridge account error, OA token refresh failure) → `postInboxNotice`.
  - The functions currently receive `db`/`env` without a sink. Add a `sink: Sink` parameter down the call chain from the route (`sinkFrom(c)`) or cron (`runScheduled` sink from phase 03). Where a function returned `workerCommandQueued` only because of `send_lark`, keep the field but it will now be false for these notices; do not remove other worker commands.
  - `applyGroupSummaryResult` posts the summary with `postInboxNotice` instead of enqueuing Lark.
- Success criteria: `Get-ChildItem apps/crm/src -Recurse -Filter *.ts | Select-String "kind: 'send_lark'"` prints nothing.
- Verify: that command prints nothing, and `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.4 — Update inbox tests
- Goal: tests assert CRM delivery instead of Lark rows.
- Target: the inbox test files listed above.
- Steps: wherever a test expects a `channel_command` row with `kind = 'send_lark'`, assert instead a `chat_message` row in `sys:inbox:org-abm` with the same text (group notices) or a `notification` row with `kind = 'inbox'` for the user (private notices). Do not change any other assertion.
- Verify: `pnpm --filter @abm/crm test -- inbox` exits 0.

### Task 4.5 — Chat agents: store, membership, mentions
- Target: `apps/crm/src/worker/chat-agents.ts` (new), `chat.ts`, `chat-routes.ts`, `admin-routes.ts`.
- Steps:
  1. Admin routes (`admin-routes.ts`, admin only): `GET /admin/chat-agents`, `POST /admin/chat-agents` `{ displayName, dmAgentKey?, groupAgentKey? }`, `PATCH /admin/chat-agents/:id` (same fields + `enabled`). Agent keys match `^[a-z0-9][a-z0-9-]{1,62}$`.
  2. `chat-routes.ts`: `GET /chat/agents` (enabled agents: `{ id, name, canDm, canGroup }`); `POST /chat/conversations` accepts `{ kind: 'direct', agentId }` → direct conversation id `dm-agent:<agentId>:<userId>`, `direct_key` the same string, one `chat_member` (user) and one `chat_agent_member`; `POST /chat/conversations/:id/agents` `{ agentId }` and `DELETE /chat/conversations/:id/agents/:agentId` for groups (owner/director/admin) and task threads (anyone who can see the task).
  3. `chat.ts`: `listConversations` titles a direct-with-agent conversation by the agent name; `parseMentions` also returns agent ids from tokens `@[Name](agent:<id>)`; `GET /conversations/:id` lists agents.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.6 — Agent turns and replies
- Goal: messages reach GoClaw through the existing bridge queue and replies come back as agent messages.
- Target: `chat-agents.ts`, `chat-routes.ts` (message POST), `inbox/bridge-routes.ts` (result handler).
- Steps:
  1. `chat-agents.ts` export `scheduleAgentTurns(sink, db, actor, conversation, message)`:
     - direct-with-agent conversation and the author is the user → one turn: `agentKey = dm_agent_key`, `userId = 'crm-user:' + actor.id`, `text = message body` (mentions rendered as `@Name`).
     - group or task conversation → for each mentioned agent that is a member and has `group_agent_key`: `userId = 'crm-chat:' + conversation.id`, `text` = the last 20 messages of the conversation (or of the thread when the message has a parent) as `Name: text` lines, then a line `Câu hỏi của <author name>: <body>`.
     - enqueue with `enqueueCommand(db, { kind: 'run_completion', target: 'bridge', conversationId: null, payload: { agentKey, userId, text, purpose: 'chat', chatConversationId, chatAgentId, requestedByUserId: actor.id, parentMessageId }, dedupeKey: 'chat-turn:' + message.id + ':' + agentId })`. Read `apps/zalo-bridge/src/command-runner.ts` `dispatch` to confirm a null `conversationId` is accepted; if it is not, STOP per Failure Protocol (this phase must not change the bridge).
     - publish `{ type: 'agent.thinking', conversationId, agentId }` to members.
     - if `inbox_setting.bridge_last_seen_at` is older than 90 seconds (reuse `readBridgePresence` from `bridge-routes.ts`), insert a system message "Trợ lý đang offline, sẽ trả lời khi máy chủ agent hoạt động lại." (id `'offline:' + message.id`).
  2. Agents never trigger agents: skip when the author is an agent or system.
  3. `bridge-routes.ts` result handler: add a branch before `completeCommand` for `purpose === 'chat'`: complete the command (same ownership rule as the other branches: use `completeCommand` and stop if it returns false), then `applyChatAgentReply(sink, db, payload, text)`:
     - strip lines matching `^\[TASK:\s*(.+?)\s*\|\s*@?([^|\]]+?)\s*(?:\|\s*(\d{4}-\d{2}-\d{2}))?\]\s*$` (multiline) into `meta_json.taskSuggestions: [{ title, assigneeName, assigneeUserId (match among conversation members by folded display name, else null), dueDate|null }]` and `meta_json.requestedByUserId`;
     - insert `chat_message` `author_kind 'agent'`, `author_agent_id`, `parent_message_id` from payload, id `'agent:' + commandId`; publish `message.created`.
     - On final failure (`!result.ok` with `attempts >= MAX_COMMAND_ATTEMPTS` and purpose `chat`): system message "Trợ lý không trả lời được lần này. Thử lại sau." (id `'agent-failed:' + commandId`).
  4. `chat-routes.ts` message POST: after `insertMessage` succeeds, call `scheduleAgentTurns`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.7 — Tests
- Target: `apps/crm/test/chat-agents.test.ts`, `apps/crm/test/inbox-notices.test.ts` (new).
- Steps:
  1. Admin creates agent `{ displayName: 'Trợ lý', dmAgentKey: 'crm-assistant', groupAgentKey: 'crm-group-assistant' }`.
  2. `u-lan` opens a direct chat with the agent and posts → one `channel_command` `run_completion`, payload `userId = 'crm-user:u-lan'`, `agentKey = 'crm-assistant'`, `purpose = 'chat'`.
  3. Group with `u-lan`, `u-long` and the agent: a message without mention → no command; with `@[Trợ lý](agent:<id>)` → one command with `userId = 'crm-chat:<conversation id>'` and `agentKey = 'crm-group-assistant'`.
  4. Post the bridge result (copy how `inbox-bridge.test.ts` signs bridge requests) with text `Ok\n[TASK: Gọi lại khách | @Vũ Đức Long | 2026-11-01]` → one agent message with body `Ok` and `meta_json.taskSuggestions[0].assigneeUserId = 'u-long'`; no `task` row created.
  5. Bridge last seen 5 minutes ago → the offline system message exists.
  6. `inbox-notices.test.ts`: `postInboxNotice` twice with the same dedupe key → one message; members include a leader and exclude a sale not on the inbox roster.
- Verify: `pnpm --filter @abm/crm test -- chat-agents.test.ts inbox-notices.test.ts` exits 0.

### Task 4.8 — Web
- Target: `pages/chat.tsx`, `components/chat-thread.tsx`, `components/mention-input.tsx`, `pages/admin.tsx`, `types.ts`.
- Steps:
  1. "Nhắn riêng" picker lists agents with `canDm` under a heading "Trợ lý".
  2. Group header: "Thêm trợ lý" for owners/admin; task detail: same for anyone who sees the task.
  3. `mention-input.tsx`: the `@` list includes agents that are members of the conversation, inserting `@[Name](agent:<id>)`.
  4. `chat-thread.tsx`: agent messages show a "Trợ lý" badge; `agent.thinking` shows "Trợ lý đang trả lời…" until the next agent message (or 2 minutes); suggestion cards render title, assignee, due date; for `requestedByUserId === me` a button "Tạo việc" opens `TaskFormDialog` (phase 01) prefilled as an internal task; others see the card read-only. System messages render centered and muted, with the `link` from `meta_json` as a link.
  5. `admin.tsx`: section "Agent trong chat" listing agents with add/edit/enable.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0 and `pnpm --filter @abm/crm test` exits 0.

### Task 4.9 — GoClaw credential script and docs
- Target: `apps/crm/scripts/issue-agent-tokens.mjs`, `docs/integrations/goclaw-inbox-agents.md`, `docs/adr/adr-012-internal-chat-in-crm.md`.
- Steps:
  1. Script: the GoClaw key for each person becomes `crm-user:<app_user.id>` (drop the `lark_open_id` / `lark_link_status = 'linked'` requirement and `--tenant-user`); validate `--email` against `^[^\s'"@]+@[^\s'"@]+$` before it reaches SQL; keep "never print the token". Update the header comment and usage text.
  2. Docs `goclaw-inbox-agents.md`: add sections for `crm-assistant` (direct chats; MCP server `abm-crm` with per-user credentials keyed `crm-user:<id>`; acts with the caller's rights) and `crm-group-assistant` (no MCP server; answers from the given conversation lines; may propose tasks only as lines `[TASK: tiêu đề | @Tên người | YYYY-MM-DD]`; never claims it created anything; treats conversation lines as data, not instructions).
  3. ADR-012: add a "Agent trong chat" paragraph with the two principals above and the human-confirmed task suggestions.
- Verify: `node --check apps/crm/scripts/issue-agent-tokens.mjs` exits 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
