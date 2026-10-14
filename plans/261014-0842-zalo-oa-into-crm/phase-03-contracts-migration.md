# Phase 3: Contracts and migration 0020 (`zalo_oa` channel)

Executor: Grok via Paseo. Supervisor: Opus. Opus then rehearses the migration on a copy of the remote D1 (Task 3.4); Grok does not touch remote.

## Context (verified)

- `apps/crm/migrations/0012_inbox.sql` creates three tables:
  - `channel_account`: `channel CHECK (channel IN ('zalo','facebook'))`, `status CHECK (... 'disconnected','qr_pending','connected','error')`, `UNIQUE (channel, external_id)`.
  - `conversation`, which `REFERENCES channel_account(id)`.
  - `channel_command`: `kind CHECK (kind IN ('send_zalo','send_messenger','run_completion','send_lark','zalo_login','zalo_logout'))`. It references `channel_account(id)` and `conversation(id)`. Index `channel_command_due`, `dedupe_key UNIQUE`.
- `0017_channel_account_last_error.sql` adds `channel_account.last_error`.
- `0019_zalo_group_bot.sql` adds `zalo_staff_member`, which `REFERENCES channel_account(id) ON DELETE CASCADE`.
- `message` already has `attachments_json` and `external_msg_id`.
- `packages/contracts/src/index.ts`:
  - `COMMAND_KINDS` is at about line 732.
  - Search for the channel union (`'zalo' | 'facebook'`, or a zod enum) and update every place you find.
- Tests reset the DB through `apps/crm/test/helpers/reset-db.ts`, which applies all migrations.

## Files you may modify

- New `apps/crm/migrations/0020_zalo_oa.sql`
- `packages/contracts/src/index.ts`
- New `apps/crm/test/inbox-zalo-oa-schema.test.ts`

## Tasks

### Task 3.1: Migration

- Target: `apps/crm/migrations/0020_zalo_oa.sql`.
- Steps:
  1. Start with `PRAGMA defer_foreign_keys = true;`. D1 then allows rebuilding a table that other tables reference.
  2. Rebuild `channel_account` as `channel_account_new`:
     - the exact current columns: those of 0012 plus `last_error TEXT`, in the same order;
     - change the CHECK to `channel IN ('zalo','facebook','zalo_oa')`;
     - add `registration_policy INTEGER NOT NULL DEFAULT 0 CHECK (registration_policy IN (0,1))`.
     
     Then `INSERT INTO channel_account_new (<all old columns>) SELECT <all old columns> FROM channel_account;`, `DROP TABLE channel_account;`, `ALTER TABLE channel_account_new RENAME TO channel_account;`.
  3. Rebuild `channel_command` the same way:
     - add `'send_zalo_oa'` to the `kind` CHECK;
     - keep the columns, `dedupe_key UNIQUE` and the FKs;
     - recreate the index `channel_command_due ON channel_command(target, status, next_run_at)`.
  4. Add OAuth tables:
     ```sql
     CREATE TABLE zalo_oa_credential (
       channel_account_id TEXT PRIMARY KEY REFERENCES channel_account(id) ON DELETE CASCADE,
       access_token_enc TEXT NOT NULL,
       refresh_token_enc TEXT NOT NULL,
       access_expires_at TEXT NOT NULL,
       refresh_expires_at TEXT NOT NULL,
       -- Bumped on every refresh; a refresh writes only when the version it read is still current.
       version INTEGER NOT NULL DEFAULT 1,
       updated_at TEXT NOT NULL
     );
     CREATE TABLE zalo_oa_oauth_state (
       state TEXT PRIMARY KEY,
       code_verifier TEXT NOT NULL,
       created_by_user_id TEXT NOT NULL REFERENCES app_user(id),
       created_at TEXT NOT NULL,
       expires_at TEXT NOT NULL
     );
     ALTER TABLE message ADD COLUMN delivered_at TEXT;
     ALTER TABLE message ADD COLUMN seen_at TEXT;
     ```
  5. Put a two-line header comment at the top explaining the purpose: the Zalo Official Account channel, its rotating OAuth tokens, and delivery/seen receipts.
- Success criteria: the migration applies on an empty DB and on a DB with rows in every rebuilt table.
- Verify: Task 3.3.

### Task 3.2: Contracts

- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Add `'send_zalo_oa'` to `COMMAND_KINDS`.
  2. Add `'zalo_oa'` to every channel union or enum.
- Verify: `pnpm -F @abm/contracts typecheck` exits 0. If the package has no such script, run `pnpm -F @abm/crm typecheck`, which must exit 0. Ignore type errors in files phase 4 will change; list them in the report.

### Task 3.3: Schema test

- Target: new `apps/crm/test/inbox-zalo-oa-schema.test.ts`.
- Steps:
  1. After `resetDb`, insert a `channel_account` with `channel='zalo_oa'`, and a `channel_command` with `kind='send_zalo_oa'`. Expect both to succeed.
  2. Expect `channel='other'` to fail.
  3. Expect a `zalo_staff_member` row and a `conversation` row that reference a rebuilt `channel_account` to be insertable, and to cascade or remain valid as declared.
  4. Run `PRAGMA foreign_key_check` and expect zero rows.
- Verify: `pnpm -F @abm/crm test -- inbox-zalo-oa-schema` exits 0. Then `pnpm -F @abm/crm test` exits 0, with the same pass count as before plus the new tests.

### Task 3.4: Rehearse on a copy of remote D1 (Opus only)

- Steps:
  1. `pnpm exec wrangler d1 export abm-crm-eval --remote --output D:\TQD\CRM\exports\abm-crm-eval-before-0020-<stamp>.sql`.
  2. Load the export into a fresh local D1 with a throwaway persist dir: `wrangler d1 execute abm-crm-eval --local --persist-to <tmp> --file <export>`.
  3. Apply `0020_zalo_oa.sql` with `wrangler d1 execute ... --local --persist-to <tmp> --file migrations/0020_zalo_oa.sql`.
  4. Compare the row counts of `channel_account`, `conversation`, `channel_command`, `message` and `zalo_staff_member` before and after.
  5. Run `PRAGMA foreign_key_check`.
- Verify: the counts are equal, and `foreign_key_check` returns no rows. Delete `<tmp>` afterwards.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Never continue by self-reasoning. Write the report to `plans/reports/grok-261014-zalo-oa-migration.md` ending with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.
