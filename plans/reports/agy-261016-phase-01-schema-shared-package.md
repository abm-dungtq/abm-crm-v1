# Phase 01 Report: Schema, shared package, contracts

## Tasks Executed

- **Task 1.1 — Write migration 0024**: Created `apps/crm/migrations/0024_lms.sql`.
- **Task 1.2 — Create package `@abm/lms-core` with the password module**: Created `packages/lms-core/package.json`, `packages/lms-core/tsconfig.json`, `packages/lms-core/src/password.ts` (unchanged body from `apps/crm/src/worker/password.ts`), `packages/lms-core/src/index.ts`, updated `apps/crm/src/worker/password.ts` and `apps/crm/package.json`, and ran `pnpm install`.
- **Task 1.3 — Access rules as a pure function**: Created `packages/lms-core/src/access.ts` and `packages/lms-core/src/access.test.ts`.
- **Task 1.4 — Register new guarded tables and test reset list**: Updated `apps/crm/src/worker/guarded-tx.ts` and `apps/crm/test/helpers/reset-db.ts`.
- **Task 1.5 — Contracts: input schemas and COMMANDS entries**: Added the 12 LMS command input schemas + exported types and extended `importContractLearnersInput` with `classId: id.optional()` in `packages/contracts/src/index.ts`. Stopped on Verify failure per Hard Rules / Failure Protocol.

## Files Created / Modified

- Created: `apps/crm/migrations/0024_lms.sql`
- Created: `packages/lms-core/package.json`
- Created: `packages/lms-core/tsconfig.json`
- Created: `packages/lms-core/src/index.ts`
- Created: `packages/lms-core/src/password.ts`
- Created: `packages/lms-core/src/access.ts`
- Created: `packages/lms-core/src/access.test.ts`
- Modified: `apps/crm/src/worker/password.ts`
- Modified: `apps/crm/package.json`
- Modified: `apps/crm/src/worker/guarded-tx.ts`
- Modified: `apps/crm/test/helpers/reset-db.ts`
- Modified: `packages/contracts/src/index.ts`
- Modified: `pnpm-lock.yaml`

## Verify Commands & Results

1. **Task 1.2 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output:
     ```
     $ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
     ```

2. **Task 1.3 Verify**: `pnpm --filter @abm/lms-core test`
   - Result: PASS (exit code 0, `7 passed`)
   - Output:
     ```
     $ vitest run

      RUN  v4.1.11 D:/TQD/CRM/packages/lms-core

      ✓ src/access.test.ts (7 tests) 5ms

      Test Files  1 passed (1)
           Tests  7 passed (7)
     ```

3. **Task 1.4 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output:
     ```
     $ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
     ```

4. **Task 1.5 Verify**: `pnpm -r typecheck`
   - Task ID: `Task 1.5`
   - Pass condition failed: `pnpm -r typecheck` exits 0
   - Result: FAIL (exit code 1 in `packages/lms-core` typecheck)
   - Exact command: `pnpm -r typecheck`
   - Full output:
     ```
     packages/contracts typecheck$ tsc --noEmit
     packages/lms-core typecheck$ tsc --noEmit
     poc/d1-guard typecheck$ tsc --noEmit
     poc/goclaw-identity typecheck$ tsc --noEmit
     packages/lms-core typecheck: src/password.ts(25,82): error TS2322: Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'BufferSource'.
     packages/lms-core typecheck:   Type 'Uint8Array<ArrayBufferLike>' is not assignable to type 'ArrayBufferView<ArrayBuffer>'.
     packages/lms-core typecheck:     Types of property 'buffer' are incompatible.
     packages/lms-core typecheck:       Type 'ArrayBufferLike' is not assignable to type 'ArrayBuffer'.
     packages/lms-core typecheck:         Type 'SharedArrayBuffer' is not assignable to type 'ArrayBuffer'.
     packages/lms-core typecheck:           Types of property '[Symbol.toStringTag]' are incompatible.
     packages/lms-core typecheck:             Type '"SharedArrayBuffer"' is not assignable to type '"ArrayBuffer"'.
     packages/lms-core typecheck: Failed
     [ELIFECYCLE] Command failed with exit code 1.
     poc/d1-guard typecheck: Done
     poc/goclaw-identity typecheck: Failed
     [ELIFECYCLE] Command failed with exit code 1.
     packages/contracts typecheck: Failed
     [ELIFECYCLE] Command failed with exit code 1.
     Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL

       × "pnpm recursive run" failed in D:\TQD\CRM\packages\lms-core
     ```

## Continuation (Tasks 1.6–1.7)

- **Task 1.6 — Schema test**: Created `apps/crm/test/lms-schema.test.ts` covering `learner_account` password null/check constraints, `lms_program` `class_id` uniqueness (and multiple NULL `class_id` rows), `lms_lesson` `(program_id, section_id)` uniqueness, and `org_setting.learner_default_password_hash`.
- **Task 1.7 — Full regression**: Verified workspace-wide typecheck and full test suite.

### Verify Commands & Results

1. **Task 1.6 Verify** (from `D:\TQD\CRM\apps\crm`): `pnpm test test/lms-schema.test.ts`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 1 passed (1)`, `Tests 5 passed (5)`
   - Output:
     ```
     $ vitest run "test/lms-schema.test.ts"

      RUN  v4.1.11 D:/TQD/CRM/apps/crm

      ✓ test/lms-schema.test.ts (5 tests) 400ms

      Test Files  1 passed (1)
           Tests  5 passed (5)
     ```

2. **Task 1.7 Verify (typecheck)** (from `D:\TQD\CRM`): `pnpm -r typecheck`
   - Result: PASS (exit code 0)
   - Output:
     ```
     packages/contracts typecheck$ tsc --noEmit
     packages/lms-core typecheck$ tsc --noEmit
     poc/goclaw-identity typecheck$ tsc --noEmit
     poc/d1-guard typecheck$ tsc --noEmit
     packages/lms-core typecheck: Done
     poc/d1-guard typecheck: Done
     packages/contracts typecheck: Done
     apps/zalo-bridge typecheck$ tsc --noEmit
     apps/crm typecheck$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit
     apps/zalo-bridge typecheck: Done
     poc/goclaw-identity typecheck: Done
     apps/crm typecheck: Done
     ```

3. **Task 1.7 Verify (test)** (from `D:\TQD\CRM`): `pnpm -r test`
   - Result: PASS (exit code 0)
   - Test counts:
     - `packages/lms-core`: 1 test file passed, `7 passed (7)`
     - `apps/zalo-bridge`: 9 test files passed, `114 passed (114)`
     - `poc/goclaw-identity`: 1 test file passed, `8 passed (8)`
     - `poc/d1-guard`: 1 test file passed, `8 passed (8)`
     - `apps/crm`: 45 test files passed | 1 skipped (46), `571 passed | 2 skipped (573)` (up from 566 before this plan)

Status: DONE
