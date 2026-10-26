# Phase 05 (remove Lark) and the phase 03/04 review follow-ups: implementation report

Executor: a Claude fullstack-developer subagent ran this, standing in for Agy because Agy's quota ran out. No subagents were spawned. No git command that changes the index or working tree was run, nothing was deployed, and no `--remote` or background server was used. `apps/zalo-bridge` was not edited.

Plan: `plans/261025-1500-internal-chat-tasks-agents/` (phase 05). Review items come from `plans/reports/code-reviewer-261026-0050-phase-03-04.md`.

## Outcome

- All review items M1–M8 and Low a–f are done.
- Phase 05 tasks 5.1–5.4 are done.
- `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter @abm/crm build` all exit 0.
- There is one deliberate deviation: `send_lark` is still listed in `COMMAND_KINDS`. The Concerns section explains why.

## Cron budget (M1)

These are measured counts for the every-minute cron, from `test/notifications.test.ts` "worst-case cron budget". The run happens at minute 0. The seed has:

- 8 due tasks;
- 8 users with 3 push subscriptions each;
- 3 overdue SLA conversations;
- 1 stale bot reply;
- 2 failing `send_messenger` worker commands.

| Metric | Measured | Limit |
|---|---|---|
| D1 queries (a `db.batch` counts as 1) | 35 | 40 |
| Subrequests (DO fetch plus push fetch) | 20 | 35 |
| Of these: push fetches | 15 | 15 cap |
| Of these: ChatHub DO calls | 5 | — |

Due tasks use `DUE_TASK_BATCH = 5`. Each cron run does:

- one batched notification insert for all due tasks;
- one push-subscription query;
- at most `DUE_TASK_PUSH_LIMIT = 15` pushes. Anything over the cap stays in-app only.

## Files

### Deleted

- `apps/crm/src/worker/lark.ts`
- `apps/crm/test/lark-link.test.ts`

### Created

- `apps/crm/migrations/0029_remove_lark_commands.sql`, copied byte-for-byte from the phase file.
- `apps/crm/test/helpers/test-sink.ts`, which builds a real `Sink` for tests.

### Changed: Worker

- `apps/crm/src/worker/notify.ts`:
  - New `notifyRows` and `NotificationRow`.
  - One `waitUntil` for push work, and nothing awaits it (M2).
  - Push work is capped at the limit.
- `apps/crm/src/worker/inbox-notices.ts`:
  - `sinkOrDb` removed.
  - `postInboxNotice` returns a boolean.
  - Member pruning happens in the same batch.
- `apps/crm/src/worker/inbox/scheduled.ts`:
  - Due-task batch and push cap.
  - `checkSla` moves the deadline only after a notice is posted (M7).
  - Lark env keys removed.
- Sink is now required (M8), with Lark comments replaced, in:
  - `inbox/assignment.ts`
  - `inbox/conversation-flow.ts`
  - `inbox/group-summaries.ts`
  - `inbox/ingest.ts`
  - `inbox/intake.ts`
  - `inbox/zalo-oa-oauth.ts`
  - `inbox/zalo-oa-send.ts`
  - `inbox/worker-commands.ts`, where `runLarkCommand` and the Lark env were also removed
- `inbox/group-leave.ts`: comment only.
- `apps/crm/src/worker/chat-routes.ts`:
  - Member add and remove on a system conversation return 403 (M4).
  - `system` was added to the conversation detail.
  - `scheduleAgentTurns` is wrapped in try/catch, and the log includes only the message id (M6).
- `apps/crm/src/worker/chat.ts`: agent and system messages store no mentions (Low a).
- `apps/crm/src/worker/chat-agents.ts`:
  - An empty or whitespace-only reply posts the failure notice (b).
  - History is flattened to one line per message (c).
  - A group key may not equal any agent's direct-chat key, on both create and patch (d).
  - `[TASK:]` titles are capped at 200 characters (e).
  - The offline notice is deduplicated per conversation per 10 minutes (f).
- `apps/crm/src/worker/admin-routes.ts`:
  - Removed the `/lark/link` and `/outbox/:id/resend` routes and the Lark imports.
  - Disabling a user deletes their `push_subscription` rows (M5).
- `apps/crm/src/worker/approval-notify.ts`:
  - The Lark DM path is gone.
  - Leaders get a CRM `approval` notification.
  - `approvalNeedsLeaderDm` was renamed to `approvalNeedsLeader`.
- `apps/crm/src/worker/env.ts`: `LARK_APP_ID`, `LARK_APP_SECRET` and `LARK_INBOX_CHAT_ID` removed.
- `apps/crm/src/worker/queries.ts`: `larkLinkStatus` and `larkCheckedAt` removed from the admin overview.
- `apps/crm/src/worker/mcp-tools.ts`: the reply text is now "Đã tạo yêu cầu, Leader sẽ nhận thông báo trên CRM".
- `apps/crm/wrangler.jsonc`: one comment reworded. It declares no `LARK_*` var.

### Changed: contracts

- `packages/contracts/src/index.ts`: `larkLinkInput` removed. The kept `send_lark` kind now carries an explanatory comment (see Concerns).

### Changed: web

- `apps/crm/public/sw.js` (M3):
  - Links are resolved against `self.location.origin`, and a link to another origin becomes `/`.
  - If `navigate()` fails, it falls back to `openWindow`.
  - `skipWaiting` runs on install and `clients.claim` on activate.
  - There is still no fetch handler.
- `apps/crm/src/web/types.ts`: Lark types and fields removed; `system` added to the chat conversation detail.
- `apps/crm/src/web/pages/admin-users.tsx`: Lark column, buttons, labels and hints removed.
- `apps/crm/src/web/pages/chat.tsx`: member editing is hidden for system conversations (M4).
- `apps/crm/src/web/pages/notification-settings.tsx`: new `forgetPushSubscriptionOnLogout()`. It is best effort and fire-and-forget (M5).
- `apps/crm/src/web/pages/change-password.tsx`: logout calls the push unsubscribe without waiting for it.
- `apps/crm/src/web/pages/overview.tsx`, `inbox-settings.tsx`, `zalo-groups.tsx`: Lark wording replaced.

### Changed: tests

- `apps/crm/test/approval-notify.test.ts`, rewritten. It now checks:
  - The Leader gets an `approval` notification and the requester gets none.
  - No `channel_command` row is created and `fetch` is never called.
  - The notification holds no customer phone or email.
  - An ordinary stage proposal notifies nobody.
  - A Leader is never notified about their own request.
  - A web owner change notifies the Leader.
  - A source scan finds no `LARK_` name under `apps/crm/src`.
- `apps/crm/test/raw-modules.d.ts`: an `ImportMeta.glob` declaration for that source scan.
- `apps/crm/test/notifications.test.ts`: new worst-case cron budget test.
- `apps/crm/test/inbox-notices.test.ts`: member pruning test, and a test for the system conversation's 403 and `system: true`.
- `apps/crm/test/admin-users.test.ts`: disabling a user deletes only that user's push subscriptions.
- `apps/crm/test/inbox-scheduled.test.ts`:
  - SLA deadline is kept when the notice fails.
  - `postInboxNotice` boolean.
  - Lark fakes removed.
- `apps/crm/test/chat-agents.test.ts`: the "guard rails" tests for Low a–f and M6.
- `apps/crm/test/inbox-flow.test.ts`: an old queued `send_lark` row is failed as `UNSUPPORTED_COMMAND` with no fetch.
- `apps/crm/test/inbox-dispatcher.test.ts`: its `send_lark` row was replaced with `zalo_login`.
- `apps/crm/test/inbox-assignment.test.ts`: the Lark test was removed and the push assertion now waits on `waitUntil`.
- `apps/crm/test/inbox-groups.test.ts`: Lark env and fake removed, titles renamed, dedupe id is now `notice:summary:<id>`.
- `apps/crm/test/inbox-group-bot.test.ts`, `inbox-intake.test.ts`, `mcp-gateway.test.ts`: Lark wording and fixtures replaced.
- `apps/crm/test/security-integrity.test.ts`:
  - Approval outbox rows now stay `pending` for every command, including `requestOwnerChange`.
  - Before, the Lark DM sender marked them `no_recipient`.
- Call sites were updated mechanically to pass `testSink()`. This touched:
  - `inbox-facebook`
  - `inbox-group-leave`
  - `inbox-handoff-check`
  - `inbox-media`
  - `inbox-sender-avatars`
  - `inbox-zalo-oa`

### Changed: docs (5.4)

- `docs/guides/lark-crm-e2e-test.md`: new top line "Không còn dùng từ 2026-10-25, xem ADR-012."
- `docs/adr/adr-004-chat-actor-identity.md`: added the 2026-10-25 update line.
- `docs/README.md`: the Lark test guide is marked obsolete.

## Verify commands

| Command | Exit |
|---|---|
| Baseline `pnpm --filter @abm/crm test` before any change (657 passed, 2 skipped) | 0 |
| 5.1 `pnpm --filter @abm/crm test -- inbox-dispatcher.test.ts`, first run | 1 (note 1) |
| 5.1 `pnpm --filter @abm/crm test -- inbox-dispatcher.test.ts`, rerun after 5.2/5.3 (55 files, 656 passed, 2 skipped) | 0 |
| 5.2 grep (PowerShell `Get-ChildItem … \| Select-String "lark"`) | 2 hits, see below |
| 5.4 `Select-String -Path docs/guides/lark-crm-e2e-test.md -Pattern "Không còn dùng"` (one match, line 1) | 0 |
| `pnpm -r typecheck` | 0 |
| `pnpm -r test` (crm 656 passed, 2 skipped; zalo-bridge 114; lms 17; lms-core 12; d1-guard 8; goclaw-identity 8) | 0 |
| `pnpm --filter @abm/crm build` | 0 |

Note 1: the first 5.1 run went over the whole crm suite. `inbox-dispatcher` passed 10 out of 10. The 8 failures were all in `lark-link.test.ts` and `approval-notify.test.ts`, because the admin Lark routes had already been removed. Tasks 5.2 and 5.3 deleted and rewrote those tests, and the rerun passed.

## Lark grep hits

The grep covers `apps/crm/src`, `packages/contracts/src` and `apps/zalo-bridge/src` (`*.ts`, `*.tsx`, case-insensitive):

- `packages/contracts/src/index.ts:873`: comment explaining the retired `send_lark` kind.
- `packages/contracts/src/index.ts:875`: `'send_lark'` inside `COMMAND_KINDS`.

There are no hits under `apps/crm/src`, not even `lark_*` SQL columns. The only one was the email-change reset, and it was removed. `apps/crm/wrangler.jsonc` contains 0 `LARK_` strings.

## Deviations and notes

1. **`send_lark` is still in `COMMAND_KINDS`.**
   - The phase file says to remove it.
   - Removing it breaks `pnpm -r typecheck` in `apps/zalo-bridge`: `test/command-runner.test.ts(333,35)` passes `'send_lark'` as `BridgeCommand['kind']`, which comes from `z.enum(COMMAND_KINDS)`.
   - The brief forbids editing the bridge and requires the typecheck to exit 0, so I kept the kind with a comment. Its runtime behaviour is unchanged:
     - Nothing queues it.
     - Migration 0029 fails queued rows.
     - The Worker fails any leftover row with `UNSUPPORTED_COMMAND`.
     - The bridge already rejects it.
   - To remove it fully, change that one bridge test line to another unsupported kind, then drop `'send_lark'` from the list.
2. The email-change branch in `admin-routes.ts` no longer resets the `app_user.lark_*` columns. The columns stay in the schema and are unused.
3. The group summary notice dedupe key changed from `summary-lark:<id>` to `summary:<id>`.
4. Admin overview: the "Bot & Lark" panel is now "Bot", and its outbox label now reads "Outbox". The "Outbox chờ gửi" KPI and the pending outbox rows were deliberately left unchanged, as the brief requires.
5. The offline notice id is now `offline:<sha256 prefix of conversation id>:<10-minute bucket>`. The old id was `offline:<message id>`. Hashing keeps the id short for long conversation ids.
6. Removing the push subscription at logout is best effort. Logout does not wait for it, so the DELETE (sent with `keepalive`) can arrive after the session cookie is cleared. If it does, the server-side cleanup on disable (M5) is the guarantee. A subscription left after an ordinary logout just stays until the browser or the next login replaces it.
7. Tests outside the phase-05 list were touched. Making the sink required (M8) changed signatures, so their call sites needed `testSink()`. `security-integrity.test.ts` also had a Lark-era expectation, `no_recipient`, that is no longer produced.

Status: DONE_WITH_CONCERNS
Summary: The review items M1–M8 and Low a–f are done, and phase 05 removed Lark from the CRM Worker, web app and contracts. Typecheck, every test suite and the build all exit 0. The cron worst case measured 35 out of 40 D1 queries and 20 out of 35 subrequests.
Concerns/Blockers: `'send_lark'` stays in `packages/contracts` `COMMAND_KINDS`, because removing it breaks the zalo-bridge typecheck and the brief forbids editing the bridge. It is the only Lark grep hit, and fixing it needs a one-line bridge test change, which is Opus's call.
