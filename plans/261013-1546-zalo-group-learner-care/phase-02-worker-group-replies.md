# Phase 2: Worker group reply rules, migration, API

Executor: Grok via Paseo. Supervisor: Opus. Read `plan.md` for the fixed decisions. Phase 1 must be done: `mentionsSelf`, `quotesSelf` and the `group_members` event exist in `@abm/contracts`.

## Context (verified file map)

- `apps/crm/src/worker/inbox/conversation-flow.ts`:
  - `ConversationRow` is at line 27; `loadConversation` at 45.
  - `botMayReply` (rule 1) is at 79–80 and allows `kind === 'direct'` only.
  - `scheduleCompletion` is at 87. It coalesces pending replies, uses dedupe `completion:${messageId}`, and adds `zaloUserId` for direct Zalo threads only.
  - `queueOutgoing` is at 125. Its send payload is `{ messageId, threadId, threadKind, text }`.
  - `handoff` is at 158; its Lark text is at about 177.
  - `handOffSilentBot` is at 187, `abandonStaleReplies` at 199, and `applyCompletionResult` at 247.
- `apps/crm/src/worker/inbox/ingest.ts`:
  - `ingestMessage` spans 87–126. A fromSelf message sets `mode='human'` at about 108–116.
  - A customer message calls `scheduleCompletion` at 125.
  - The `group_list` handler is at about 206.
- `apps/crm/src/worker/inbox/bridge-routes.ts`:
  - Lines 142–185 handle the command result.
  - A failed reply calls `handOffSilentBot` at 156.
  - `applyCompletionResult` is called at 178.
- `apps/crm/src/worker/inbox/inbox-routes.ts`:
  - Role gates are at 81–94: `INBOX_ROLES`, `adminOnly`, `settingsManager`.
  - `groupPatchInput` is at 493, `GROUP_SELECT` at 507, `GET /groups` at 520 and `PATCH /groups/:id` at 533.
- Migrations: `apps/crm/migrations/`. The latest is `0018_bridge_last_seen.sql`. `channel_command.kind` has a CHECK constraint, so do NOT add a new command kind.
- Tests:
  - `apps/crm/test/inbox-flow.test.ts`; its group case at 90–105 currently expects no reply and must change.
  - `inbox-bridge.test.ts` and `inbox-groups.test.ts`.
  - The helper `test/helpers/reset-db.ts` applies migrations.

## Files you may modify

- New `apps/crm/migrations/0019_zalo_group_bot.sql`
- `apps/crm/src/worker/inbox/conversation-flow.ts`
- `apps/crm/src/worker/inbox/ingest.ts`
- `apps/crm/src/worker/inbox/bridge-routes.ts`
- `apps/crm/src/worker/inbox/inbox-routes.ts`
- `apps/crm/src/worker/inbox/dispatcher.ts` and `apps/crm/src/worker/inbox/group-schedules.ts` (only the daily-cap count, Task 2.8.9)
- `apps/crm/test/inbox-*.test.ts` (existing), plus new `apps/crm/test/inbox-group-bot.test.ts`

## Tasks

### Task 2.1: Migration

- Target: `apps/crm/migrations/0019_zalo_group_bot.sql`, exactly:

```sql
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
```

- Verify: `pnpm -F @abm/crm test -- inbox-groups` exits 0. That proves the migrations apply.

### Task 2.2: Group gate and constants

- Target: `conversation-flow.ts`.
- Steps:
  1. Add `bot_reply_enabled`, `group_agent_key`, `bot_paused_until` to `ConversationRow` and the `loadConversation` SELECT. Also add the conversation's `display_name` if it is not already selected.
  2. Export `GROUP_AGENT_DEFAULT = 'cham-soc-hoc-vien'`, `GROUP_PAUSE_MS = 30 * 60_000`, and `BOT_CALL_RE = /(^|[^\p{L}])long\s+ơi(?![\p{L}])/iu`.
  3. Add `groupBotMayReply(conv, now: Date)`. It returns true when all of these hold:
     - `conv.kind === 'group'`
     - `conv.bot_reply_enabled === 1`
     - `conv.bot_enabled === 1`
     - `conv.bot_switch === 0`
     - `conv.bot_paused_until` is null or `<= now.toISOString()`
     It ignores `conv.mode` and `conv.agent_key`.
  4. Leave `botMayReply` exactly as it is for direct chats.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.3: Ingest rules for group messages

- Target: `ingest.ts`, `ingestMessage`, and the event dispatch that handles event types.
- Steps:
  1. Keep the direct-thread path byte-for-byte unchanged.
  2. **Group, fromSelf, not an echo:**
     - Store the message as today (`staff_phone`).
     - Set `bot_paused_until = now + GROUP_PAUSE_MS` and `last_message_at`. Do NOT set `mode='human'` and do NOT call `appendStaffContext`.
     - Cancel the group's pending replies: `UPDATE channel_command SET status='failed', result_json='{"error":"GROUP_STAFF_SPOKE"}', updated_at=? WHERE conversation_id=? AND kind='run_completion' AND status='pending' AND json_extract(payload_json,'$.purpose')='reply'`.
  3. **Group, not fromSelf:**
     - Store the message as today.
     - Upsert `zalo_group_member(conversation_id, sender id, senderName if non-blank, now)`.
     - Then:
       - If the sender is in `zalo_staff_member` for the conversation's `channel_account_id`, cancel pending group replies (same UPDATE) and stop.
       - Otherwise, if `event.mentionsSelf || event.quotesSelf || BOT_CALL_RE.test(event.text)`, call `scheduleGroupReply(db, conv.id, messageId, event, now)`.
       - Otherwise, only update `last_message_at` and `last_inbound_at`.
  4. Handle the new `group_members` event:
     - Find the conversation by `channel_account_id` and `external_thread_id`. Skip it if missing.
     - Upsert every member into `zalo_group_member`, with `updated_at = now`.
     - Use `db.batch` in chunks of 100 statements.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.4: Schedule a group reply

- Target: new exported `scheduleGroupReply` in `conversation-flow.ts`.
- Steps:
  1. Load the conversation. Return without queueing unless `groupBotMayReply(conv, now)` is true.
  2. Build the GoClaw text: `[Nhóm Zalo "${conv.display_name ?? 'không tên'}"] ${senderName || 'Một học viên'}: ${text || ATTACHMENT_ONLY_TEXT}`.
  3. Call `enqueueCommand` with:
     - `kind: 'run_completion'`, `target: 'bridge'`, the conversation and account ids as `scheduleCompletion` does;
     - `dedupeKey: completion:${messageId}`;
     - payload `{ agentKey: conv.group_agent_key ?? GROUP_AGENT_DEFAULT, userId: goclawUserId(conv), text, conversationId, purpose: 'reply', zaloUserId: senderExternalId, triggerMessageId: messageId, replyTo: { msgId: event.msgId, senderId: senderExternalId, senderName } }`.
  4. Do not coalesce.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.5: Apply a group completion

- Target: `applyCompletionResult` in `conversation-flow.ts`; caller at `bridge-routes.ts:178`.
- Steps:
  1. Add an optional last parameter `payload?: { triggerMessageId?: string; replyTo?: { msgId: string; senderId: string; senderName: string } }`. Pass `command.payload` from `bridge-routes.ts`.
  2. When `conv.kind === 'group'`:
     1. If `!groupBotMayReply(conv, new Date())`, keep the existing "cancelled system note" behaviour (use `BOT_OFF_REPLY_PREFIX`) and return.
     2. If a later message cancels the reply, store the text as a cancelled system note with `CANCELLED_REPLY_PREFIX`, send nothing, and return. A later message is one with `created_at` after the trigger message where either `sender_kind='staff_phone'`, or `sender_external_id` is in `zalo_staff_member` for the account.
     3. Otherwise, send the stripped text with `queueOutgoing`. Its send payload gets `replyTo` (add an optional `replyTo` field to `OutgoingMessage` and put it in the `send_zalo` payload only when present).
     4. If a HANDOFF marker exists, do NOT call `handoff`. Call new `notifyGroupHelp(db, env, conv, reason, triggerMessageId, origin)` instead. It queues a `send_lark` command, target `worker`, exactly like `handoff` does. The text is `Nhóm Zalo cần hỗ trợ: ${groupName} (${account}) – ${senderName} hỏi: "${question clipped to 300 chars}" – ${reason} – ${base}/inbox/${conv.id}`. It never changes `mode`.
  3. Direct conversations keep the current code path unchanged.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.6: Failed or stale replies in groups

- Target: `bridge-routes.ts:156` and `abandonStaleReplies`.
- Steps:
  - When the conversation is a group, call `notifyGroupHelp` with reason `BOT_SILENT_REASON` instead of `handOffSilentBot`. Load the kind with a small query.
  - Direct conversations are unchanged.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.7: Group API

- Target: `inbox-routes.ts`.
- Steps:
  1. Add `botReplyEnabled`, `agentKey` (`group_agent_key`) and `botPausedUntil` to `GROUP_SELECT`.
  2. Extend `groupPatchInput` with:
     - `botReplyEnabled?: boolean`, allowed for `settingsManager` roles (leader or admin);
     - `agentKey?: string | null`, 1–128 chars, admin only. `null` resets it to the default.
     Write an audit entry like the existing patch does.
  3. Add `GET /groups/:id/members`. It returns `[{ externalUserId, displayName, isStaff, updatedAt }]`, staff first, then by name. It is open to `INBOX_ROLES`.
  4. Add `PUT /groups/:id/members/:externalUserId/staff` with body `{ isStaff: boolean }`:
     - `settingsManager` only;
     - `true` upserts `zalo_staff_member` for the group's account (with `display_name` from `zalo_group_member`, `marked_by_user_id` = actor);
     - `false` deletes it;
     - write an audit entry;
     - return 404 when the group is not in the actor's organization.
- Verify: no verification needed (covered by Task 2.9).

### Task 2.8: Fixes from the plan review (all mandatory)

1. **Replace the phase-1 skip.** In `ingest.ts` `ingestEvents`, replace phase 1's `group_members` skip with a call to the Task 2.3 step 4 handler (`ingestGroupMembers`).
2. **Echo of a bot group reply.** The bridge sends `@${senderName} ${text}`. For a group reply with `replyTo` and a non-blank name, `queueOutgoing` must store the message `body` exactly as sent, `@${senderName} ${text}`. Otherwise the echo fallback in `ingest.ts` (about lines 57–79) cannot match the reply, stores it as `staff_phone`, and pauses the bot after every answer. Add a test: an echo without `commandId` of a bot group reply must not set `bot_paused_until`.
3. **Staff messages from the CRM web.** In `staffSend` (`conversation-flow.ts`, about line 292), when `conv.kind === 'group'`:
   - do not change `mode`, `assignee` or `appendStaffContext`;
   - set `bot_paused_until = now + GROUP_PAUSE_MS`;
   - cancel pending group replies (same UPDATE as in Task 2.3).
   In Task 2.5 step 2.2, a later staff message is `sender_kind IN ('staff_phone','staff_web')` or a sender in `zalo_staff_member`.
4. **Group branch first.** In `applyCompletionResult`, test `conv.kind === 'group'` BEFORE the existing `botMayReply` check, so that check never rejects a group.
5. **Unicode.** Test the "Long ơi" pattern with `BOT_CALL_RE.test(text.normalize('NFC'))`. Add a test with decomposed input: `'Long ới'` is not a match, `'Long ơi'.normalize('NFD')` is a match.
6. **Failure paths carry the payload.** `abandonStaleReplies` must also SELECT `payload_json` and pass `triggerMessageId` and `replyTo` to `notifyGroupHelp`. The same applies at `bridge-routes.ts:156`. `notifyGroupHelp` enqueues with `dedupeKey: group-help:${commandId}`, so each failed reply sends at most one Lark notice.
7. **PATCH validation.** `groupPatchInput` at `inbox-routes.ts` (about line 496) has a refine that accepts only `summaryEnabled` or `scheduledOptOut`. Extend it so that `botReplyEnabled` or `agentKey` alone is accepted.
   - Do role checks inside the handler: `botReplyEnabled` requires `SETTINGS_ROLES` (leader, admin), `agentKey` requires admin, and `summaryEnabled` keeps its current rule.
   - In `presentGroup` (or the row mapper), convert `botReplyEnabled` to a boolean.
   - Include the new fields in the audit before/after.
8. **Staff mark only for members.** `PUT /groups/:id/members/:externalUserId/staff` returns 404 unless that user has a `zalo_group_member` row for this group.
9. **Daily send cap.** The user decided there is no message limit in groups. In the daily cap count (`dispatcher.ts` about line 182; check `group-schedules.ts` about line 182 too), exclude `send_zalo` commands whose message is a bot reply in a group conversation (`message.sender_kind = 'bot'` joined to `conversation.kind = 'group'`). Bot group replies must not use up the account's `daily_send_cap` or block scheduled posts. Add a test.
10. **Reset existing groups.** In migration 0019, add `UPDATE conversation SET mode = 'ai', staff_context_pending = NULL WHERE kind = 'group';`, so groups that the old code flipped to `human` start clean.
11. **Accepted race.** A cancel affects only `pending` commands. A `send_zalo` already inside the bridge's 3–8 s send delay still goes out after a staff message. This is accepted; do not add code for it.

- Verify: no verification needed (covered by Task 2.9).

### Task 2.9: Tests

- Steps:
  1. Change the group case in `inbox-flow.test.ts` (around 90–105). A plain group message must still queue nothing.
  2. In the new `apps/crm/test/inbox-group-bot.test.ts`, cover:
     - (a) a group with the bot off: a mention queues nothing;
     - (b) the bot on: `mentionsSelf`, `quotesSelf` and "Long ơi …" each queue exactly one `run_completion` with `agentKey` `cham-soc-hoc-vien`, `replyTo` and the prefixed text;
     - (c) "long lanh" and a plain message queue nothing;
     - (d) a staff member's message queues nothing and cancels a pending reply;
     - (e) a fromSelf non-echo message sets `bot_paused_until`, keeps `mode='ai'`, and a mention during the pause queues nothing;
     - (f) a completion result sends a `send_zalo` with `replyTo` and `threadKind 'group'`;
     - (g) a staff message after the trigger drops the reply as a cancelled note;
     - (h) a HANDOFF marker queues a `send_lark` containing "Nhóm Zalo cần hỗ trợ" and keeps `mode='ai'`;
     - (i) `group_members` events upsert members;
     - (j) the PATCH and PUT routes enforce roles, and GET lists `isStaff`;
     - (k) the direct flow tests still pass unchanged.
- Verify:
  - `pnpm -F @abm/crm test` exits 0, with all tests passed apart from the pre-existing skipped ones.
  - `pnpm -F @abm/crm typecheck` exits 0.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Write the failure into your report and end with `Status: BLOCKED`, including:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.

The supervisor (Opus, controller session) replaces `kongming` for this project. It reads the report and sends guidance; then re-run the Verify step. Never continue by self-reasoning.

## Report

Write `plans/reports/grok-261013-zalo-group-worker.md`. Include the changes per file, the test and typecheck summary, and anything you could not do.
