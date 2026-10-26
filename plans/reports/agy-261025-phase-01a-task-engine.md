# Phase 01a Report — Task Engine Backend (Tasks 1.1–1.8)

## Tasks Completed
- **Task 1.1 — Write migration 0025**: Created `apps/crm/migrations/0025_task_engine.sql` with exact SQL rebuilding `task` and adding `task_member`, `chat_conversation`, `chat_member`, and `chat_message`.
- **Task 1.2 — Register the new tables in the test reset list**: Inserted `'chat_message', 'chat_member', 'chat_conversation', 'task_member'` directly before `'task'` in `apps/crm/test/helpers/reset-db.ts`.
- **Task 1.3 — Contracts for the new task commands**: Added `TASK_PRIORITIES`, `createTaskInput`, `updateTaskInput`, `cancelTaskInput` (and inferred types) and registered `createTask`, `updateTask`, `cancelTask` alongside `completeTask` (expanded to `ROLE_CODES`) in `packages/contracts/src/index.ts`.
- **Task 1.4 — Task visibility helper**: Created `apps/crm/src/worker/task-scope.ts` with `internalTaskScope`, `taskScope`, and `canSeeTask`, and imported `taskScope` / `canSeeTask` into `apps/crm/src/worker/queries.ts`.
- **Task 1.5 — List and detail queries**: Extended `listTasks` (LEFT JOIN lead/contact, new fields, `in_progress` status, `mine` filter, `'nodue'` bucket), added `taskDetail` and `directory` in `apps/crm/src/worker/queries.ts`, updated `GET /tasks` and added `GET /tasks/:id` and `GET /directory` in `apps/crm/src/worker/index.ts`, and updated `complete_task` scope lookup in `apps/crm/src/worker/mcp-tools.ts`.
- **Task 1.6 — Command handlers**: Added `'task_member'` to `GuardedTable` in `apps/crm/src/worker/guarded-tx.ts`; extended `TaskRow` and `completeTask` for internal tasks and implemented `createTask`, `updateTask`, and `cancelTask` in `apps/crm/src/worker/commands.ts`.
- **Task 1.7 — Shared chat store and task comments**: Created `apps/crm/src/worker/chat.ts` (`ensureTaskConversation`, `listMessages`, `insertMessage`, `markRead`, `parseMentions`) and mounted `GET /tasks/:id/comments`, `POST /tasks/:id/comments`, and `POST /tasks/:id/comments/read` in `apps/crm/src/worker/index.ts`.
- **Task 1.8 — Tests**: Created `apps/crm/test/task-engine.test.ts` with 7 tests covering internal task visibility, status transitions (`open` -> `in_progress` -> `completed`), CRM task `in_progress` rejection in both command and SQLite `CHECK`, Forced Next Action preservation, CRM `cancelTask` rejection, idempotent task comments + access control, and subtasks.

## Files Changed
- Created: `apps/crm/migrations/0025_task_engine.sql`
- Created: `apps/crm/src/worker/task-scope.ts`
- Created: `apps/crm/src/worker/chat.ts`
- Created: `apps/crm/test/task-engine.test.ts`
- Modified: `apps/crm/test/helpers/reset-db.ts`
- Modified: `packages/contracts/src/index.ts`
- Modified: `apps/crm/src/worker/guarded-tx.ts`
- Modified: `apps/crm/src/worker/queries.ts`
- Modified: `apps/crm/src/worker/commands.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Modified: `apps/crm/src/worker/mcp-tools.ts`

## Verification Commands & Results
1. **Task 1.2 Verify**: `pnpm --filter @abm/crm test -- commands.test.ts`
   - Exit code: `0`
   - Key output: `Test Files 2 passed (2) | Tests 50 passed (50)`
2. **Task 1.3 Verify**: `pnpm --filter @abm/contracts typecheck`
   - Exit code: `0`
   - Key output: `$ tsc --noEmit` (clean)
3. **Task 1.4 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit` (clean)
4. **Task 1.5 & 1.6 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit` (clean)
5. **Task 1.7 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit` (clean)
6. **Task 1.8 Verify**: `pnpm --filter @abm/crm test -- task-engine.test.ts`
   - Exit code: `0`
   - Key output: `✓ test/task-engine.test.ts (7 tests) 534ms`
7. **Final Check — Typecheck**: `pnpm -r typecheck`
   - Exit code: `0`
   - Key output: `apps/crm typecheck: Done` (all workspace packages passed)
8. **Final Check — Full Test Suite**: `pnpm --filter @abm/crm test`
   - Exit code: `0`
   - Key output: `Test Files 51 passed | 1 skipped (52) | Tests 628 passed | 2 skipped (630)`

## Notes / Uncertainties
- None. Task 1.9 (web UI) was intentionally left untouched per `brief-01a.md`.

Status: DONE
Summary: Implemented the Phase 01 backend task engine (migration 0025, task scope, list/detail queries, create/update/cancel/complete commands, shared chat store for task comments, and 7 integration tests). All workspace typechecks and the full 628-test CRM suite pass with exit code 0.
Concerns/Blockers: none
