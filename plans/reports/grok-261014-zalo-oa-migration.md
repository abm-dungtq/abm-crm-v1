# Phase 3 report: contracts and migration 0020

Phase: `plans/261014-0842-zalo-oa-into-crm/phase-03-contracts-migration.md`
Tasks: 3.1, 3.2, 3.3. Task 3.4 was not run.

## What changed

- `apps/crm/migrations/0020_zalo_oa.sql` (new): rebuilds `channel_account` and `channel_command`, parks `zalo_staff_member` across the account drop, adds `zalo_oa_credential` and `zalo_oa_oauth_state`, and adds `message.delivered_at` and `message.seen_at`.
- `packages/contracts/src/index.ts`: `CHANNEL_KINDS` is `['zalo', 'facebook', 'zalo_oa']`. `COMMAND_KINDS` includes `'send_zalo_oa'`. No other channel union or enum exists in that package. `LEAD_SOURCES` is a lead-source list, not a channel, and was left unchanged.
- `apps/crm/test/inbox-zalo-oa-schema.test.ts` (new): stores `channel='zalo_oa'` and `kind='send_zalo_oa'`, rejects `channel='other'`, inserts a conversation and a `zalo_staff_member` against the rebuilt account, checks `PRAGMA foreign_key_check` is empty, checks the conversation foreign key still blocks account delete, and checks staff rows cascade once the conversation is gone.

No other files were edited. Nothing was committed, pushed, deployed, or run with `wrangler`.

## Rebuild method

The phase sketch creates `channel_account_new` and renames it onto `channel_account`. That commit fails once a child row references the table. With `PRAGMA defer_foreign_keys` on, `DROP` plus `ALTER TABLE ... RENAME` still ends in `FOREIGN KEY constraint failed`, while `PRAGMA foreign_key_check` is empty. `ON DELETE CASCADE` also fires during that drop, so `zalo_staff_member` rows would disappear.

`apps/crm/migrations/0006_learner_foundation.sql` already records the same limit: copy to a backup, drop, recreate under the same name, copy back. 0020 follows that pattern.

`zalo_staff_member` is copied to `zalo_staff_member_backup` before the account drop and inserted back after the new `channel_account` exists. The backup table is dropped in the same migration. Columns, defaults, CHECKs, the `(channel, external_id)` unique key, `dedupe_key UNIQUE`, both command foreign keys, and `channel_command_due` match 0012 plus `last_error` from 0017. `registration_policy` is the new `INTEGER NOT NULL DEFAULT 0 CHECK (registration_policy IN (0, 1))` column. No later migration changes `channel_command`.

A local SQLite simulation of this file, not a D1 run, applied it on an empty schema and on a schema with one row each in `channel_account`, `conversation`, `message`, `channel_command`, `zalo_staff_member`, `zalo_group_member`, `lead_intake`, and `group_schedule`. Counts matched, `foreign_key_check` was empty, `last_error` was kept, and `registration_policy` was 0. Task 3.4 is still the rehearsal on a copy of remote D1.

## Verify

Commands from `D:\TQD\CRM`.

Before any phase 3 edit:

- `pnpm -F @abm/crm test` — exit 0. **479 passed, 2 skipped** (481). Files: 38 passed, 1 skipped (39). Duration 43.57s. Start 11:23:46. The new test file was not in this run.

After the edits:

- `pnpm -F @abm/contracts typecheck` — exit 0.
- `pnpm -F @abm/crm typecheck` — exit 0. No type errors in files phase 4 will change.
- `pnpm -F @abm/crm test -- inbox-zalo-oa-schema` — exit 0. pnpm invoked `vitest run "--" "inbox-zalo-oa-schema"`, so vitest ran the whole suite rather than one file. **482 passed, 2 skipped** (484). Files: 39 passed, 1 skipped (40). Duration 44.06s. Start 11:25:09. `test/inbox-zalo-oa-schema.test.ts` contributed the 3 new passes. That is the baseline 479 plus those 3 tests. The same run is the full-suite check the phase asks for after the filtered command.

## Note for phase 4

`apps/crm/test/helpers/reset-db.ts` is outside this phase's file list and was not changed. `zalo_oa_credential` cascades when its account is deleted. `zalo_oa_oauth_state` references `app_user` without `ON DELETE CASCADE`. A test that leaves an OAuth state row will fail the next `resetDb` delete of `app_user` until that helper deletes the new table first.

Status: DONE
