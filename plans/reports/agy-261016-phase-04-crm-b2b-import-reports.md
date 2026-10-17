# Phase 04 Report: CRM — import company staff into a class + Sale report filter

## Tasks Executed

- **Task 4.1 — Roles, owner and the class picker**: Added `openClasses(db, actor)` in `apps/crm/src/worker/lms-programs.ts` and mounted `GET /lms/open-classes` in `apps/crm/src/worker/index.ts` gated to `['sale', 'leader', 'admin', 'academic', 'director']`.
- **Task 4.2 — Won-lead option in `writeLearnerLead`**: Added `outcome?: 'won'` to `LeadPlan` in `apps/crm/src/worker/learner-commands.ts`. When `plan.outcome === 'won'`, `writeLearnerLead` inserts the lead with `stage: 'won', status: 'won', next_action_task_id: null, closed_at: now, won_note: 'Nhập từ danh sách nhân viên doanh nghiệp'`, keeps the duplicate-phone guard for new contacts and `assertContractActive`, skips the active-lead assert and open `task` insert, and marks all journey steps `'done'` via `insertJourneySteps(..., allDone = true)` per Supervisor Amendment 2.
- **Task 4.3 — Contact choice for company rows**: Added `decidePartnerContact` in `apps/crm/src/worker/learner-commands.ts` and loaded `learner_account` rows for both the file's normalized emails (`trim().toLowerCase()`) and the phone-resolved contact IDs (`contact_id IN (...)`) plus their contact states per Supervisor Amendment 1.
- **Task 4.4 — Class path in `importContractLearners`**: Extended `importContractLearners` in `apps/crm/src/worker/learner-commands.ts` to validate `input.classId` (exists and `status === 'open'`), classify `account` (`'existing' | 'no_email' | 'email_taken' | 'new'`) while reusing existing accounts when the resolved contact already has an account (even under another email), return `summary` on preview/commit, and on commit create won partner leads, `confirmed` enrollments, `enrollment` consents (`Theo hợp đồng doanh nghiệp`), `learner_account` rows for `'new'` accounts, and enrollment activity notes. Measured 200-row commit with `classId`: ~562 ms (well below the 25 s threshold, so `ROSTER_MAX_ROWS = 200` is retained).
- **Task 4.5 — Sale "won" numbers exclude partner leads**: Updated the rollup query in `dashboard` (`apps/crm/src/worker/queries.ts`) to exclude `l.pipeline = 'learner' AND l.status = 'won' AND l.source = 'partner'`.
  - **`overview.ts` finding**: `overviewData` in `apps/crm/src/worker/overview.ts` uses `b2bLeadScope(actor)`, which restricts all queries (including the `sources` won count at lines 75–80) to `l.pipeline = 'b2b'`. Learner partner leads (`pipeline = 'learner'`) can never be included in `overview.ts`, so no change to `overview.ts` was needed.
- **Task 4.6 — Tests**: Created `apps/crm/test/lms-partner-import.test.ts` covering all required cases, the Supervisor Amendment 1 test (contact with existing account under email A matched by phone with email B), 200-row batch import performance, and edge cases.
- **Task 4.7 — Regression and report**: Verified workspace-wide `pnpm -r typecheck` and `pnpm -r test`.

## Files Created / Modified

- Modified: `apps/crm/src/worker/lms-programs.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Modified: `apps/crm/src/worker/learner-commands.ts`
- Modified: `apps/crm/src/worker/queries.ts`
- Created: `apps/crm/test/lms-partner-import.test.ts`
- Created: `plans/reports/agy-261016-phase-04-crm-b2b-import-reports.md`

## Verify Commands & Results

1. **Task 4.2 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

2. **Task 4.4 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

3. **Task 4.6 Verify** (from `D:\TQD\CRM\apps\crm`): `pnpm test test/lms-partner-import.test.ts`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 1 passed (1)`, `Tests 8 passed (8)` (200-row class import commit completed in ~562 ms)

4. **Task 4.7 Verify (typecheck)** (from `D:\TQD\CRM`): `pnpm -r typecheck`
   - Result: PASS (exit code 0)
   - Output: All 6 workspace projects (`packages/contracts`, `packages/lms-core`, `poc/d1-guard`, `poc/goclaw-identity`, `apps/zalo-bridge`, `apps/crm`) typechecked cleanly.

5. **Task 4.7 Verify (test)** (from `D:\TQD\CRM`): `pnpm -r test`
   - Result: PASS (exit code 0)
   - Test counts:
     - `packages/lms-core`: `Test Files 2 passed (2)`, `Tests 12 passed (12)`
     - `apps/zalo-bridge`: `Test Files 9 passed (9)`, `Tests 114 passed (114)`
     - `poc/goclaw-identity`: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
     - `poc/d1-guard`: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
     - `apps/crm`: `Test Files 48 passed | 1 skipped (49)`, `Tests 596 passed | 2 skipped (598)`

Status: DONE
