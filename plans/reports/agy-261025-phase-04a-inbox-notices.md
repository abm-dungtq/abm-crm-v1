# Phase 04a Report — Inbox Notice Delivery in CRM Chat & Notifications (Tasks 4.1–4.4)

- **Status**: `DONE`
- **Plan**: `261025-1500-internal-chat-tasks-agents`
- **Phase**: `phase-04-inbox-notices-chat-agents.md` (Tasks 4.1, 4.2, 4.3, 4.4 ONLY)
- **Date**: 2026-10-26

---

## Summary

Completed Tasks 4.1 through 4.4 of Phase 04:
1. **Task 4.1 — Migration 0028**: Created [`apps/crm/migrations/0028_chat_agents.sql`](file:///D:/TQD/CRM/apps/crm/migrations/0028_chat_agents.sql) (`chat_agent` and `chat_agent_member`) byte-for-byte from the phase spec and registered `'chat_agent_member'` and `'chat_agent'` in [`apps/crm/test/helpers/reset-db.ts`](file:///D:/TQD/CRM/apps/crm/test/helpers/reset-db.ts).
2. **Task 4.2 — CRM Inbox Notice Delivery**: Created [`apps/crm/src/worker/inbox-notices.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox-notices.ts) exporting `ensureInboxConversation(db, organizationId)`, `postInboxNotice(sink, db, { organizationId, text, link?, dedupeKey?, ensuredOrgs? })`, and `notifyInboxUser(sink, { organizationId, userId, text, link?, dedupeKey? })`.
3. **Task 4.3 — Replace `send_lark` Enqueues**: Replaced every `kind: 'send_lark'` enqueue across the 8 inbox worker notice files while keeping all notice texts and dedupe keys unchanged.
4. **Task 4.4 — Update Inbox Tests**: Updated the Lark delivery assertions in the inbox test suites to verify `chat_message` rows in `sys:inbox:org-abm` (group notices) and `notification` rows with `kind = 'inbox'` (private notices).

---

## Notice Sites Replaced (Task 4.3)

| # | File | Function | Old Payload Type | New Call |
|---|---|---|---|---|
| 1 | [`apps/crm/src/worker/inbox/conversation-flow.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/conversation-flow.ts) | `handoff` (~line 389) | Group (`{ text }`) | `postInboxNotice(resolvedSink, db, { organizationId: conv.organization_id, text, link: \`/inbox/${conv.id}\`, ensuredOrgs })` |
| 2 | [`apps/crm/src/worker/inbox/conversation-flow.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/conversation-flow.ts) | `notifyGroupHelp` (~line 420) | Group (`{ text }`, `dedupeKey: 'group-help:' + commandId`) | `postInboxNotice(sinkOrDb(sink, db, env), db, { organizationId: conv.organization_id, text, link: \`/inbox/${conv.id}\`, ...(notice?.commandId ? { dedupeKey: \`group-help:${notice.commandId}\` } : {}), ensuredOrgs })` |
| 3 | [`apps/crm/src/worker/inbox/intake.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/intake.ts) | `classifyIntake` (~lines 516–531) | Private (`{ text, openId: assignee.larkOpenId }`) | `notifyInboxUser(resolvedSink, { organizationId: actor.organizationId, userId: assignee.id, text: parts.join(' – '), link })` |
| 4 | [`apps/crm/src/worker/inbox/assignment.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/assignment.ts) | `applyAssignment` (~lines 104–107) | Group (`{ text }`) + Private (`{ text, openId: assignee.larkOpenId }`) | `postInboxNotice(resolvedSink, db, { organizationId: conv.organization_id, text, link, ensuredOrgs })` and (when `!options?.skipPrivateNotice`) `notifyInboxUser(resolvedSink, { organizationId: conv.organization_id, userId: assignee.id, text, link })`; removed `lark_open_id` from `Assignee` queries |
| 5 | [`apps/crm/src/worker/inbox/scheduled.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/scheduled.ts) | `checkSla` (~line 50) | Group (`{ text }`, `dedupeKey: 'sla:' + conv.id + ':' + conv.sla_due_at`) | `postInboxNotice(resolvedSink, db, { organizationId: conv.organization_id, text, link: \`/inbox/${conv.id}\`, dedupeKey: \`sla:${conv.id}:${conv.sla_due_at}\`, ensuredOrgs })` |
| 6 | [`apps/crm/src/worker/inbox/group-summaries.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/group-summaries.ts) | `applyGroupSummaryResult` (~line 93) | Group (`{ text: header + '\n' + summary }`, `dedupeKey: 'summary-lark:' + command.id`) | `postInboxNotice(sinkOrDb(sink, db), db, { organizationId: row.organization_id, text: \`${header}\n${summary}\`, link: \`/inbox/${row.id}\`, dedupeKey: \`summary-lark:${command.id}\` })` |
| 7 | [`apps/crm/src/worker/inbox/ingest.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/ingest.ts) | `pauseFailedAccount` (~line 350) | Group (`{ text }`, `dedupeKey: 'account-error:' + accountId + ':' + now.slice(0, 13)`) | `postInboxNotice(sinkOrDb(sink, db), db, { organizationId: account.organization_id, text: \`Tài khoản ${account.display_name} lỗi kết nối, đã tạm dừng gửi\`, dedupeKey: \`account-error:${accountId}:${now.slice(0, 13)}\`, ensuredOrgs })` |
| 8 | [`apps/crm/src/worker/inbox/zalo-oa-oauth.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/zalo-oa-oauth.ts) | `recordZaloOaRefreshFailure` (~line 337) | Group (`{ text }`, `dedupeKey: 'zalo-oa-refresh:' + accountId + ':' + vietnamDate(now)`) | `postInboxNotice(sinkOrDb(sink, db), db, { organizationId: account.organization_id, text: \`Zalo OA ${account.display_name} không làm mới được token\`, dedupeKey: \`zalo-oa-refresh:${accountId}:${vietnamDate(now)}\`, ensuredOrgs })` |

Additionally, [`apps/crm/src/worker/inbox/bridge-routes.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/bridge-routes.ts) and [`apps/crm/src/worker/inbox/scheduled.ts`](file:///D:/TQD/CRM/apps/crm/src/worker/inbox/scheduled.ts) thread `sink` down to `ingestEvents`, `notifyGroupHelp`, `handOffSilentBot`, `applyGroupSummaryResult`, `applyCompletionResult`, `abandonStaleReplies`, `refreshZaloOaTokens`, and `checkSla`.

---

## Test Assertions Changed and Why (Task 4.4)

1. **[`apps/crm/test/inbox-flow.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-flow.test.ts)**:
   - In `'a reply with a handoff marker sends the text without the marker and notifies the Lark group'`, updated `outcome` expectation to `{ workerCommandQueued: false }` and asserted a system `chat_message` row in `sys:inbox:org-abm` with the handoff text and `meta_json: {"link":"/inbox/..."}` instead of `commands('send_lark')` + `fakeLark()`. Left the standalone `processWorkerCommands` test for `LARK_NOT_CONFIGURED` intact (direct `enqueueCommand` of `send_lark` stays until Phase 05).
2. **[`apps/crm/test/inbox-groups.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-groups.test.ts)**:
   - In `'the daily summary queues one run per group with member messages today and posts the answer to Lark'`, asserted a system `chat_message` row in `sys:inbox:org-abm` with `id = 'notice:summary-lark:' + claimed.id` and `body = expected`.
   - In `'an account error from the bridge pauses its sending and warns Lark once per hour'`, asserted a single system `chat_message` row in `sys:inbox:org-abm` matching `/^notice:account-error:ca-1:\d{4}-\d{2}-\d{2}T\d{2}$/` and verified deduplication on the second event.
3. **[`apps/crm/test/inbox-scheduled.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-scheduled.test.ts)**:
   - Changed `reminders()` helper to query `chat_message WHERE conversation_id = 'sys:inbox:org-abm' AND id LIKE 'notice:sla:%'`.
   - In `'a bot reply the bridge has not answered for 10 minutes is given up and people take over once'`, changed `handoffs()` helper to query `chat_message WHERE conversation_id = 'sys:inbox:org-abm' AND body LIKE 'Handoff:%'`.
4. **[`apps/crm/test/inbox-assignment.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-assignment.test.ts)**:
   - Asserted group assignment and handoff notices in `chat_message` (`conversation_id = 'sys:inbox:org-abm'`) and private assignee notices in `notification` (`user_id = 'u-lan' AND kind = 'inbox'`).
   - In `'Lark error 230013 stops retrying immediately and marks the user lark_link_status as error'` (which tests the `processWorkerCommands` `send_lark` executor that remains until Phase 05), enqueued the `send_lark` worker command directly instead of relying on `handoff()` to enqueue it.
5. **[`apps/crm/test/inbox-intake.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-intake.test.ts)**:
   - In `'classifying an intake assigns the conversation to the lead owner and queues one private Lark notice with the lead code'`, asserted the `notification` row for `u-lan` with `kind = 'inbox'`, `link = '/learners/' + contactId`, and `body` containing the lead code, contact name, product name, and learner URL.
6. **[`apps/crm/test/inbox-group-bot.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-group-bot.test.ts)**:
   - In `'a handoff marker in a group notifies Lark and stays in ai mode'` and `'a failed or stale group reply notifies Lark once and does not change mode'`, updated `outcome` expectation to `{ workerCommandQueued: false }` and asserted `chat_message` rows in `sys:inbox:org-abm` with `id = 'notice:group-help:' + commandId`.
7. **[`apps/crm/test/inbox-zalo-oa.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-zalo-oa.test.ts)**:
   - In `'a near-expiry credential is refreshed once, a stale version writes nothing, and a failure marks the account'`, asserted `chat_message` rows in `sys:inbox:org-abm` with `id` matching `/^notice:zalo-oa-refresh:ca-oa:\d{4}-\d{2}-\d{2}$/`.
   - In `'a registration confirmation with the wrong group link is not sent and hands off'` and `'a 199k payment keeps the registration rules...'`, asserted `outcome.workerCommandQueued` is `false` and checked `chat_message` in `sys:inbox:org-abm`.
8. **[`apps/crm/test/inbox-bridge.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-bridge.test.ts)**:
   - In `'a bot reply that fails its last attempt hands the conversation to people once'`, updated `handoffs()` to count `chat_message WHERE conversation_id = 'sys:inbox:org-abm' AND body LIKE 'Handoff:%'`.
9. **[`apps/crm/test/inbox-handoff-check.test.ts`](file:///D:/TQD/CRM/apps/crm/test/inbox-handoff-check.test.ts)** *(via `kongming` Failure Protocol counsel)*:
   - In `'when the bot hands off itself, its reason is kept and the check is logged as not applied'` (lines 139–140), replaced the `channel_command WHERE kind = 'send_lark'` count assertion with a `chat_message WHERE conversation_id = 'sys:inbox:org-abm'` assertion checking the single handoff notice text.

---

## Verification Results

| Step | Command | Exit Code | Key Output |
|---|---|---|---|
| Task 4.1 Verify | `pnpm --filter @abm/crm test -- chat.test.ts` | `0` | `Test Files 1 passed (1) \| Tests 13 passed (13)` |
| Task 4.2 Verify | `pnpm --filter @abm/crm typecheck` | `0` | `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit` |
| Task 4.3 Verify (1) | `Get-ChildItem apps/crm/src -Recurse -Filter *.ts \| Select-String "kind: 'send_lark'"` | `0` | *(empty output — 0 matches)* |
| Task 4.3 Verify (2) | `pnpm --filter @abm/crm typecheck` | `0` | `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit` |
| Task 4.4 Verify | `pnpm --filter @abm/crm test -- inbox` | `0` | `Test Files 17 passed (17) \| Tests 234 passed (234)` |
| Final Check (1) | `Get-ChildItem apps/crm/src -Recurse -Filter *.ts \| Select-String "kind: 'send_lark'"` | `0` | *(empty output — 0 matches)* |
| Final Check (2) | `pnpm -r typecheck` | `0` | All 7 workspace projects typechecked cleanly (`apps/crm typecheck: Done`) |
| Final Check (3) | `pnpm -r test` | `0` | `apps/crm`: `54 passed \| 1 skipped (55)`, `649 passed \| 2 skipped (651)`; all other workspace packages passed |

---

## Concerns / Blockers

- None. Tasks 4.5+ were intentionally not started per `brief-04a.md` scope boundaries.
