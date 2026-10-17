---
phase: 2
title: "CRM: learner accounts and access"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 02: CRM — learner accounts and access

## Goal
Staff (Admin/Học vụ) can set the organization's default learner password, create learner accounts (one contact or a whole class), reset a password back to the default, disable an account, and add/revoke manual access grants or blocks; read endpoints list accounts with their access.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Phase 03 runs after this phase and creates `lms-programs.ts`, `lms-publish-routes.ts`, `stream.ts`; do not create them here.
- Copy patterns from `apps/crm/src/worker/academic-commands.ts` (`transferEnrollment`, lines ~259–279) and `apps/crm/src/worker/fees.ts` (`updateOrgBank`, lines ~339–345).

## Files to Create / Modify
- Create: `apps/crm/src/worker/lms-accounts.ts` (handlers `lmsAccountHandlers` + query functions)
- Modify: `apps/crm/src/worker/commands.ts` (spread `...lmsAccountHandlers` into `handlers`, line ~64)
- Modify: `packages/contracts/src/index.ts` (COMMANDS entries for this phase only)
- Modify: `apps/crm/src/worker/index.ts` (two GET routes, inline like the other GET routes at lines ~78–208)
- Create: `apps/crm/test/lms-accounts.test.ts`

## Shared definitions (use exactly)
- Email normalisation: `email.trim().toLowerCase()`.
- "Contact email": `SELECT value, normalized_value FROM contact_point WHERE contact_id = ? AND type = 'email' ORDER BY created_at LIMIT 1`.
- Staff readers: `const LMS_STAFF = ['academic', 'admin', 'director']` (export it from `lms-accounts.ts`; phase 03 imports it).
- Revoke all sessions of an account inside a tx: `tx.raw(db.prepare("UPDATE learner_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").bind(tx.now, accountId))`.

## Error codes
Only the codes in `ERROR_CODES` (`packages/contracts/src/index.ts:225`) exist; there is no `CONFLICT`. Use `DUPLICATE_SUSPECTED` (HTTP 409) for "already exists", `VALIDATION_FAILED` (422), `NOT_FOUND` (404), `FORBIDDEN` (403), `STALE_VERSION` (409).

## Tasks

### Task 2.1 — `setLearnerDefaultPassword` (admin)
- Goal: one hashed default password is stored on the organization's `org_setting` row.
- Target: `lms-accounts.ts` handler `setLearnerDefaultPassword`; contracts `COMMANDS.setLearnerDefaultPassword` roles `['admin']`, `expectedVersion: false`.
- Steps:
  1. Load `SELECT id, version FROM org_setting WHERE organization_id = ?` (actor.organizationId). Missing → `fail('NOT_FOUND', 'Chưa có cài đặt tổ chức')`.
  2. `const stored = await hashPassword(input.password)` (import from `./password`).
  3. `tx.update('org_setting', row.id, row.version, { learner_default_password_hash: stored.hash, learner_default_password_salt: stored.salt, learner_default_password_iterations: stored.iterations })`.
  4. `tx.audit('org_setting', row.id, { learnerDefaultPassword: 'set' }, { learnerDefaultPassword: 'changed' })` — never put the password or hash in the audit.
  5. Return `ok({ id: row.id })`.
- Success criteria: admin gets 200; academic gets 403; the hash column is non-null afterwards.
- Verify: covered by Task 2.7.

### Task 2.2 — `createLearnerAccount` (academic, admin)
- Goal: a contact gets one learner account keyed by email, using the default password.
- Steps:
  1. Load contact `SELECT id, display_name FROM contact WHERE id = ? AND organization_id = ? AND archived_at IS NULL`; missing → `fail('NOT_FOUND', 'Không tìm thấy học viên')`.
  2. Existing account for contact → `fail('DUPLICATE_SUSPECTED', 'Học viên đã có tài khoản học')`.
  3. Email = normalised `input.email` if given, else the contact email's `normalized_value` lower-cased; none → `fail('VALIDATION_FAILED', 'Học viên chưa có email', { fields: { email: 'Bắt buộc' } })`.
  4. Email used by another `learner_account` → `fail('DUPLICATE_SUSPECTED', 'Email đã được dùng cho tài khoản học khác')`.
  5. If `input.email` was given and the contact has no email point, add one with the same INSERT … WHERE NOT EXISTS statement used in `learner-commands.ts` (lines ~237–242).
  6. `tx.insertVersioned('learner_account', { id: crypto.randomUUID(), organization_id, contact_id, email, status: 'active', created_by_user_id: actor.id })`; `tx.audit('learner_account', id, null, { email })`.
  7. Return `ok({ id, email })`.
- Note: creating an account does NOT require the default password to exist; queries expose `hasDefaultPassword` so the UI can warn.

### Task 2.3 — `createClassLearnerAccounts` (academic, admin)
- Goal: one click creates accounts for every enrolled learner of a class who has an email and no account.
- Steps:
  1. Class must exist in the org (join `class_group → course` on `organization_id`); else NOT_FOUND.
  2. One query: contacts with `enrollment.status IN ('confirmed','studying','completed')` in that class, LEFT JOIN `learner_account` (by contact), plus their first email point (correlated subquery). Limit 500.
  3. One query: existing `learner_account.email` values in the candidate emails (`IN (SELECT value FROM json_each(?))`).
  4. For each contact without account: no email → push to `skippedNoEmail` (display name); email taken (by query 3 or earlier in this loop) → push to `skippedEmailTaken`; else `insertVersioned` + audit as Task 2.2.
  5. If nothing to insert, still return 200 with the lists (the tx has no anchor; follow how existing handlers return early without writes — `commands.ts:122` skips commit when there is no anchor).
  6. Return `ok({ created: number, skippedNoEmail: string[], skippedEmailTaken: string[] })`.

### Task 2.4 — `resetLearnerPassword`, `setLearnerAccountStatus`
- Goal: Học vụ returns an account to the default password, or disables/enables it.
- Steps:
  1. Load account by id and org; missing → NOT_FOUND; `version` mismatch → `fail('STALE_VERSION', …)` (copy message style from `transferEnrollment`).
  2. Reset: `tx.update('learner_account', id, version, { password_hash: null, password_salt: null, password_iterations: null, password_changed_at: null, failed_login_count: 0, locked_until: null })`, revoke sessions, audit `{ password: 'reset_to_default' }`.
  3. Status: `tx.update(... { status })`; when `status === 'disabled'` revoke sessions; audit old/new status.
  4. Return `ok({ id, version: version + 1 })`.

### Task 2.5 — `grantProgramAccess`, `revokeProgramAccess`
- Steps:
  1. Grant: contact must be in org; program must be in org (`SELECT id FROM lms_program WHERE id = ? AND organization_id = ?`); `expiresAt`, if given, must be later than now else VALIDATION_FAILED.
  2. `tx.insertVersioned('lms_access', { id, organization_id, contact_id, program_id, mode, expires_at: input.expiresAt ?? null, note: input.note ?? null, created_by_user_id: actor.id })`; audit.
  3. Revoke: load by id/org, version check, `tx.update('lms_access', id, version, { revoked_at: tx.now })`; audit.

### Task 2.6 — Register commands and read routes
- Steps:
  1. Export `lmsAccountHandlers = { setLearnerDefaultPassword, createLearnerAccount, createClassLearnerAccounts, resetLearnerPassword, setLearnerAccountStatus, grantProgramAccess, revokeProgramAccess }`; spread into `handlers` in `commands.ts`.
  2. Add the seven `COMMANDS` entries (roles per phase 01 Task 1.5 step 4).
  3. Query `listLearnerAccounts(db, actor, { q, classId, passwordState, limit })` in `lms-accounts.ts`, returning per account: `id, version, contactId, displayName, email, status, usesDefaultPassword (password_hash IS NULL), lastLoginAt, lockedUntil`, and `programs: [{ programId, title, className, via: 'enrollment'|'grant', accessId?, accessVersion?, mode? }]` built from enrollment (statuses from `ACCESS_ENROLLMENT_STATUSES` in `@abm/lms-core`) plus live `lms_access` rows. `q` matches name or email (`LIKE`), `passwordState` = `default` | `changed`, limit default 100 max 200, order by display name.
  4. Query `learnerAccountSettings(db, actor)` → `{ hasDefaultPassword: boolean }`.
  5. Routes in `index.ts` (after `requireActor`): `GET /lms/accounts` → 403 unless `LMS_STAFF` includes role; `GET /lms/settings` → same gate. Response shape `ok(data)` like neighbours.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.7 — Tests
- Target: `apps/crm/test/lms-accounts.test.ts`. Setup like `apps/crm/test/academic.test.ts` (`resetDb`, `addUser('u-academic','academic')`, `makeClass`, `winLead`, `reserve`, `grantConsent` from `test/helpers/learner-fixtures.ts`).
- Cases (each an `it`):
  1. admin sets default password → 200, `org_setting.learner_default_password_hash` not null; academic → 403.
  2. createLearnerAccount for a contact with an email given → 200; second call → 409 DUPLICATE_SUSPECTED; another contact with the same email → 409.
  3. contact without email and no input email → 422 VALIDATION_FAILED.
  4. createClassLearnerAccounts on a class with 2 confirmed enrollments (one with email, one without) → `created: 1`, `skippedNoEmail` length 1.
  5. resetLearnerPassword sets hash NULL and revokes a manually inserted `learner_session` row.
  6. grant then revoke access; `GET /lms/accounts` shows the grant only while live.
  7. sale user calling `GET /lms/accounts` → 403.
- Verify: from `D:\TQD\CRM\apps\crm`: `pnpm test test/lms-accounts.test.ts` exits 0, output has `7 passed` (or more) and no `failed`.

### Task 2.8 — Regression and report
- Verify: `pnpm -r typecheck` exits 0 and `pnpm --filter @abm/crm test` exits 0.
- Report `plans/reports/agy-261016-phase-02-lms-accounts.md`, last line `Status: DONE`.

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
