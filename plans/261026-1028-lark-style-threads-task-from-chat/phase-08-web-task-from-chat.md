---
phase: 8
title: "Web: task from chat, draft card, task card, \"Tạo từ chat\" link"
status: pending
priority: P1
effort: "1d"
dependencies: [5, 7]
---

# Phase 08: Web task from chat

## Goal
1. **Actions.**
   - The message menu adds **Tạo việc từ tin này** on group and direct messages (not deleted, not in task comments, not on task cards).
   - The thread panel header and the topic card add **Tạo việc từ chuỗi**.
   - Each action calls `POST /chat/conversations/:id/task-drafts { messageId, scope }`:
     - `mode 'manual'`: open `TaskFormDialog` prefilled with the draft (title, description, members, source).
     - `mode 'agent'`: show a toast "Trợ lý đang soạn việc…". The draft card appears in place through the socket, and the existing "Trợ lý đang trả lời…" hint is shown in that place.
2. **Draft card** (`meta.taskDrafts`). It shows the title, the description (clamped, with "Xem thêm"), **Người làm** (name, or the raw name in a warning chip when unresolved), **Người liên quan** (chips, unresolved ones in warning style) and **Hạn**.
   - The requester sees **Sửa và tạo việc**. It opens `TaskFormDialog` with every field prefilled, and with the hint "Chưa khớp tên: @A, @B. Chọn lại người trong danh sách." when names are unresolved.
   - After creation, the card shows **Đã tạo việc · Mở việc**.
   - Everyone else sees "Trợ lý đề xuất việc · chờ <tên người yêu cầu> xác nhận".
3. **Agent could not draft** (`meta.taskDraftFailed`). The requester sees **Tự tạo việc**, which calls `/task-drafts` with the same source and `prefer: 'manual'` (phase 05), then opens the manual dialog.
4. **Task card** (`meta.taskCard`). It shows a compact card with a task icon, the title, the assignee, the due date (`DD/MM HH:mm`, Asia/Saigon) and **Mở việc**, which goes to `/tasks/<id>`. Opening a task the viewer cannot see shows the normal not-found page.
5. **Task detail.** When `task.source` is set, a row **Tạo từ chat** appears in the info list. With `canOpen` it is a link to `chatLink({ conversationId, threadRootId: source.scope === 'thread' ? source.messageId : undefined, messageId: source.scope === 'message' ? source.messageId : undefined })`, showing the conversation title. Without `canOpen` it shows the text "Tạo từ chat (bạn không ở trong hội thoại này)".
6. Legacy `meta.taskSuggestions` cards keep working (from phase 06).

Proves acceptance criteria 9 and 11 (UI side).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Reuse the existing classes and the `chat-*` classes. New classes go in the `chat:` section of `styles.css`.
- Tasks are created only through the existing `useCommand('createTask')` in `TaskFormDialog`.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26)
- `components/task-form-dialog.tsx`:
  - `TaskFormInitialValues { title?, assigneeUserId?, due? }` is at lines 54-58.
  - The open-reset effect (lines 96-111) resets description and members to empty.
  - `submit` (lines 155-183) builds `CreateTaskInput` and uses `fromLocalInput(due)`.
  - `useCommand('createTask')` is at line 91.
- `components/chat-thread.tsx:782-790` today passes the legacy suggestion to `TaskFormDialog` with the due time `T09:00`. This moves to `chat-message-item.tsx` in phase 06.
- `pages/task-detail.tsx`: the info list (`dd` "createdBy" at ~line 535) and the parent link at ~lines 171-176 show the pattern for a linked row.
- API:
  - phase 04: `POST /task-drafts` returns `{mode, draft}`; `createTask` accepts `source` and `draft`; `GET /tasks/:id` returns `source`.
  - phase 05: `meta.taskDrafts`, `meta.taskDraftFailed` and the agent mode.

## Files to Create / Modify
- Create: `apps/crm/src/web/components/chat-task-cards.tsx`, with the draft card, the task card and the failed-draft button.
- Modify:
  - `apps/crm/src/web/components/task-form-dialog.tsx`
  - `apps/crm/src/web/components/chat-message-item.tsx`: the menu item and the card rendering.
  - `apps/crm/src/web/components/chat-thread-panel.tsx`: "Tạo việc từ chuỗi".
  - `apps/crm/src/web/components/chat-topic-list.tsx`: the topic card action.
  - `apps/crm/src/web/pages/task-detail.tsx`
  - `apps/crm/src/web/types.ts`
  - `apps/crm/src/web/styles.css`
- Modify: `apps/crm/test/web-chat.test.ts`

## Tasks

### Task 8.1 — Task form takes a full draft
- Target: `task-form-dialog.tsx`, `types.ts`.
- Steps:
  1. `TaskFormInitialValues` gains `description?`, `memberUserIds?: string[]`, `unresolvedNames?: string[]`, `source?: { conversationId; messageId; scope }` and `draft?: { messageId; index }`. The open-reset effect applies `description` and `memberUserIds` (filtered to active directory users) when given.
  2. When `source` is set:
     - `kind` is fixed to `internal`, and the CRM option is hidden.
     - `submit` adds `source` and `draft` to the command input.
     - A small line "Tạo từ chat · việc sẽ được gửi lại vào chuỗi/tin gốc" is shown.
  3. Error `STALE_VERSION` or 409 on a draft shows the toast "Việc nháp này đã được tạo" and closes the dialog.
  4. Pure helper in `chat-task-cards.tsx`, or a small `src/web/chat-task-draft.ts` if a pure import is needed by the tests: `draftToInitialValues(draft, messageId, index)` maps a `TaskDraft` or manual draft to `TaskFormInitialValues`, with `due = dueDate ? dueDate + 'T09:00' : null` (same default hour as today).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 8.2 — Actions and cards
- Target: `chat-message-item.tsx`, `chat-thread-panel.tsx`, `chat-topic-list.tsx`, `chat-task-cards.tsx`.
- Steps:
  1. Menu item **Tạo việc từ tin này** calls `requestTaskDraft({ conversationId, messageId, scope: 'message' })`. It is one shared function in `chat-task-cards.tsx` that handles both modes: it opens the dialog or shows the toast.
  2. **Tạo việc từ chuỗi** in the thread panel header and on topic cards calls `scope: 'thread'` with the root id.
  3. Render `DraftCard` for each entry of `meta.taskDrafts`, only on messages with `authorKind === 'agent'` (the server sets `meta`; user messages never get a draft card):
     - The requester is `meta.requestedByUserId === actor.id`.
     - The created state comes from `draft.createdTaskId`, with **Mở việc** linking to `/tasks/<createdTaskId>`.
     - A draft with `source === null` hides the button.
  4. Render `TaskCard` for `meta.taskCard`, and `FailedDraft` for `meta.taskDraftFailed` (requester only).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 8.3 — Task detail link
- Target: `pages/task-detail.tsx`, `types.ts` (`TaskDetail.source`).
- Steps: add the **Tạo từ chat** row as described in the Goal, using `chatLink` from phase 06 and the `Link` component as for the parent task.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 8.4 — Tests and build
- Target: `apps/crm/test/web-chat.test.ts`.
- Steps: test
  - `draftToInitialValues`: the date gets `T09:00`, null due stays null, members and unresolved names pass through, and source and draft are set.
  - The task-detail link builder: the thread scope gives `?thread=`, and the message scope gives `?message=`.
- Verify:
  1. `pnpm --filter @abm/crm test -- web-chat.test.ts` exits 0.
  2. `pnpm --filter @abm/crm typecheck` exits 0.
  3. `pnpm --filter @abm/crm build` exits 0.
  4. `pnpm -r test` exits 0.

## Success criteria
- Both entry points open a draft (agent or manual). The requester-only controls hold. The created state shows. The task links back to the chat. All gates are green.

## Risk
- **Unresolved names could be submitted as nobody.** The dialog requires an assignee (existing `canSubmit`), and unresolved names are only hints, never sent.
- **Agent mode feels slow.** The toast plus the thinking hint tell the user it is working, and the manual fallback stays one click away through the failed-draft card or a second request with `prefer: 'manual'`. Mention this in the user guide (phase 09).

## Rollback
Opus only, from the snapshot diff: Opus restores the files changed by this run from the pre-run snapshot tree and deletes the files it created. Executors never run git commands that change the work tree or index.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to Opus with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Wait for Opus's instruction before doing anything else.
