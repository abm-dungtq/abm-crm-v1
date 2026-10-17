# Phase 03 Report: CRM — programs, videos, clone, publish API

## Tasks Executed

- **Task 3.1 — Signed content URLs (shared)**: Created `packages/lms-core/src/content-url.ts` (`signContentPath`, `verifyContentPath` using WebCrypto HMAC-SHA256 and constant-time `crypto.subtle.verify`), exported it from `packages/lms-core/src/index.ts`, and added unit tests in `packages/lms-core/src/content-url.test.ts`.
- **Task 3.2 — Bindings and config**: Added `LMS_CONTENT` R2 bucket binding (`abm-lms-content`) and `LMS_CONTENT_ORIGIN` / `STREAM_ACCOUNT_ID` vars to `apps/crm/wrangler.jsonc`, and declared `LMS_CONTENT`, `LMS_CONTENT_ORIGIN`, `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN?`, and `CONTENT_SIGNING_SECRET?` in `apps/crm/src/worker/env.ts`.
- **Task 3.3 — `publishProgram` and agent route**: Implemented `publishProgramInput` and `publishProgram` in `apps/crm/src/worker/lms-programs.ts` and the Hono sub-app `lmsPublishRoutes` in `apps/crm/src/worker/lms-publish-routes.ts` (`GET /classes`, `POST /programs`, `POST /videos`) with 4 MiB body limit, Bearer `agent_token` auth, `Origin` header rejection, academic/admin role check, and `AGENT_WRITES_OPEN` kill-switch guard. Mounted `/lms-publish` before `originGuard` in `apps/crm/src/worker/index.ts`.
- **Task 3.4 — Stream copy client**: Created `apps/crm/src/worker/stream.ts` exporting `streamCopyFromUrl` (`STREAM_NOT_CONFIGURED` / `STREAM_COPY_FAILED`).
- **Task 3.5 — Video commands**: Implemented `attachVideo`, `addLessonVideo`, `updateLessonVideo`, and `deleteLessonVideo` in `apps/crm/src/worker/lms-programs.ts`, registered them in `packages/contracts/src/index.ts` and `apps/crm/src/worker/commands.ts`, and threaded `env` into `Ctx` (`apps/crm/src/worker/command-result.ts`) and `runCommand` (`apps/crm/src/worker/commands.ts`, `apps/crm/src/worker/index.ts`) per Supervisor Amendment 1.
- **Task 3.6 — `updateLmsProgram`, `cloneLmsProgram`**: Implemented `updateLmsProgram` and `cloneLmsProgram` in `apps/crm/src/worker/lms-programs.ts`, including copying the source R2 content object to `programs/<newId>/v<source.content_version>.html` before the transaction per Supervisor Amendment 2, copying non-hidden lessons, and excluding videos.
- **Task 3.7 — Read endpoints**: Implemented `classProgram`, `listPrograms`, and `previewUrl` in `apps/crm/src/worker/lms-programs.ts` and mounted `GET /classes/:id/lms`, `GET /classes/:id/lms/preview-url`, and `GET /lms/programs` in `apps/crm/src/worker/index.ts`.
- **Task 3.8 — Tests**: Created `apps/crm/test/lms-programs.test.ts` covering all 9 test cases plus the R2 content copy assertion on `cloneLmsProgram`.
- **Task 3.9 — Regression and report**: Verified workspace-wide `pnpm -r typecheck` and `pnpm -r test`.

## Files Created / Modified

- Created: `packages/lms-core/src/content-url.ts`
- Modified: `packages/lms-core/src/index.ts`
- Created: `packages/lms-core/src/content-url.test.ts`
- Modified: `apps/crm/wrangler.jsonc`
- Modified: `apps/crm/src/worker/env.ts`
- Modified: `apps/crm/src/worker/command-result.ts`
- Created: `apps/crm/src/worker/stream.ts`
- Created: `apps/crm/src/worker/lms-programs.ts`
- Created: `apps/crm/src/worker/lms-publish-routes.ts`
- Modified: `packages/contracts/src/index.ts`
- Modified: `apps/crm/src/worker/commands.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Created: `apps/crm/test/lms-programs.test.ts`
- Created: `plans/reports/agy-261016-phase-03-crm-programs-videos-publish.md`

## Verify Commands & Results

1. **Task 3.1 Verify**: `pnpm --filter @abm/lms-core test`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 2 passed (2)`, `Tests 12 passed (12)`

2. **Task 3.2 Verify**: `pnpm --filter @abm/crm typecheck`
   - Result: PASS (exit code 0)
   - Output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`

3. **Task 3.8 Verify** (from `D:\TQD\CRM\apps\crm`): `pnpm test test/lms-programs.test.ts`
   - Result: PASS (exit code 0)
   - Test counts: `Test Files 1 passed (1)`, `Tests 9 passed (9)`

4. **Task 3.9 Verify (typecheck)** (from `D:\TQD\CRM`): `pnpm -r typecheck`
   - Result: PASS (exit code 0)
   - Output: All 6 workspace projects (`packages/contracts`, `packages/lms-core`, `poc/d1-guard`, `poc/goclaw-identity`, `apps/zalo-bridge`, `apps/crm`) typechecked cleanly.

5. **Task 3.9 Verify (test)** (from `D:\TQD\CRM`): `pnpm -r test`
   - Result: PASS (exit code 0)
   - Test counts:
     - `packages/lms-core`: `Test Files 2 passed (2)`, `Tests 12 passed (12)`
     - `apps/zalo-bridge`: `Test Files 9 passed (9)`, `Tests 114 passed (114)`
     - `poc/goclaw-identity`: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
     - `poc/d1-guard`: `Test Files 1 passed (1)`, `Tests 8 passed (8)`
     - `apps/crm`: `Test Files 47 passed | 1 skipped (48)`, `Tests 588 passed | 2 skipped (590)`

Status: DONE
