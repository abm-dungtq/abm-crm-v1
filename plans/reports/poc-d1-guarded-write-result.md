# PoC D1 guarded write — phase 05

Status: PASS. Local tests, remote race, and Time Travel restore all passed on 2026-10-04. ADR-003 is accepted. This dispatch resumed the existing scaffold and isolated database created by the previous attempt; no duplicate database was created.

## Implementation and tooling

The preserved scaffold now runs against real local D1 through Cloudflare's current Vitest integration. Each stage command binds a fresh nonce into the conditional update, guard, audit, outbox, and idempotency result. Next Action completion guards both mutable records and rolls back task closure/replacement on stale lead version. HTTP input never forwards the failure-injection option. The observation route reads synthetic lead version and audit count for the remote race script; this isolated PoC does not implement production authentication, RBAC, approvals, or kill switches.

Installed versions: Hono 4.13.12; Wrangler 4.147.0; Vitest 4.1.11; @cloudflare/vitest-plugin 1.3.6; @cloudflare/vitest-pool-workers 0.22.0; TypeScript 7.0.2; @cloudflare/workers-types 5.20261003.1; pnpm 12.6.0.

Coordinator guidance msg_6a48756fb80f authorizes a tooling deviation: use `cloudflareTest` and `defineConfig` with exactly pinned compatible Vitest instead of the phase's unavailable `defineWorkersConfig`. Pool 0.22.0 does not export `./config` and requires Vitest ^4.1.0, while latest Vitest is 5.0.3. The current [official testing guide](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) names @cloudflare/vitest-plugin. `readD1Migrations` supplies the actual SQL and `applyD1Migrations` runs it in the tests. Test configuration disables remote bindings. Dependency changes also update the shared lockfile; the coordinator's workspace changes were preserved. ADR-001 tooling follow-up belongs to the coordinator.

## Verify evidence

Exact phase shell commands ran through `C:/Users/ABM/AppData/Local/hermes/git/bin/bash.exe` from PowerShell.

| Task | Verify | Result |
| --- | --- | --- |
| 5.1 | `cd /d/TQD/CRM && pnpm -F @abm/poc-d1-guard typecheck` | PASS, exit 0, `$ tsc --noEmit`. |
| 5.2 | `cd /d/TQD/CRM/poc/d1-guard && npx wrangler d1 migrations apply abm-crm-poc --local` | PASS, exit 0; 0001_init.sql applied, seven commands succeeded in this dispatch. |
| 5.3 | `no verification needed` | N/A; behavior verified by 5.4. |
| 5.4 | `cd /d/TQD/CRM && pnpm -F @abm/poc-d1-guard test` | PASS, exit 0; `Test Files 1 passed (1)`, `Tests 8 passed (8)`, 1.42 seconds at 09:35:45 Asia/Saigon. |
| 5.5 | `node poc/d1-guard/scripts/race.mjs https://abm-crm-poc.ngulongyquan.workers.dev` | PASS, exit 0; `RACE_OK pairs=20 winners=20 audit=20`. Every pair printed `winners=1 stale=1`. |
| 5.6 | `npx wrangler d1 execute abm-crm-poc --remote --command "SELECT stage FROM lead WHERE id='L1'"` | PASS, exit 0; returned `Race-19-0`, matching the stage before the confirmed `Lost` mutation. |
| 5.7 | `grep -c 'ADR-ACCEPTED' /d/TQD/CRM/docs/adr/adr-003-d1-guarded-write-pattern.md` | PASS; exactly one acceptance marker. Commit belongs to the coordinator. |

The eight required tests all passed:

1. `stale version is rejected and leaves no audit or outbox`: includes the other-writer expected+1/nonce case.
2. `successful change writes lead, audit and outbox atomically`: audit/outbox/idempotency increment once; guard empty.
3. `sequential double submit with same expected version: second is stale`.
4. `same idempotency key replays without duplicate outbox`: also rejects changed payload under the same key.
5. `failure mid-batch rolls back everything`: injected CHECK failure rolls back the update and all effects.
6. `completing next action without a replacement is rejected for active lead`.
7. `completing next action with replacement swaps task atomically`: also tests rollback on a stale lead.
8. `missing lead is rejected and writes nothing`.

`pnpm install` and race-script syntax validation also passed. These additional checks do not replace remote evidence. No persistent local PoC database existed before the initial migration; it created the synthetic schema from scratch. The test database is ephemeral. No background server or workerd process remains after the local checks.

## Remote evidence and limits

Coordinator guidance `msg_f5de9c26c3a9` records user authorization for the isolated remote database and Worker, synthetic writes, race, restore, export, and deletion after evidence is recorded. `npx wrangler whoami` confirmed OAuth login; credentials and account identifiers are omitted. The existing database was created at 2026-10-04T02:33:30.307Z. A fresh pre-migration export was saved at `poc/d1-guard/exports/poc-before-migrations.sql` (1,289 bytes). Remote migration apply and migration list both reported no outstanding migrations; inspection confirmed the required schema and zero leads before seed. The deployed Worker version was `39ca7e0f-c32b-4a0d-ba96-561bf03a82dd`.

The synthetic L1 seed began at version 1. Twenty parallel request pairs ended at version 21, with exactly 20 audit rows, 20 outbox rows, 20 idempotency results, and zero guard rows. All remote SQL observations were served by the primary in APAC/HKG. A pre-restore SQL backup was exported before changing the stage. Time Travel bookmark B1 was `00000001-00000029-000050fa-b2a42466c0ebefb5f505ed792028aba5`. The stage was observed as `Lost` after mutation, then restored to `Race-19-0`. Elapsed time from launching the restore command through the successful verification read was 4,964 milliseconds, including CLI startup and network latency. The final `npx wrangler d1 export abm-crm-poc --remote --output exports/poc.sql` succeeded and produced 16,453 bytes; `git check-ignore` confirms the export is ignored. Bookmark and timing details also remain in ignored local export artifacts.

These results accept the ADR-003 nonce/guard transaction pattern. Twenty pairs establish this bounded concurrency case, not a load or availability guarantee. The single small synthetic restore does not establish production RPO/RTO or retention coverage. Authentication, organization scope, approvals, kill switches, and production command coverage remain outside this PoC. No production resource, MISA, or GoClaw was changed. Cleanup of the authorized PoC Worker and database is recorded below after deletion verification. The coordinator owns the commit.

## Cleanup and review

Following the recorded user authorization, `npx wrangler delete` returned `Successfully deleted abm-crm-poc`, then `npx wrangler d1 delete abm-crm-poc --skip-confirmation` returned `Deleted 'abm-crm-poc' successfully`, both exit 0. The local Wrangler binding is reset to the zero UUID so it does not point to a deleted remote resource. SQL exports and restore evidence remain under the gitignored PoC `exports/` directory. No background process was started by this dispatch.

Inline review checked conditional version/nonce guards, transaction ordering, rollback coverage, replay conflict handling, synthetic HTTP inputs, and report/ADR links. All eight required test names are present; failure injection is available only to direct command calls and is not forwarded from HTTP. `git diff --check` passed. No independent reviewer was spawned because this worker is supervised by the coordinator. The preserved scaffold and dependency changes from preceding attempts are ready for coordinator review and commit; this dispatch changed the result report, ADR-003, and the post-cleanup binding only.
