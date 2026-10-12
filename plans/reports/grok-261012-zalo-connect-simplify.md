# Zalo connect: simpler and more robust

Worker time owns QR expiry, the bridge corrects its HMAC timestamp from the Worker `Date` header, and the channel-accounts page says when the bridge is offline. The Windows task starts hidden at logon and repeats every 5 minutes. The installer was not run, and remote D1 was not touched.

## Behaviour

- `ingestQr` stores `qr_expires_at` as Worker receive time + 90 seconds. The bridge QR event no longer sends `expiresAt`; an old bridge that still sends it is ignored. `MAX_QR_CODES` is 4.
- `CrmClient` keeps `offset = server Date - local now` and signs `X-Bridge-Timestamp` with it. The first request uses local time. A 401 whose `Date` shows more than 60 seconds of skew is retried once with the corrected timestamp. `clock.skew` is logged the first time the rounded offset passes 30 seconds, and again only when that logged offset moves by 5 seconds or more. `postResult` keeps retrying only while Worker time (`local + offset`) is still more than 8 seconds before the lease deadline.
- A claimed `zalo_login` gets a 450 second lease (4 codes × ~100 seconds, plus 50 seconds to report the result). Other commands stay on the 300 second lease.
- Authenticated `GET /api/bridge/commands` writes `inbox_setting.bridge_last_seen_at`. `GET /api/inbox/accounts` returns `{ accounts, bridgeOnline, bridgeLastSeenAt }`. Each account also includes `qrExpiresInSeconds`, computed from Worker time. The page counts down from that value using only how long ago the response arrived. `bridgeOnline` is true when that timestamp is within 90 seconds of Worker time. The list (only when at least one Zalo account exists) and the connect dialog show: `Máy chạy bridge đang tắt (lần cuối: HH:mm). Bật lại máy hoặc chạy lại 'ABM Zalo Bridge'.` Time is `Asia/Ho_Chi_Minh`; a bridge never seen shows `—`. While the bridge is offline the connect dialog shows “Tạo mã mới”.
- The minute cron fails `zalo_login` / `zalo_logout` that are still `pending` with `attempts = 0` after 3 minutes, and a claimed `zalo_login` whose lease has passed. The stale read filters `target = 'bridge'` and `kind`, so it can use `channel_command_due`. Result is `{"error":"BRIDGE_OFFLINE"}`. A `zalo_login` that this batch actually failed moves an account that is not `connected` to `error` with that last error and clears its QR, including an account still `disconnected`. A `connected` account stays connected. A login claimed between the read and the update stays claimed. A failed command is not claimed again. Send commands are unchanged.
- The scheduled task action is `conhost.exe --headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File <start-zalo-bridge.ps1>`. Trigger is AtLogOn for the current user, repeating every 5 minutes with an empty duration (indefinite while the account stays logged on), `MultipleInstances IgnoreNew`, limited interactive token. The AtStartup / S4U branch is gone. `start-zalo-bridge.ps1` still exits when a bridge is already running. It creates `cmd.exe` suspended with the repository root as the process current directory, assigns it to a job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumes it, and tree-kills in `finally` if the child is still alive.

## Migration

`apps/crm/migrations/0018_bridge_last_seen.sql` adds nullable `inbox_setting.bridge_last_seen_at TEXT`. Not applied to remote D1.

Deploy order for this column: apply migration `0018_bridge_last_seen.sql` on eval, then deploy the Worker, then restart or reinstall the bridge. Same order is in phase 10 task 10.5. None of those steps were run.

## Installer

From the repo root, no administrator:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps\zalo-bridge\scripts\install-startup-task.ps1
```

This command was not run. An in-memory `New-ScheduledTask` (no `Register-ScheduledTask`) kept the trigger as `MSFT_TaskLogonTrigger` with interval `PT5M`, an empty duration, and `StopAtDurationEnd` false. `check-syntax.ps1` printed `ok` for both scripts. The job-object C# type compiled; the bridge was not started.

## Tests

- `pnpm --filter @abm/crm test`: 460 passed, 2 skipped, exit 0
- `pnpm --filter @abm/zalo-bridge test`: 50 passed, exit 0
- `pnpm --filter @abm/crm typecheck`: exit 0 (`tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`)
- `pnpm --filter @abm/zalo-bridge typecheck`: exit 0 (`tsc --noEmit`)

## Files

- `apps/crm/migrations/0018_bridge_last_seen.sql`
- `apps/crm/src/worker/inbox/ingest.ts`
- `apps/crm/src/worker/inbox/bridge-routes.ts`
- `apps/crm/src/worker/inbox/inbox-routes.ts`
- `apps/crm/src/worker/inbox/scheduled.ts`
- `apps/crm/src/web/types.ts`
- `apps/crm/src/web/api.ts`
- `apps/crm/src/web/pages/channel-accounts.tsx`
- `apps/crm/src/web/pages/inbox.tsx`
- `apps/crm/src/web/pages/zalo-groups.tsx`
- `apps/crm/test/inbox-bridge.test.ts`
- `apps/crm/test/inbox-flow.test.ts`
- `apps/crm/test/inbox-scheduled.test.ts`
- `apps/zalo-bridge/src/crm-client.ts`
- `apps/zalo-bridge/src/zalo-client.ts`
- `apps/zalo-bridge/src/account-manager.ts`
- `apps/zalo-bridge/test/crm-client.test.ts`
- `apps/zalo-bridge/test/account-manager.test.ts`
- `apps/zalo-bridge/scripts/install-startup-task.ps1`
- `apps/zalo-bridge/scripts/start-zalo-bridge.ps1`
- `packages/contracts/src/index.ts`
- `docs/adr/adr-008-zalo-bridge-sidecar.md`
- `docs/integrations/goclaw-inbox-agents.md`
- `plans/261008-1430-omnichannel-inbox-goclaw/phase-10-rollout-pilot.md`

Status: DONE
