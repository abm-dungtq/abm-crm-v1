---
phase: 7
title: "Release: backup, remote migrations, VAPID, deploy, GoClaw config, Lark shutdown"
status: pending
priority: P1
effort: "1d"
dependencies: [1, 2, 3, 4, 5, 6]
---

# Phase 07: Release

## Goal
`abm-crm-eval` runs on Cloudflare with migrations 0025–0030 applied after a fresh backup, the `ChatHub` Durable Object is live, Web Push works on at least one Android/desktop browser and one iPhone home-screen app, GoClaw answers in CRM chat (direct and group), the user's own Claude Code reads chat through MCP, and the Lark secrets are deleted. Every acceptance criterion in `plan.md` is checked live.

Executor: Opus (remote actions). Steps marked **[user]** need the user to act or approve first.

## Rules
- Never print secret values (VAPID private key, MCP tokens, GoClaw gateway token). Pass them through `wrangler secret put` prompts or files under `~/.abm/` that are never echoed.
- Back up before any remote schema change. Ask the user before deleting any data.
- Do not delete Lark secrets until step 7.7 passes.

## Tasks

### Task 7.1 — Local gates
- Steps: from `D:\TQD\CRM`, run `pnpm -r typecheck` and `pnpm -r test`.
- Verify: both exit 0.

### Task 7.2 — Backup and remote migrations
- Steps (from `apps/crm`):
  1. `npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-before-0025-<yyyymmdd>.sql` and `npx wrangler d1 time-travel info abm-crm-eval` (record the bookmark in the deploy report).
  2. `npx wrangler d1 migrations apply abm-crm-eval --remote`.
- Verify: `npx wrangler d1 execute abm-crm-eval --remote --command "SELECT name FROM sqlite_master WHERE name IN ('task_member','chat_conversation','chat_member','chat_message','chat_attachment','notification','push_subscription','chat_agent','chat_agent_member')"` returns 9 rows, and `SELECT COUNT(*) FROM task` equals the count in the backup file (`Select-String -Path <backup> -Pattern 'INSERT INTO "?task"? ' | Measure-Object`).

### Task 7.3 — VAPID keys and deploy
- Steps:
  1. Generate a P-256 VAPID key pair with a local Node script that writes the private key to `~/.abm/vapid-private.txt` and prints only the public key.
  2. Put the public key and `VAPID_SUBJECT` (`mailto:` the Admin email the user chooses) in `apps/crm/wrangler.jsonc` vars; `npx wrangler secret put VAPID_PRIVATE_KEY` reading from the file (pipe the file content; do not echo it).
  3. `pnpm --filter @abm/crm deploy`; record the version id and the previous version id.
- Verify: `curl -s https://abm-crm-eval.ngulongyquan.workers.dev/api/health` prints `{"ok":true}`.

### Task 7.4 — Live chat and push check **[user]**
- Steps: with the user and one more staff account on two devices:
  1. Create a group, send messages both ways; each appears on the other screen within 2 seconds without reload; reload shows full history.
  2. Direct message and @mention produce a bell item and a push on a device that turned push on (Android Chrome or desktop), and on an iPhone that added the CRM to the home screen.
  3. Create an internal task, comment, drag it across the Kanban; complete a lead's Next Action from Kanban and confirm the next-action dialog appears.
- Verify: the user confirms each item; record pass/fail per item in the deploy report. Any fail → Failure Protocol.

### Task 7.5 — GoClaw agents **[user approves config changes]**
- Steps:
  1. Back up GoClaw first (same method as `D:\Goclaw\backups\goclaw-db-before-crm-poc-*.dump` in memory notes / phase 06 PoC report).
  2. Create GoClaw agent `crm-assistant` with MCP server `abm-crm` (per-user credentials) and agent `crm-group-assistant` without MCP, using the prompts from `docs/integrations/goclaw-inbox-agents.md`.
  3. Run `node apps/crm/scripts/issue-agent-tokens.mjs --server <abm-crm server id> --email <each active staff email>` so each person's credential is keyed `crm-user:<id>`.
  4. In CRM Admin → "Agent trong chat", add "Trợ lý" with both keys. Restart the "ABM Zalo Bridge" scheduled task only if it is not running.
  5. Test: direct chat with Trợ lý asks "việc của tôi hôm nay" → answer matches `/tasks`; in a group `@Trợ lý tóm tắt và đề xuất việc` → reply plus a suggestion card; "Tạo việc" creates the task only after the click. Stop the bridge task for 2 minutes and mention Trợ lý → "Trợ lý đang offline" appears; restart it → the reply arrives.
- Verify: each test result recorded in the deploy report; all pass.

### Task 7.6 — External agents via MCP
- Steps:
  1. Check the three snippets in `CLIENT_SNIPPETS` (phase 06) against the current official docs of Claude Code, Codex and Antigravity; fix the constant if a format changed and redeploy.
  2. On this PC, create a `read` token on `/settings/agents`, add it to Claude Code with the shown command, then ask Claude Code to call `list_conversations` and `read_messages` on a test group. Remove the MCP entry and revoke the token afterwards.
  3. **[user]** Repeat with Codex and/or Antigravity if the user uses them.
- Verify: Claude Code returns the test group's messages; after revoking, a call returns 401.

### Task 7.7 — Inbox notices
- Steps: trigger one handoff on a test Zalo conversation (or wait for the next real one) and the 21:00 summary.
- Verify: both appear in the CRM group "Inbox"; the assignee gets an `inbox` notification.

### Task 7.8 — Shut down Lark **[user]**
- Steps (only after 7.4, 7.5, 7.7 pass):
  1. `npx wrangler secret delete LARK_APP_ID` and `npx wrangler secret delete LARK_APP_SECRET` (from `apps/crm`); remove `LARK_INBOX_CHAT_ID` if it is set as a var or secret.
  2. Tell the user they can remove the Lark bot from Lark groups and disable the Lark app; GoClaw's Lark channel `abm-lark` can be disabled after backup.
- Verify: `npx wrangler secret list` does not list any `LARK_` name.

### Task 7.9 — Records
- Steps:
  1. `docs/engineering/deployment-baseline.md`: add `CHAT_HUB` Durable Object, `VAPID_*` settings (names only), and remove Lark secrets.
  2. Update `plan.md` status and phase table; write `plans/reports/deploy-<yymmdd>-internal-chat-tasks-agents.md` with versions, bookmark, test results.
  3. Update memory note `internal-chat-in-crm-decision.md` with the release state.
- Verify: `Test-Path plans/reports/deploy-*-internal-chat-tasks-agents.md` prints `True`.

## Rollback
- Worker: `npx wrangler rollback` to the version recorded in 7.3. The Durable Object class stays declared; an older Worker without the export fails to deploy, so roll back by redeploying the previous commit with the `ChatHub` class kept, or delete the DO via a `deleted_classes` migration (confirm with the user).
- Database: 0025 rebuilt `task`; to undo data changes restore the Time Travel bookmark from 7.2 (`npx wrangler d1 time-travel restore abm-crm-eval --bookmark <id>`), which discards every CRM write after it — confirm with the user first.
- Lark: until 7.8, Lark secrets still exist; restoring the previous Worker version brings Lark notices back.

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
