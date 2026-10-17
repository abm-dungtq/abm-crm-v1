---
phase: 4
title: "CRM: import company staff into a class + Sale report filter"
status: completed
priority: P1
effort: "1d"
dependencies: [2, 3]
---

# Phase 04: CRM — import company staff into a class, and keep them out of Sale "won" numbers

## Goal
`importContractLearners` accepts an optional `classId`. With it, each valid row becomes: a contact (new or reused), a learner lead with `source='partner'` already **won**, a `confirmed` enrollment in that class, an `enrollment` consent row, and a learner account when the row has an email that no account uses yet. Without `classId` the command behaves exactly as today. Sale-facing "won" counts exclude `source='partner'`.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Do not change behaviour of the no-`classId` path; existing tests in `apps/crm/test/admissions.test.ts` / `learner-foundation.test.ts` must stay green unchanged.

## Files to Create / Modify
- Modify: `apps/crm/src/worker/learner-commands.ts` (`LeadPlan` ~l.189, `writeLearnerLead` ~l.200, `importContractLearners` ~l.676)
- Modify: `apps/crm/src/worker/index.ts` and `apps/crm/src/worker/lms-programs.ts` (route `GET /lms/open-classes` only)
- Modify: `apps/crm/src/worker/queries.ts` (won tallies ~l.240–242, ~l.263–268, ~l.302, ~l.489)
- Modify: `apps/crm/src/worker/overview.ts` only if its won count (~l.75–80) can include learner partner leads — it is B2B-scoped (`b2bLeadScope`), so expected: no change; record the finding in the report.
- Create: `apps/crm/test/lms-partner-import.test.ts`

## Tasks

### Task 4.1 — Roles, owner and the class picker
- Decision (default, see plan validation): the import stays with the roles that run it today (`sale`, `leader`, `admin`) on the partner page; owner rules in `resolveOwner` are unchanged (Sale/Leader own the leads themselves, Admin picks a Sale/Leader). Do not change `COMMANDS.importContractLearners.roles`.
- Steps:
  1. Add a read route `GET /lms/open-classes` in `apps/crm/src/worker/index.ts`, gated to `['sale', 'leader', 'admin', 'academic', 'director']` (403 otherwise), returning open classes of the actor's org: `[{ id, name, courseName, scheduleText, hasProgram }]` ordered by course then class name, limit 200. Put the query function `openClasses(db, actor)` in `apps/crm/src/worker/lms-programs.ts`.
- Verify: no verification needed (Task 4.6).

### Task 4.2 — Won-lead option in `writeLearnerLead`
- Goal: one function still writes every learner lead; imports into a class write it already won.
- Steps:
  1. Add `outcome?: 'won'` to `LeadPlan`.
  2. In `writeLearnerLead`, when `plan.outcome === 'won'`:
     - insert the lead with `stage: 'won', status: 'won', next_action_task_id: null, closed_at: now, won_note: 'Nhập từ danh sách nhân viên doanh nghiệp'` (other columns unchanged);
     - skip the `tx.assert(... status = 'active')` line and skip the `task` insert;
     - call `insertJourneySteps` with every step `status: 'done'` — add a parameter `allDone = false` to `insertJourneySteps` and use `status: allDone || s.code === 'recorded' ? 'done' : 'open'`.
  3. Return value unchanged.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.3 — Contact choice for company rows
- Goal: rows tied to a contract are not blocked by another Sale's hold; an open learner lead still blocks; an existing learner account is reused.
- Steps:
  1. Add `function decidePartnerContact(candidates: ContactCandidate[]): { error: ApiFail } | { contact: ContactPlan }`: any candidate with `has_active_learner_lead` → `{ error: fail('DUPLICATE_SUSPECTED', activeLearnerLeadMessage) }`; else first candidate → `{ contact: { kind: 'own', state } }` (the `own` branch of `writeLearnerLead` keeps the existing owner and hold); none → `{ contact: { kind: 'new' } }`.
  2. Load, with one query, accounts for the file's emails: `SELECT la.email, la.contact_id FROM learner_account la WHERE la.organization_id = ? AND la.email IN (SELECT value FROM json_each(?))`.
  3. Load, with one query, contact state for those `contact_id`s using the same `CONTACT_STATE_COLUMNS` / `ACTIVE_LEARNER_LEAD_SQL` select as `loadPhoneIndex` (`WHERE c.id IN (SELECT value FROM json_each(?))`).
  4. Per row: phone candidates come from the existing phone index; if the email has an account, its contact is the candidate. If phone candidates exist and none is the account's contact → row error `SĐT và email thuộc hai học viên khác nhau`.
- Verify: no verification needed (Task 4.5).

### Task 4.4 — Class path in `importContractLearners`
- Steps:
  1. If `input.classId`: load `SELECT cg.id, cg.name, cg.status, co.id AS course_id, co.product_id FROM class_group cg JOIN course co ON co.id = cg.course_id WHERE cg.id = ? AND co.organization_id = ?`; missing → `fail('NOT_FOUND', 'Không tìm thấy lớp')`; `status !== 'open'` → `fail('VALIDATION_FAILED', 'Lớp không còn mở')`.
  2. Use `decidePartnerContact` (Task 4.3) instead of `decideContact` when `classId` is set; keep `decideContact` otherwise.
  3. For every accepted row, compute `account`: `'existing'` (email has an account), `'no_email'`, `'email_taken'` (email used by an account of a different contact), or `'new'`. Track emails within the file so two rows with the same email give the second `'email_taken'`.
  4. Preview (`commit: false`) returns the existing shape plus `account` on each `create` item and `summary: { newAccounts, existingAccounts, noEmail, emailTaken }`.
  5. Commit: `assertContractActive` as today; per row call `writeLearnerLead` with `outcome: 'won'`, `draft.productId = class.product_id`, `draft.courseId = class.course_id`; then
     - `tx.assert("SELECT COUNT(*) = 0 FROM enrollment WHERE contact_id = ? AND class_id = ? AND status IN ('pending','confirmed','studying','deferred')", [contactId, classId])`;
     - `tx.insertVersioned('enrollment', { id, organization_id, lead_id, contact_id, class_id, status: 'confirmed', deferred_until: null, status_before_defer: null, transferred_from_enrollment_id: null, confirmed_at: tx.now, ended_at: null })` (copied from `academic-commands.ts:271-275`);
     - `tx.raw` consent insert copied from `commands.ts:279-280` with `purpose 'enrollment'`, `granted 1`, `note 'Theo hợp đồng doanh nghiệp'`;
     - when `account === 'new'`: `tx.insertVersioned('learner_account', { id, organization_id, contact_id, email, status: 'active', created_by_user_id: actor.id })`.
     - `tx.activity(leadId, 'note', 'Ghi danh lớp ' + class.name + ' theo hợp đồng ' + contract.name)`.
  6. Commit response: `{ committed: true, create, errors, summary }`.
  7. Keep `ROSTER_MAX_ROWS` (200). Count reads: contract, owner, class, phone index, account index, account contacts = 6 queries before the batch. The class path writes ~20 statements per row (~4000 for 200 rows): add one test committing 200 generated rows with `classId`; if it fails or takes more than 25 s, add `const CLASS_IMPORT_MAX_ROWS = 100` and reject larger files on the class path with `Tối đa 100 người mỗi lần nhập vào lớp; chia thành nhiều file`, and record the measurement in the report.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.5 — Sale "won" numbers exclude partner leads
- Steps:
  1. In `queries.ts` `dashboard` (~l.225), the rollup query (~l.235-242) groups by `l.pipeline, l.status, ...` with `WHERE ${scope.sql}`. Change that WHERE to `WHERE ${scope.sql} AND NOT (l.pipeline = 'learner' AND l.status = 'won' AND l.source = 'partner')`. Lines ~263-268 and ~302 read that rollup: do not edit them. Do not edit ~l.489 (a B2B account rollup).
  2. Do not change `learner-reports.ts` `byContract` (the per-contract report must still count partner leads).
- Verify: covered by Task 4.6 case 5.

### Task 4.6 — Tests
- Target `apps/crm/test/lms-partner-import.test.ts`. Setup: `resetDb`; users from `test/helpers/learner-fixtures.ts` (`addUser('u-academic','academic')`; the importer is the seeded sale `u-lan`); a partner contract created like `apps/crm/test/admissions.test.ts` does; a class via `makeClass`.
- Cases:
  1. preview with `classId`, 4 rows (2 with email, 1 without email, 1 invalid email) → `create` length 3, one `errors` entry, `summary` = `{ newAccounts: 2, existingAccounts: 0, noEmail: 1, emailTaken: 0 }`, nothing written (`SELECT COUNT(*) FROM enrollment` unchanged).
  2. commit → 3 leads with `status='won'` and `source='partner'`, 3 `confirmed` enrollments in the class, 3 consent rows, 2 `learner_account` rows with `password_hash IS NULL`, and no open `task` for those leads.
  3. a second import of a row whose email already has an account → `account: 'existing'`, no second account; enrollment added if it is a different class.
  4. a sale-role user imports with `classId` → 200 and owns the leads; `GET /lms/open-classes` as sale → 200 and lists the class with `hasProgram`; as accountant → 403.
  5. `GET /dashboard` (or the route that serves `queries.ts` dashboard; read `index.ts`) won count for the learner pipeline is the same before and after the commit.
  6. import **without** `classId` still creates `active` leads with an open task (regression).
- Verify: from `D:\TQD\CRM\apps\crm`: `pnpm test test/lms-partner-import.test.ts` exits 0, no `failed`.

### Task 4.7 — Regression and report
- Verify: `pnpm -r typecheck` exits 0 and `pnpm -r test` exits 0.
- Report `plans/reports/agy-261016-phase-04-partner-import.md` (include the overview.ts finding), last line `Status: DONE`.

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

## Supervisor amendments (kongming checkpoint after phase 03) — these override the tasks above
1. `learner_account` is UNIQUE on both `contact_id` and `email`. Build the account index for BOTH the file's emails AND the resolved contact ids (load accounts where `contact_id IN (...)` too). A row whose contact already has an account (even under another email) is `existing`: reuse that account, never insert a second one. Normalise file emails with `trim().toLowerCase()` before every comparison (same as `lms-accounts.ts`). Add a test: contact already has an account with email A, file row matches that contact by phone with email B → classified existing, commit succeeds, no constraint error.
2. In the `won` branch of `writeLearnerLead` keep the duplicate-phone guard for new contacts and keep `assertContractActive`; drop only the active-lead assert and the task insert.
