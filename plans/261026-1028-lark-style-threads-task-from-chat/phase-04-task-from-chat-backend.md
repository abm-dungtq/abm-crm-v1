---
phase: 4
title: "Task from chat: source link, manual draft, task card, notifications (backend)"
status: pending
priority: P1
effort: "1d"
dependencies: [3]
---

# Phase 04: Task from chat (backend, manual path)

## Goal
"Tạo việc từ tin này" and "Tạo việc từ chuỗi" work end to end on the server **without the agent**, and phase 05 reuses the same pieces for the agent draft:
1. `POST /api/chat/conversations/:id/task-drafts { messageId, scope }` returns a manual draft: title, description, members and source, built from the message or the thread text.
2. `createTask` accepts `source` (and optionally the agent `draft` reference). It validates that the actor can read the source, stores `task.source_*`, adds the `task_member` rows, and marks the draft as used in the same batch. A draft can be used only once.
3. After the commit:
   - The assignee gets `task_assigned` as today.
   - Members get `task_assigned` "… thêm bạn vào việc". This applies to every new task with members, not only ones from chat.
   - A system **task card** message is posted back. For `scope 'thread'` it goes into the thread. For `scope 'message'` it is a quote reply to the source message, inside that message's thread when the source is a thread reply.
4. `GET /api/tasks/:id` returns `source` with `canOpen`, so task detail can show "Tạo từ chat".

Proves acceptance criteria 9 (manual path, once-only, card, notifications) and 11 (server side).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Work from `D:\TQD\CRM`; PowerShell; `pnpm` on PATH.
- Tasks are still created only through `runCommand('createTask')` (audit, idempotency, outbox). The chat routes never insert into `task` themselves.
- An agent actor (`actor.kind === 'agent'`, MCP) may not pass `source` or `draft`; reject with 422. The MCP `create_task` mapping does not pass them anyway.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26)
- `createTaskInput` is at `packages/contracts/src/index.ts:323-334` (refines at 333-334). Its command entry is at line ~775.
- `createTask` handler: `apps/crm/src/worker/commands.ts:593-640`. It calls `tx.insertVersioned('task', row)` (row keys are the column names), `tx.raw` for `task_member`, and `tx.event('task.created', { taskId, assigneeUserId })`.
- `GuardedTx.assert(condition, binds)` fails the whole batch when the condition is false (`guarded-tx.ts:68-70`). `tx.raw` appends a statement as-is (`guarded-tx.ts:60-62`).
- `notifyCommitted(c)`: `apps/crm/src/worker/approval-notify.ts:23-83`. It handles `task.created`/`task.assigned` and notifies the assignee. The web posts `POST /api/commands/createTask` (`index.ts:316-320`, with `onCommitted = notifyCommitted(c)`). MCP passes its own `onCommitted` (`mcp-tools.ts:318`).
- `taskDetail`: `apps/crm/src/worker/queries.ts:258-282`. `TASK_SELECT` is at `queries.ts:188`.
- Thread helpers from phase 02: `validateThreadTarget`, `afterThreadMessage` and `insertMessage`.

## Files to Create / Modify
- Modify: `packages/contracts/src/index.ts` (`createTaskInput` only)
- Modify: `apps/crm/src/worker/commands.ts` (`createTask` only), `apps/crm/src/worker/approval-notify.ts`, `apps/crm/src/worker/queries.ts` (`TASK_SELECT`, `taskDetail`), `apps/crm/src/worker/chat-routes.ts` (task-drafts route)
- Create: `apps/crm/src/worker/chat-tasks.ts`
- Create: `apps/crm/test/chat-task-from-chat.test.ts`
- Modify: `apps/crm/test/approval-notify.test.ts` only if an existing assertion counted notifications for a task created with members

## Tasks

### Task 4.1 — Contract
- Target: `packages/contracts/src/index.ts`.
- Steps: add to `createTaskInput`:

```ts
source: z.object({
  conversationId: z.string().min(1).max(120),
  messageId: z.string().min(1).max(64),
  scope: z.enum(['message', 'thread']),
}).optional(),
draft: z.object({ messageId: z.string().min(1).max(64), index: z.number().int().min(0).max(2) }).optional(),
```

  Add two refines: `draft` requires `source` (path `draft`, message `'Thiếu nguồn của việc nháp'`), and `source` requires `kind === 'internal'` (path `source`, message `'Việc tạo từ chat là việc nội bộ'`).
- Verify: `pnpm -r typecheck` exits 0.

### Task 4.2 — createTask with source and draft
- Target: `commands.ts` (`createTask`).
- Steps (only when `input.source` is set):
  1. `actor.kind === 'agent'` → 422 `'Agent không tạo việc từ chat'`.
  2. Load the source with ONE query:

     ```sql
     SELECT m.id, m.thread_root_id, m.deleted_at, c.kind, c.organization_id
     FROM chat_message m
     JOIN chat_conversation c ON c.id = m.conversation_id
     JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = ?
     WHERE m.id = ? AND m.conversation_id = ? AND c.archived_at IS NULL
     ```

     Fail with 404 `'Không tìm thấy tin nguồn trong phạm vi của bạn'` when:
     - there is no row,
     - the conversation is in another organization,
     - `kind` is not `group`/`direct`,
     - the message is deleted,
     - `scope 'thread'` and `thread_root_id IS NOT NULL`.
  3. When `input.draft` is set, load `SELECT author_kind, conversation_id, meta_json FROM chat_message WHERE id = ?`. Require `author_kind = 'agent'`, the same conversation, `meta.requestedByUserId === actor.id`, that `meta.taskDrafts[index]` exists with `createdTaskId` null, and that `input.source` equals the draft's stored `source` (same conversation, message and scope). Otherwise return 422 `'Việc nháp không còn dùng được'`. Then, with `path = '$.taskDrafts[' + index + '].createdTaskId'` (index is a validated integer):
     - `tx.assert('SELECT json_extract(meta_json, ?) IS NULL FROM chat_message WHERE id = ?', [path, draft.messageId])`
     - `tx.raw(db.prepare('UPDATE chat_message SET meta_json = json_set(meta_json, ?, ?) WHERE id = ?').bind(path, taskId, draft.messageId))`

     A second create from the same draft fails the batch, and `runCommand` returns `STALE_VERSION`. The route maps that to 409, and the web shows "Việc nháp đã được tạo".
  4. Add `source_conversation_id`, `source_message_id` and `source_scope` to `row`, set to NULL when there is no source.
  5. `tx.event('task.created', { taskId, assigneeUserId, memberUserIds, source: input.source ?? null })`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.3 — Task card and manual draft
- Target: `apps/crm/src/worker/chat-tasks.ts` (new).
- Steps: export
  1. `buildManualTaskDraft(db, conversation, { messageId, scope }, actorId)`. The caller has already checked access.
     - `scope 'message'`: one query for the message, its author name and `mentions_json`.
     - `scope 'thread'`: one query for the root plus the newest 50 replies (not deleted), oldest first.
     - `title`: the first non-empty line of the rendered text (`renderMentionText`) of the message or the root. Cut it at 200 characters on a word boundary and add `…` when cut.
     - `description`:
       - message scope: the rendered text.
       - thread scope: one line per message, `HH:mm DD/MM Tên: nội dung` in Asia/Saigon time. Use the existing date helper in `queries.ts` (`vnDate`) or `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Saigon' })`. Total at most 5000 characters; when longer, keep the root and the newest lines and put `…` after the root.
     - `memberUserIds`: the users mentioned in those messages that are still conversation members, excluding the actor, at most 20.
     - `assigneeUserId`: null. `dueDate`: null.
     - `source`: `{ conversationId, messageId, scope }`.
  2. `postTaskCard(sink, db, actor, { taskId, title, assigneeName, dueAt, source })`:
     - message id `task-card:<taskId>`, `authorKind 'system'`, body `Đã tạo việc: <title>`.
     - meta `{ taskCard: { taskId, title, assigneeName, dueAt, createdByName: actor.displayName } }`.
     - Placement:
       - `scope 'thread'`: `threadRootId = source.messageId`.
       - `scope 'message'`: `replyToMessageId = source.messageId`, plus `threadRootId = <source's thread_root_id>` when the source is a thread reply.
     - After `insertMessage`, a thread placement calls `afterThreadMessage` (no notifications). A main-flow placement publishes `message.created` to members.
     - It never throws. Log only the task id on failure.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.4 — After commit: notifications and card
- Target: `approval-notify.ts`.
- Steps: in the `task.created` branch, keep the assignee notification. Then:
  1. Notify `payload.memberUserIds` minus the actor and minus the assignee. Kind `task_assigned`, title `${actor.displayName} thêm bạn vào việc`, body = task title, link `/tasks/<id>`, dedupe `task-member:<taskId>` (`notify` appends the user id).
  2. When `payload.source` is set, load `SELECT tk.title, tk.due_at, u.display_name FROM task tk JOIN app_user u ON u.id = tk.assignee_user_id WHERE tk.id = ?`. Reuse the title query that already exists in this branch so it stays one query. Then call `postTaskCard`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.5 — Draft route and task detail source
- Target: `chat-routes.ts`, `queries.ts`.
- Steps:
  1. `POST /conversations/:id/task-drafts { messageId, scope }`:
     - Run `loadConversation`. The kind must be `group` or `direct`; otherwise 422 `'Chỉ tạo việc từ chat nhóm hoặc chat riêng'`.
     - The message must be in the conversation and not deleted.
     - For `scope 'thread'`, the message must be top-level.
     - It returns `{ mode: 'manual', draft }` from `buildManualTaskDraft`. Phase 05 adds `mode: 'agent'` to this same route.
  2. `TASK_SELECT` adds `tk.source_conversation_id, tk.source_message_id, tk.source_scope`. `taskDetail` adds:

     ```ts
     source: { conversationId, messageId, scope, conversationTitle: string | null, canOpen: boolean } | null
     ```

     `canOpen` means the actor is a `chat_member` of that conversation and the conversation is not archived. Get it with one statement added to the existing `Promise.all` (title via `conversationTitleSql`, or `c.title` for groups). When `canOpen` is false, `conversationTitle` is null so nothing about the group leaks.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 4.6 — Tests
- Target: `apps/crm/test/chat-task-from-chat.test.ts` (new; harness from `chat.test.ts:1-35`, `command()` helper included).
- Steps:
  1. Manual draft from a message: `u-lan` posts `Gửi báo giá cho @[Hùng](user:u-hung) trước thứ 6` in group G. `POST task-drafts {scope:'message'}` returns `mode 'manual'`, a title starting `Gửi báo giá`, `memberUserIds = ['u-hung']` and the right source.
  2. Manual draft from a thread: the root plus 3 replies give a description with 4 timestamped lines and the root first.
  3. Creating with source:
     - `command('u-lan', 'createTask', { kind:'internal', title, assigneeUserId:'u-long', memberUserIds:['u-hung','u-mai'], source })` returns 200.
     - The task row has `source_*`, and there are 2 `task_member` rows.
     - `u-long` has a `task_assigned` "giao việc"; `u-hung` and `u-mai` have "thêm bạn vào việc".
     - Message `task-card:<id>` exists with `reply_to_message_id = source` (message scope).
     - For thread scope, the card has `thread_root_id = root` and the thread `reply_count` went up.
  4. Access: `u-huy` (not in G) creating with G's source returns 404. Source with `kind 'crm'` returns 422.
  5. Once-only draft:
     - Insert an agent message directly with `meta_json` = `{"requestedByUserId":"u-lan","taskDrafts":[{"title":"X","createdTaskId":null}]}`.
     - The first create with `draft {messageId, index:0}` succeeds and sets `createdTaskId`.
     - A second create (new Idempotency-Key) returns 409 `STALE_VERSION`, and no second task exists.
     - `u-long` using the draft returns 422.
  6. `GET /tasks/<id>`:
     - As `u-lan`: `source.canOpen = true`, with the group title.
     - As director `u-bgd`, who can see internal tasks org-wide but is not in G: `canOpen = false`, `conversationTitle = null`.
  7. A plain `createTask` without source but with members notifies the members (shows the decision applies to every task) and posts no card.
  8. Using a draft with a `source` different from the draft's stored source returns 422.
  9. Budget: with the counting wrapper from `notifications.test.ts:517-531` and a stub `CHAT_HUB`, create a task with a thread source, 20 members (seed extra users if needed) and 2 push subscriptions each. Assert `d1 <= 40`, `pushes <= 25` and `hubCalls + pushes <= 40`, and log `console.log('task_budget', …)`.
- Verify: `pnpm --filter @abm/crm test -- chat-task-from-chat.test.ts task-engine.test.ts approval-notify.test.ts` exits 0, then `pnpm -r typecheck` and `pnpm --filter @abm/crm test` both exit 0.

## Success criteria
- Tasks created from chat carry their source, notify the assignee and the members, post exactly one card in the right place, and a draft can be used only once.

## Risk
- **Card shows the task title to group members who cannot open the task** (medium likelihood, low impact). The card holds only the title, the assignee name and the due date, all drawn from that same chat. `/tasks/:id` still enforces `canSeeTask`.
- **Notifying members of every task is a small behavior change.** It is recorded as an open question in `plan.md`. Revert by limiting the member notify to `payload.source != null`.
- **A replay of the command does not run `onCommitted`, so the card is not posted again.** That is intended: the card id is fixed (`task-card:<taskId>`), so the card exists once.

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
