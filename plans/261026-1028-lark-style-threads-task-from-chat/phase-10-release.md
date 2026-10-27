---
phase: 10
title: "Release: D1 backup, remote migration, deploy, GoClaw prompt, live checks"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1, 2, 3, 4, 5, 6, 7, 8, 9]
---

# Phase 10: Release

## Goal
`abm-crm-eval` runs the new chat:
- migration 0031 is applied after a fresh export and a recorded Time Travel bookmark;
- the Worker is deployed;
- the GoClaw `crm-group-assistant` prompt uses the `[TASK]` block;
- all 15 acceptance criteria are checked live on two accounts, on a phone and on a desktop;
- the user gets a hand-back list.

Executor: **Opus** (remote actions). Steps marked **[user]** need the user to act or approve first.

## Rules
- Never print secret values. Back up before any remote schema change. Ask the user before restoring a bookmark or deleting data.
- Work from `D:\TQD\CRM\apps\crm` for `wrangler` commands.
- Commit only if the user asked for it (open question 1 in `plan.md`).

## Tasks

### Task 10.1 — Local gates
- Steps: from `D:\TQD\CRM`, run `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter @abm/crm build`.
- Verify: all three exit 0. The test log contains the lines `message_budget` and `cron_budget`, with `d1 <= 40`.

### Task 10.2 — Counts, backup and bookmark
- Steps:
  1. Run `npx wrangler d1 execute abm-crm-eval --remote --command "SELECT (SELECT COUNT(*) FROM chat_message) AS msgs, (SELECT COUNT(*) FROM chat_message WHERE parent_message_id IS NOT NULL) AS replies, (SELECT COUNT(*) FROM notification) AS notes, (SELECT COUNT(*) FROM task) AS tasks, (SELECT COUNT(*) FROM department) AS depts"`. Record the output in the deploy report.
  2. Run `npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-before-0031-20261026.sql`. Use the actual date in the file name.
  3. Run `npx wrangler d1 time-travel info abm-crm-eval` and record the bookmark.
- Verify: the export file exists and is larger than 0 bytes (`(Get-Item ../../exports/abm-crm-eval-before-0031-*.sql).Length -gt 0`), and the bookmark is recorded.

### Task 10.3 — Remote migration
- Steps: run `npx wrangler d1 migrations apply abm-crm-eval --remote`.
- Verify:
  1. `SELECT name FROM sqlite_master WHERE name IN ('chat_thread','chat_thread_follower','chat_message_thread','chat_conversation_department','chat_conversation_parent')` returns 5 rows.
  2. The counts query from 10.2 returns the same `msgs`, `notes`, `tasks` and `depts`.
  3. `SELECT COUNT(*) AS n FROM chat_message WHERE parent_message_id IS NOT NULL AND reply_to_message_id IS NOT parent_message_id` returns `0`. This proves acceptance criterion 14.
  4. `SELECT sql FROM sqlite_master WHERE name = 'notification'` contains `chat_thread`, and `SELECT COUNT(*) FROM sqlite_master WHERE name = 'notification_backup'` returns `0`.
  5. The `notification` row count equals the `notes` count from 10.2.

### Task 10.4 — Deploy
- Steps:
  1. Record the current version: `npx wrangler deployments list` (the expected previous version is `62d61a57`).
  2. Run `pnpm --filter @abm/crm deploy` and record the new version id.
  3. Right after the deploy, re-run the copy for replies written by the old Worker between 10.3 and 10.4: `npx wrangler d1 execute abm-crm-eval --remote --command "UPDATE chat_message SET reply_to_message_id = parent_message_id WHERE parent_message_id IS NOT NULL AND reply_to_message_id IS NULL"`.
  4. Check the department groups: `SELECT c.id, c.title, (SELECT COUNT(*) FROM chat_member m WHERE m.conversation_id = c.id) AS members FROM chat_conversation c WHERE c.id LIKE 'dept:%'`. There is one per active department, and the member counts match the active staff of each department. Record the output.
- Verify: `curl -s https://abm-crm-eval.ngulongyquan.workers.dev/api/health` prints `{"ok":true}`, and the query in step 3 of 10.3 still returns `0`.

### Task 10.5 — GoClaw group prompt **[user approves the config change]**
- Steps:
  1. Back up the GoClaw database with the same method as the earlier backups in `D:\Goclaw\backups\` (memory note `phase-06-poc-live-run.md`, and the plan 261025 phase 07 Task 7.5).
  2. Replace the `crm-group-assistant` system prompt with the section 7 text from `docs/integrations/goclaw-inbox-agents.md`, as updated in phase 09.
  3. Do not touch `crm-assistant`, which has the per-user MCP.
- Verify: in a test group, ask `@Trợ lý tóm tắt và đề xuất việc`. The reply carries a draft card made from a `[TASK]` block.

### Task 10.6 — Live checks **[user]**
- Steps: with the user's account and one staff account, on one Android/iPhone home-screen app and one desktop browser, check each item and record pass or fail in the deploy report:
  1. Quote reply: the quote block and @ prefill, the jump to an old message (> 50 messages back), a recalled original. (Criterion 1)
  2. Thread reply: the panel opens on the right on desktop and full screen on the phone, Back closes it, the card shows the count, time and initials, and the reply is not in the main flow. (Criterion 2)
  3. "Cũng gửi vào nhóm" shows the reply in both places. (Criterion 3)
  4. Follow, mute and unfollow; who gets a push and who does not; a mention in a thread. (Criterion 4)
  5. The unread badges and the Chuỗi tab. (Criterion 5)
  6. The department group exists. Admin moves a test user to another department, and the groups change at once; disabling and enabling a test user works the same way. (Criterion 6)
  7. A member creates a subgroup with a person from another department, and the tree shows it. (Criterion 7)
  8. The owner switches a test group to Chủ đề: new topic, topic list order, closing (a reply is refused), reopening, then switching back. (Criterion 8)
  9. "Tạo việc từ tin này" and "Tạo việc từ chuỗi" with Trợ lý online: the draft card, editing, a single create, the card posted back, and the notifications for the assignee and the members. Then stop the "ABM Zalo Bridge" scheduled task and repeat: the manual dialog opens. Restart the task afterwards. (Criterion 9)
  10. `@Trợ lý` inside a thread answers there. (Criterion 10)
  11. Task detail "Tạo từ chat" opens the thread or message, and a non-member sees text only. (Criterion 11)
  12. On this PC, Claude Code with a `read` MCP token: `read_messages` with and without `thread_id`, and `get_task` source. Revoke the token afterwards. (Criterion 12)
- Verify: every item passes. Any failure triggers the Failure Protocol.

### Task 10.7 — Records
- Steps:
  1. Write `plans/reports/deploy-261026-lark-style-threads.md` with the versions, the bookmark, the counts and the results of 10.6.
  2. Update the plan and phase status through the `ak plan` CLI (run `ak plan --help` first; do not edit status cells by hand).
  3. Update the memory note `internal-chat-in-crm-decision.md` with the release state and the 4 decisions.
  4. `docs/engineering/deployment-baseline.md` needs no change, because there is no new binding or secret. Confirm that and note it in the report.
- Verify: `Test-Path plans/reports/deploy-261026-lark-style-threads.md` prints `True`.

## Hand-back list for the user
- How to switch a group to Chủ đề, and who can do it.
- Department groups are automatic: fix membership by fixing the person's department in Admin. The sync removes anyone added by hand, and directors and Admins are not added automatically.
- Announce the new department groups to staff (the user sends this).
- "Tạo việc từ tin này" / "Tạo việc từ chuỗi", and what to do when Trợ lý is offline.
- The defaults the advisor chose for the open questions in `plan.md` (no all-company group, directors not auto-joined, topics by latest activity, members notified on every task, people keep their subgroups after leaving a department), so the user can change any of them.
- The user guide `docs/guides/chat-user-guide.md`, to share with staff.

## Rollback
- **Worker:** `npx wrangler rollback <previous version id>` (recorded in 10.4). The old Worker runs on the new schema. Thread replies made after the release then show as normal messages, and topics as plain messages.
- **Database:** migration 0031 only adds tables and columns, plus a one-way copy into `reply_to_message_id`; the notification table rebuild keeps every row. Restoring the Time Travel bookmark from 10.2 (`npx wrangler d1 time-travel restore abm-crm-eval --bookmark <id>`) discards every CRM write since then, so it is a last resort and needs the user's confirmation.
- **GoClaw:** restore the prompt from the 10.5 backup. The old one-line `[TASK: …]` format still parses.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to the user with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet,
- the rollback options above that apply.
Wait for the user's decision before doing anything else.
