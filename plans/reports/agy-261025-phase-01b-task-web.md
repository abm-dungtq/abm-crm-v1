# Phase 01b Report — Task Engine Web UI (Task 1.9)

## Tasks Completed
- **Task 1.9 — Web: create dialog, detail page, Kanban**:
  1. Installed `@dnd-kit/core@^6.3.1` and `@dnd-kit/sortable@^10.0.0` in `apps/crm`.
  2. Extended `TaskItem` in `apps/crm/src/web/types.ts` with `kind`, `priority`, `description`, `parentTaskId`, nullable `dueAt`, nullable `lead`, and `'nodue'` bucket, and added `TaskPriority`, `TaskDetail`, `DirectoryUser`, and `ChatMessage` types.
  3. Created `apps/crm/src/web/components/task-form-dialog.tsx` supporting both internal tasks and CRM tasks (with active lead search via `/leads?status=active&q=...`), title, description, priority, due date with quick-pick chips, assignee and collaborators from `/directory`, and optional `parentTask` for subtasks, submitting `createTask` via `useCommand`.
  4. Updated `apps/crm/src/web/pages/tasks.tsx` with the "Tạo việc" button, "Danh sách | Kanban" view toggle (`?view=list|board`), `?status=completed` tab (with backward compatibility for `?view=completed`), priority badge, "Việc nội bộ" label when `lead` is null, task title links to `/tasks/$taskId`, while preserving the existing "Việc của tôi" grouping and `CompleteTaskDialog`.
  5. Created `apps/crm/src/web/components/task-board.tsx` with three Kanban columns (`Cần làm`, `Đang làm`, `Xong` last 50) using `@dnd-kit`, updating internal tasks via `updateTask` / `completeTask`, blocking CRM tasks from entering `Đang làm` with toast `"Việc gắn lead chỉ có Cần làm và Xong"`, and opening `CompleteTaskDialog` when a CRM task is dropped on `Xong`.
  6. Created `apps/crm/src/web/components/chat-thread.tsx` accepting `{ listPath, postPath, readPath }`, rendering messages oldest at top, handling Enter-to-send / Shift+Enter-for-newline with client `crypto.randomUUID()` ids, optimistic append, `refetchInterval: 10000`, and calling `readPath` 2 seconds after the newest message is visible.
  7. Created `apps/crm/src/web/pages/task-detail.tsx` with inline editing (`updateTask`), status toggle, `CompleteTaskDialog`, `cancelTask`, collaborators management, subtasks list with "Thêm việc con", lead link card when present, and `<ChatThread>` on `/tasks/:id/comments`.
  8. Updated `apps/crm/src/web/router.tsx` to extend `/tasks` `validateSearch` and register `/tasks/$taskId`.

## Files Changed
- Modified: `apps/crm/package.json`
- Modified: `pnpm-lock.yaml`
- Modified: `apps/crm/src/web/types.ts`
- Modified: `apps/crm/src/web/pages/tasks.tsx`
- Modified: `apps/crm/src/web/router.tsx`
- Created: `apps/crm/src/web/components/task-form-dialog.tsx`
- Created: `apps/crm/src/web/components/task-board.tsx`
- Created: `apps/crm/src/web/components/chat-thread.tsx`
- Created: `apps/crm/src/web/pages/task-detail.tsx`

## Verification Commands & Results
1. **Task 1.9 Verify — CRM Typecheck**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
2. **Final Check — Workspace Typecheck**: `pnpm -r typecheck`
   - Exit code: `0`
   - Key output: `apps/crm typecheck: Done` (all workspace packages passed)
3. **Final Check — CRM Test Suite**: `pnpm --filter @abm/crm test`
   - Exit code: `0`
   - Key output: `Test Files 51 passed | 1 skipped (52) | Tests 628 passed | 2 skipped (630)`
4. **Final Check — CRM Build**: `pnpm --filter @abm/crm build`
   - Exit code: `0`
   - Key output: `✓ built in 6.28s` (`dist/assets/index-VQJ6OyGc.js 895.57 kB`)

## Notes / Uncertainties
- None.

Status: DONE
Summary: Implemented the Phase 01 task engine web UI (`task-form-dialog.tsx`, `task-board.tsx`, `chat-thread.tsx`, `task-detail.tsx`, and updated `tasks.tsx`, `types.ts`, and `router.tsx`). All workspace typechecks, the 628-test CRM suite, and the production Vite build pass with exit code 0.
Concerns/Blockers: none
