# Phase 02 Report: CRM — learner accounts and access

## Tasks Executed

- **Task 2.1 — `setLearnerDefaultPassword`**: Implemented `setLearnerDefaultPassword` handler in `apps/crm/src/worker/lms-accounts.ts` (updates `org_setting` default learner password hash/salt/iterations and audits without exposing password/hash).
- **Task 2.2 — `createLearnerAccount`**: Implemented `createLearnerAccount` handler in `apps/crm/src/worker/lms-accounts.ts` (validates contact and email uniqueness, inserts `contact_point` when `input.email` is provided and contact has no email point, and inserts `learner_account`).
- **Task 2.3 — `createClassLearnerAccounts`**: Implemented `createClassLearnerAccounts` handler in `apps/crm/src/worker/lms-accounts.ts`, including batch email deduplication (`takenEmails` updated inside the loop so duplicate emails within the same batch are added to `skippedEmailTaken` rather than throwing a UNIQUE constraint error).
- **Task 2.4 — `resetLearnerPassword`, `setLearnerAccountStatus`**: Implemented password reset to default and status toggle in `apps/crm/src/worker/lms-accounts.ts`, revoking active `learner_session` rows on reset and on `disabled` status.
- **Task 2.5 — `grantProgramAccess`, `revokeProgramAccess`**: Implemented manual access grant/block and revocation in `apps/crm/src/worker/lms-accounts.ts`, normalising `expiresAt` with `new Date(input.expiresAt).toISOString()` before comparing with `tx.now` and before storing.
- **Task 2.6 — Register commands and read routes**: Exported `LMS_STAFF`, `lmsAccountHandlers`, `listLearnerAccounts`, and `learnerAccountSettings` from `apps/crm/src/worker/lms-accounts.ts`; registered the 7 commands in `packages/contracts/src/index.ts` and `apps/crm/src/worker/commands.ts`; added `GET /lms/accounts` and `GET /lms/settings` in `apps/crm/src/worker/index.ts`.
- **Task 2.7 — Tests**: Created `apps/crm/test/lms-accounts.test.ts` with 8 test cases (7 phase cases + 1 batch duplicate email case).
- **Task 2.8 — Regression and report**: Ran workspace-wide typecheck and full `@abm/crm` test suite.

## Files Created / Modified

- Created: `apps/crm/src/worker/lms-accounts.ts`
- Modified: `packages/contracts/src/index.ts`
- Modified: `apps/crm/src/worker/commands.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Created: `apps/crm/test/lms-accounts.test.ts`
- Created: `plans/reports/agy-261016-phase-02-crm-learner-accounts-access.md`

## Verify Commands & Results

1. **Task 2.6 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output:
     ```
     $ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
     ```

2. **Task 2.7 Verify** (from `D:\TQD\CRM\apps\crm`): `pnpm test test/lms-accounts.test.ts`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
   - Output:
     ```
     $ vitest run "test/lms-accounts.test.ts"

      RUN  v4.1.11 D:/TQD/CRM/apps/crm

      ✓ test/lms-accounts.test.ts (8 tests) 945ms

      Test Files  1 passed (1)
           Tests  8 passed (8)
     ```

3. **Task 2.8 Verify (typecheck)** (from `D:\TQD\CRM`): `pnpm -r typecheck`
   - Result: PASS (exit code 0)
   - Output:
     ```
     poc/d1-guard typecheck$ tsc --noEmit
     packages/lms-core typecheck$ tsc --noEmit
     poc/goclaw-identity typecheck$ tsc --noEmit
     packages/contracts typecheck$ tsc --noEmit
     packages/lms-core typecheck: Done
     poc/d1-guard typecheck: Done
     packages/contracts typecheck: Done
     apps/crm typecheck$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
     apps/zalo-bridge typecheck$ tsc --noEmit
     apps/zalo-bridge typecheck: Done
     poc/goclaw-identity typecheck: Done
     apps/crm typecheck: Done
     ```

4. **Task 2.8 Verify (test)** (from `D:\TQD\CRM`): `pnpm --filter @abm/crm test`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 46 passed | 1 skipped (47)`, `Tests 579 passed | 2 skipped (581)`

Status: DONE
