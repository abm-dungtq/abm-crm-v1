---
phase: 5
title: "Remove Lark"
status: pending
priority: P2
effort: "1d"
dependencies: [4]
---

# Phase 05: Remove Lark

## Goal
The CRM no longer talks to Lark. Approval requests reach Leaders only through CRM notifications (phase 03). The Lark client, the Lark link screen, the Lark secrets in code, and `send_lark` handling are deleted. DB columns `app_user.lark_*` stay (nullable, unused) so no table rebuild is needed; pending `send_lark` commands are closed by a migration.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Do not drop DB columns.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.

## Files to Create / Modify / Delete
- Create: `apps/crm/migrations/0029_remove_lark_commands.sql`
- Delete: `apps/crm/src/worker/lark.ts`, `apps/crm/test/lark-link.test.ts`
- Modify: `apps/crm/src/worker/approval-notify.ts` (drop the Lark DM; keep `approvalNeedsLeaderDm` renamed `approvalNeedsLeader`, `activeLeaders`, `notifyCommitted`)
- Modify: `apps/crm/src/worker/admin-routes.ts` (remove `/lark/link` and `/outbox/:id/resend`), `apps/crm/src/worker/queries.ts` (~546 drop `larkLinkStatus`, `larkCheckedAt`), `apps/crm/src/worker/inbox/worker-commands.ts` (remove `runLarkCommand` and its dispatch), `apps/crm/src/worker/env.ts` (remove `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_INBOX_CHAT_ID`), `apps/crm/src/worker/inbox/scheduled.ts` (`ScheduledEnv` type), `apps/crm/src/worker/mcp-tools.ts` (~234 reply text), `apps/crm/src/worker/index.ts` (imports only)
- Modify: `packages/contracts/src/index.ts` (remove `'send_lark'` from `COMMAND_KINDS`, remove `larkLinkInput`)
- Modify: `apps/crm/src/web/pages/admin-users.tsx` (remove Lark buttons/labels), `apps/crm/src/web/types.ts` (remove `LarkLinkStatus`, `LarkLinkResult`), any web page that shows outbox Lark status (find with search below)
- Modify: `apps/crm/test/approval-notify.test.ts` (assert CRM notifications instead of Lark DMs), any other test that still imports `lark`
- Modify docs: `docs/guides/lark-crm-e2e-test.md` (add a top line "Không còn dùng từ 2026-10-25, xem ADR-012."), `docs/adr/adr-004-chat-actor-identity.md` (add "Cập nhật 2026-10-25: kênh Lark bỏ; bot nhân viên chạy trong chat CRM, khóa GoClaw `crm-user:<id>` (ADR-012)."), `docs/README.md` (mark the Lark test guide obsolete)

## Tasks

### Task 5.1 — Migration 0029
- Target: `apps/crm/migrations/0029_remove_lark_commands.sql` (new). Content:

```sql
-- Lark is no longer used (ADR-012). Close any Lark notice still queued; the kind stays in the CHECK so old
-- rows remain valid. app_user.lark_* columns are kept, unused, to avoid rebuilding app_user.
UPDATE channel_command SET status = 'failed', result_json = '{"error":"LARK_REMOVED"}',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE kind = 'send_lark' AND status IN ('pending', 'claimed');
UPDATE outbox SET status = 'skipped', last_error = 'LARK_REMOVED'
WHERE event_type = 'approval.requested' AND status IN ('pending', 'sending', 'failed');
```

- Verify: `pnpm --filter @abm/crm test -- inbox-dispatcher.test.ts` exits 0.

### Task 5.2 — Delete Lark code
- Steps:
  1. Delete `lark.ts` and `test/lark-link.test.ts`.
  2. `approval-notify.ts`: remove `deliverApprovalDm`, `leaderRecipients`, `messageText`, the Lark import and the Lark branch in `notifyCommitted`; keep the CRM notification branch from phase 03. Rename `approvalNeedsLeaderDm` → `approvalNeedsLeader` and update its callers.
  3. Remove the items listed under "Files" in `admin-routes.ts`, `queries.ts`, `worker-commands.ts`, `env.ts`, `scheduled.ts`, `index.ts`, `contracts`.
  4. `mcp-tools.ts`: text "Leader sẽ được báo qua Lark" → "Leader sẽ nhận thông báo trên CRM".
  5. Web: remove Lark UI in `admin-users.tsx` and types in `types.ts`; search the web folder for `lark` and `resend` and remove what only served Lark.
- Success criteria: `Get-ChildItem apps/crm/src, packages/contracts/src, apps/zalo-bridge/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern "lark" -CaseSensitive:$false` prints only lines that mention the kept DB column names inside SQL of `queries.ts`/`admin-routes.ts` — and preferably nothing. Every remaining hit must be listed in your summary.
- Verify: `pnpm -r typecheck` exits 0.

### Task 5.3 — Tests
- Steps: update `approval-notify.test.ts` so a Leader-needing approval produces a `notification` row `kind 'approval'` for the team Leader and none for the requester; remove Lark expectations from any other test.
- Verify: `pnpm -r test` exits 0.

### Task 5.4 — Docs
- Steps: apply the three doc edits listed under "Files".
- Verify: `Select-String -Path docs/guides/lark-crm-e2e-test.md -Pattern "Không còn dùng"` prints one match.

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
