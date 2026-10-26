---
phase: 1
title: "Task engine, task comments, Kanban"
status: pending
priority: P1
effort: "2.5d"
dependencies: []
---

# Phase 01: Task engine, task comments, Kanban

## Goal
Tasks become a general Task Engine (PRD §19.2): CRM tasks tied to a lead plus internal tasks with no lead, priority, description, optional due date, collaborators, subtasks and an `in_progress` state for internal tasks. Every task has a comment thread stored in the new chat tables. The Tasks page gets a create dialog, a task detail page with comments, and a Kanban board. The Forced Next Action rule (an active lead always points at an open CRM task) keeps working unchanged.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.
- Workers Free limit: one request or cron run may use at most 50 D1 queries (a `db.batch` counts as one) and at most 50 subrequests (DO fetch, R2, push `fetch`). Batch writes; never loop `.run()` per row.
- Read each target file fully before editing it, and copy the local style (Hono routes, `ok()`/`fail()`, `tx.update`/`tx.insertVersioned`, `useApi`/`useCommand`).

## Files to Create / Modify
- Create: `apps/crm/migrations/0025_task_engine.sql`
- Create: `apps/crm/src/worker/chat.ts` (shared chat store helpers; phase 02 extends it)
- Create: `apps/crm/src/worker/task-scope.ts`
- Modify: `apps/crm/src/worker/queries.ts` (`taskScope`, `listTasks`, add `taskDetail`)
- Modify: `apps/crm/src/worker/commands.ts` (`TaskRow` type, `completeTask`, new handlers `createTask`, `updateTask`, `cancelTask`, handler map at lines ~66-70)
- Modify: `apps/crm/src/worker/guarded-tx.ts` (`GuardedTable` union: add `'task_member'`)
- Modify: `apps/crm/src/worker/index.ts` (routes `GET /tasks/:id`, `GET /tasks/:id/comments`, `POST /tasks/:id/comments`, `POST /tasks/:id/comments/read`; extend `GET /tasks`)
- Modify: `apps/crm/src/worker/mcp-tools.ts` (`my_tasks` output must not crash on internal tasks: `lead` may be null)
- Modify: `packages/contracts/src/index.ts` (schemas `createTaskInput`, `updateTaskInput`, `cancelTaskInput`; `COMMANDS` entries)
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES`)
- Modify: `apps/crm/package.json` (add `@dnd-kit/core` `^6.3.1`, `@dnd-kit/sortable` `^10.0.0`)
- Modify: `apps/crm/src/web/types.ts`, `apps/crm/src/web/pages/tasks.tsx`, `apps/crm/src/web/router.tsx`
- Create: `apps/crm/src/web/pages/task-detail.tsx`, `apps/crm/src/web/components/task-board.tsx`, `apps/crm/src/web/components/task-form-dialog.tsx`, `apps/crm/src/web/components/chat-thread.tsx`
- Create: `apps/crm/test/task-engine.test.ts`

## Tasks

### Task 1.1 — Write migration 0025
- Goal: D1 holds the extended `task` table, `task_member`, and the chat core tables.
- Target: `apps/crm/migrations/0025_task_engine.sql` (new).
- Steps: create the file with exactly this content:

```sql
-- Task engine (PRD 19.2): CRM tasks keep lead_id and due_at; internal tasks have no lead, may have no due
-- date and may be 'in_progress'. 'in_progress' is internal-only so every lead rule that reads
-- status = 'open' keeps working. SQLite cannot drop NOT NULL, so task is rebuilt like app_user in 0006.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE task_backup AS SELECT * FROM task;
DROP TABLE task;
CREATE TABLE task (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'crm' CHECK (kind IN ('crm', 'internal')),
  lead_id TEXT REFERENCES lead(id),
  parent_task_id TEXT REFERENCES task(id),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at TEXT,
  assignee_user_id TEXT NOT NULL REFERENCES app_user(id),
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  outcome TEXT,
  completed_at TEXT,
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  last_txn_id TEXT,
  CHECK (kind = 'internal' OR (lead_id IS NOT NULL AND due_at IS NOT NULL)),
  CHECK (kind = 'crm' OR lead_id IS NULL),
  CHECK (status <> 'in_progress' OR kind = 'internal')
);
INSERT INTO task (id, kind, lead_id, parent_task_id, title, description, priority, due_at, assignee_user_id, status,
  outcome, completed_at, created_by_user_id, created_at, updated_at, version, last_txn_id)
SELECT id, 'crm', lead_id, NULL, title, NULL, 'normal', due_at, assignee_user_id, status,
  outcome, completed_at, created_by_user_id, created_at, updated_at, version, last_txn_id
FROM task_backup;
DROP TABLE task_backup;
CREATE INDEX task_assignee ON task(assignee_user_id, status, due_at);
CREATE INDEX task_lead ON task(lead_id);
CREATE INDEX task_parent ON task(parent_task_id);

-- Collaborators: they see the task and its comments like the assignee does.
CREATE TABLE task_member (
  task_id TEXT NOT NULL REFERENCES task(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  added_at TEXT NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_member_user ON task_member(user_id);

-- Internal chat. D1 is the source of truth; the realtime hub (phase 02) only relays events.
-- kind 'task' is the comment thread of one task; 'direct' is a 1-1 chat keyed by the two sorted user ids.
CREATE TABLE chat_conversation (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organization(id),
  kind TEXT NOT NULL CHECK (kind IN ('group', 'direct', 'task')),
  title TEXT,
  task_id TEXT UNIQUE REFERENCES task(id),
  direct_key TEXT UNIQUE,
  system_key TEXT UNIQUE,
  -- Direct chats only: 0 hides the chat from every member's connected MCP agents.
  agent_readable INTEGER NOT NULL DEFAULT 1 CHECK (agent_readable IN (0, 1)),
  created_by_user_id TEXT REFERENCES app_user(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT,
  archived_at TEXT,
  CHECK ((kind = 'task') = (task_id IS NOT NULL)),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL))
);

CREATE TABLE chat_member (
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  user_id TEXT NOT NULL REFERENCES app_user(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX chat_member_user ON chat_member(user_id);

-- author_agent_id points at chat_agent (added in 0028); no FK so this migration stays independent.
CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent', 'system')),
  author_user_id TEXT REFERENCES app_user(id),
  author_agent_id TEXT,
  parent_message_id TEXT REFERENCES chat_message(id),
  body TEXT NOT NULL,
  mentions_json TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((author_kind = 'user') = (author_user_id IS NOT NULL))
);
CREATE INDEX chat_message_conversation ON chat_message(conversation_id, created_at);
```

- Success criteria: file exists with the content above.
- Verify: no verification needed (Task 1.2 runs the migrations through the test helper).

### Task 1.2 — Register the new tables in the test reset list
- Goal: `resetDb` empties the new tables without foreign key errors.
- Target: `apps/crm/test/helpers/reset-db.ts`, constant `TABLES`.
- Steps:
  1. In `TABLES`, directly before `'task'`, insert `'chat_message', 'chat_member', 'chat_conversation', 'task_member',`.
- Success criteria: the existing suite still passes on the rebuilt `task` table.
- Verify: `pnpm --filter @abm/crm test -- commands.test.ts` exits 0.

### Task 1.3 — Contracts for the new task commands
- Goal: zod schemas and `COMMANDS` entries for `createTask`, `updateTask`, `cancelTask`.
- Target: `packages/contracts/src/index.ts` (near `completeTaskInput` ~line 314 and `COMMANDS` ~line 740).
- Steps:
  1. Add:
     ```ts
     export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
     export const createTaskInput = z.object({
       kind: z.enum(['crm', 'internal']),
       leadId: z.string().min(1).optional(),
       parentTaskId: z.string().min(1).optional(),
       title: z.string().trim().min(1).max(200),
       description: z.string().trim().max(5000).optional(),
       priority: z.enum(TASK_PRIORITIES).default('normal'),
       dueAt: z.string().datetime().optional(),
       assigneeUserId: z.string().min(1),
       memberUserIds: z.array(z.string().min(1)).max(20).default([]),
     }).refine((v) => v.kind === 'internal' || (v.leadId && v.dueAt), { message: 'Việc CRM cần lead và hạn', path: ['leadId'] })
       .refine((v) => v.kind === 'crm' || !v.leadId, { message: 'Việc nội bộ không gắn lead', path: ['leadId'] });
     export const updateTaskInput = z.object({
       taskId: z.string().min(1),
       expectedVersion: z.number().int().positive(),
       title: z.string().trim().min(1).max(200).optional(),
       description: z.string().trim().max(5000).nullable().optional(),
       priority: z.enum(TASK_PRIORITIES).optional(),
       dueAt: z.string().datetime().nullable().optional(),
       assigneeUserId: z.string().min(1).optional(),
       status: z.enum(['open', 'in_progress']).optional(),
       memberUserIds: z.array(z.string().min(1)).max(20).optional(),
     });
     export const cancelTaskInput = z.object({ taskId: z.string().min(1), expectedVersion: z.number().int().positive(), reason: z.string().trim().max(500).optional() });
     export type CreateTaskInput = z.infer<typeof createTaskInput>;
     export type UpdateTaskInput = z.infer<typeof updateTaskInput>;
     export type CancelTaskInput = z.infer<typeof cancelTaskInput>;
     ```
  2. In `COMMANDS`, next to `completeTask`, add entries with the same shape as `completeTask`, `roles: ROLES` (every role; check the exported name of the role list near line 176 and use the full list), `riskLevel: 'low'`, `idempotent: true`, `agentNeedsApproval: false`; `expectedVersion: false` for `createTask`, `true` for the other two.
  3. In `completeTask`'s roles, also allow every role (internal tasks can belong to academic, teacher, accountant). Lead rules still come from `loadLead` scope.
- Success criteria: contracts compile.
- Verify: `pnpm --filter @abm/contracts typecheck` exits 0 (if the package has no `typecheck` script, run `pnpm -r typecheck` and expect exit 0).

### Task 1.4 — Task visibility helper
- Goal: one place decides who sees a task.
- Target: `apps/crm/src/worker/task-scope.ts` (new), `apps/crm/src/worker/queries.ts` (`taskScope`).
- Steps:
  1. Create `task-scope.ts` exporting `internalTaskScope(actor: Actor, a = 'tk'): SqlFragment`:
     - director/admin: `${a}.kind = 'internal' AND EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${a}.assignee_user_id AND au.organization_id = ?)` with `actor.organizationId`.
     - everyone: `${a}.created_by_user_id = ? OR ${a}.assignee_user_id = ? OR EXISTS (SELECT 1 FROM task_member m WHERE m.task_id = ${a}.id AND m.user_id = ?)`.
     - leader additionally: `OR EXISTS (SELECT 1 FROM app_user au WHERE au.id = ${a}.assignee_user_id AND au.team_id = ?)` with `actor.teamId`.
     - head additionally: same with `au.department_id = ?` and `actor.departmentId`.
     Wrap as `(${a}.kind = 'internal' AND (...))`.
  2. In `queries.ts`, rename the current `taskScope` body to `crmTaskScope` and make `taskScope(actor)` return `((tk.kind = 'crm' AND <crmTaskScope>) OR <internalTaskScope>)` with binds concatenated in order. For academic/teacher/accountant, `crmTaskScope` already yields `0 = 1` through `leadScope`; keep that.
  3. Export `canSeeTask(db, actor, taskId): Promise<boolean>` from `task-scope.ts` that runs `SELECT 1 FROM task tk LEFT JOIN lead l ON l.id = tk.lead_id WHERE tk.id = ? AND <taskScope>`; move `taskScope` into `task-scope.ts` and import it in `queries.ts` so there is one definition.
- Success criteria: typecheck passes.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.5 — List and detail queries
- Goal: `/tasks` returns CRM and internal tasks; `/tasks/:id` returns one task with members and subtasks.
- Target: `apps/crm/src/worker/queries.ts` (`listTasks`, new `taskDetail`), `apps/crm/src/worker/index.ts` (`GET /tasks` ~line 95, new `GET /tasks/:id`).
- Steps:
  1. In `listTasks`, change `JOIN lead l` and `JOIN contact c` to `LEFT JOIN`; select `tk.kind, tk.priority, tk.description, tk.parent_task_id`; accept status `'open' | 'in_progress' | 'completed'` and a `mine` flag (`tk.assignee_user_id = actor.id OR EXISTS task_member`) for "Việc của tôi". For open, `ORDER BY tk.due_at IS NULL, tk.due_at ASC`.
  2. Map `lead` to `null` when `r.lead_id` is null; bucket `'nodue'` when `due_at` is null and status open/in_progress.
  3. Add `taskDetail(db, actor, id)` returning the list shape plus `members: {id,name}[]`, `subtasks: {id,title,status}[]`, `parent: {id,title} | null`, `createdBy`. Return null when `canSeeTask` is false.
  4. `GET /tasks` reads `?status=` and `?mine=1`; `GET /tasks/:id` returns `notFound` when null.
  5. Add `GET /directory` next to `GET /team-members` (~line 170): active users of `actor.organizationId` as `{ id, name, role, teamName }`, ordered by name. Pickers (assignee, collaborators, chat members, mentions) use it.
- Success criteria: existing callers (dashboard, `my_tasks`) still compile; `lead` typed nullable.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.6 — Command handlers
- Goal: create, update, cancel tasks; complete internal tasks; Forced Next Action unchanged.
- Target: `apps/crm/src/worker/commands.ts`.
- Steps:
  1. Extend `TaskRow` with `kind`, `parent_task_id`, `description`, `priority`, `due_at: string | null`, `lead_id: string | null`.
  2. `createTask`:
     - assignee must be an active `app_user` in `actor.organizationId`; every `memberUserIds` too (else `VALIDATION_FAILED`).
     - kind `crm`: `loadLead(db, actor, leadId)` must succeed; assignee must be the lead owner or the actor; `memberUserIds` must be empty (`VALIDATION_FAILED` "Việc gắn lead không có người cùng làm"), because CRM task visibility follows the lead. Does not change `next_action_task_id`.
     - `parentTaskId`: parent must exist and `canSeeTask`; a subtask is always `kind='internal'`, no lead.
     - insert with `tx.insertVersioned('task', {...})`, then one `tx.insertVersioned`-free raw insert per member: `tx.raw(db.prepare('INSERT OR IGNORE INTO task_member (task_id, user_id, added_at) VALUES (?, ?, ?)').bind(id, uid, tx.now))` (check `raw` signature in `guarded-tx.ts`).
     - `tx.audit('task', id, null, {...})`, `tx.event('task.created', { taskId: id, assigneeUserId })`. Return `ok({ taskId: id })`.
  3. `updateTask`: load task; `canSeeTask` else `NOT_FOUND`; `version` mismatch → `stale()`. Internal: creator, assignee, director, admin may edit; `status` may go `open` ↔ `in_progress`. CRM: same lead scope as `completeTask`; `status` field rejected (`VALIDATION_FAILED`, use completeTask); `dueAt: null` rejected; if `assigneeUserId` changes it must be the lead owner. Replace members when `memberUserIds` is given (delete + insert via `tx.raw`). Emit `task.updated`; emit `task.assigned` when assignee changes.
  4. `cancelTask`: internal only (`VALIDATION_FAILED` for CRM: those are cancelled by lead flows); creator, director, admin; status must be open/in_progress.
  5. `completeTask`: if `task.kind === 'internal'`: require `canSeeTask`, status `open` or `in_progress`, set completed, audit, event; skip all lead logic. CRM path unchanged.
  6. Register the three handlers in the handler map (~line 66-70).
- Success criteria: typecheck passes.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.7 — Shared chat store and task comments
- Goal: comments on a task are stored as `chat_message` rows of the task's conversation.
- Target: `apps/crm/src/worker/chat.ts` (new), `apps/crm/src/worker/index.ts`.
- Steps:
  1. In `chat.ts` export:
     - `ensureTaskConversation(db, actor, taskId): Promise<string>`: `INSERT OR IGNORE` a `chat_conversation` (`kind='task'`, `task_id`, `organization_id = actor.organizationId`, id = `task:<taskId>`), then `INSERT OR IGNORE` `chat_member` rows for the task assignee, creator, task members and the actor. Return the id.
     - `listMessages(db, conversationId, { before?: string, limit = 50 })`: newest first by `created_at`, max 100, join author display name; deleted messages return `body: ''` and `deleted: true`.
     - `insertMessage(db, { id, conversationId, authorKind, authorUserId, authorAgentId, body, parentMessageId, mentions, meta })`: `INSERT OR IGNORE` (client-generated `id` makes retries safe), then `UPDATE chat_conversation SET last_message_at = ?, updated_at = ?`; run both in one `db.batch`. Reject `body` empty or longer than 4000 characters.
     - `markRead(db, conversationId, userId, at)`: `UPDATE chat_member SET last_read_at = MAX(COALESCE(last_read_at, ''), ?)`.
     - `parseMentions(body)`: returns user ids from tokens `@[Display name](user:<id>)`.
  2. Routes in `index.ts` (behind `requireActor`): `GET /tasks/:id/comments?before=`, `POST /tasks/:id/comments` body `{ id: uuid, body, parentMessageId? }`, `POST /tasks/:id/comments/read`. Each checks `canSeeTask` first (else 404) and then calls `ensureTaskConversation`, which also adds the viewer to `chat_member` (so every viewer gets realtime events in phase 02). GET returns `{ conversationId, messages }`. POST then calls `insertMessage`.
- Success criteria: typecheck passes.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 1.8 — Tests
- Goal: prove the new behavior and the unchanged Next Action rule.
- Target: `apps/crm/test/task-engine.test.ts` (new). Copy the header, `call()` and `command()` helpers from `apps/crm/test/commands.test.ts` lines 1-33. Users: `u-lan` (sale, team-kd1), `u-long` (sale, team-kd1), `u-huy` (sale, team-kd2), `u-hung` (leader team-kd1), `u-admin`.
- Steps: write these tests:
  1. `u-lan` creates an internal task assigned to `u-long` with member `u-huy` and no due date → 200; `u-long`, `u-huy`, `u-hung` see it in `GET /tasks`; `u-mai` (leader team-kd2) does not.
  2. Internal task: `updateTask` status `in_progress` → row status `in_progress`; `completeTask` → `completed`.
  3. CRM task: `updateTask` with `status: 'in_progress'` → `VALIDATION_FAILED`; direct SQL `UPDATE task SET status='in_progress' WHERE kind='crm'` throws (CHECK).
  4. Completing a lead's current Next Action without `nextAction` still fails with `VALIDATION_FAILED` (pick an active lead of `u-lan` from the seed and its `next_action_task_id`).
  5. `cancelTask` on a CRM task → `VALIDATION_FAILED`.
  6. Comments: `u-long` posts a comment (same `id` twice → one row); `u-lan` reads it; `u-mai` gets 404.
  7. Subtask: create with `parentTaskId` → `GET /tasks/:parentId` lists it in `subtasks`.
- Success criteria: all tests pass.
- Verify: `pnpm --filter @abm/crm test -- task-engine.test.ts` exits 0 and reports 7 or more passing tests.

### Task 1.9 — Web: create dialog, detail page, Kanban
- Goal: users create, view, comment on and move tasks in the browser.
- Target: `apps/crm/src/web/types.ts`, `pages/tasks.tsx`, new `pages/task-detail.tsx`, new `components/task-board.tsx`, new `components/task-form-dialog.tsx`, new `components/chat-thread.tsx`, `router.tsx`, `apps/crm/package.json`.
- Steps:
  1. `pnpm --filter @abm/crm add @dnd-kit/core@^6.3.1 @dnd-kit/sortable@^10.0.0`.
  2. `types.ts`: task `lead` nullable; add `kind`, `priority`, `description`, `parentTaskId`, bucket `'nodue'`.
  3. `task-form-dialog.tsx`: fields kind (CRM needs a lead picker using the existing lead search API; internal hides it), title, description, priority, due date, assignee and collaborators (both from `useApi('/directory')`). Submits `createTask` with `useCommand`.
  4. `tasks.tsx`: add "Tạo việc" button; toggle "Danh sách | Kanban" via `?view=list|board` in `validateSearch` (keep existing `?view=completed` as `?status=completed`; update links accordingly); show priority badge and "Việc nội bộ" label when `lead` is null; title links to `/tasks/$taskId`.
  5. `task-board.tsx`: three columns `Cần làm` (open), `Đang làm` (in_progress), `Xong` (completed today and earlier, last 50). Drag with `@dnd-kit`. Internal task drop → `updateTask` status or `completeTask`. CRM task cannot enter `Đang làm` (show toast "Việc gắn lead chỉ có Cần làm và Xong"); drop on `Xong` opens the existing `CompleteTaskDialog` so Next Action is still asked.
  6. `chat-thread.tsx`: props `{ listPath, postPath, readPath }`; shows messages oldest at top, composer (Enter sends, Shift+Enter new line), client `crypto.randomUUID()` id, optimistic append, `refetchInterval: 10000` (phase 02 replaces polling with socket events). Calls `readPath` 2 seconds after the newest message is visible.
  7. `task-detail.tsx`: header fields with inline edit (`updateTask`), members, subtasks with "Thêm việc con", lead link when present, and `<ChatThread>` on `/tasks/:id/comments`.
  8. `router.tsx`: add route `/tasks/$taskId` using the same `createRoute` pattern as `/tasks`.
- Success criteria: web typecheck passes; no new console errors in tests.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0, then `pnpm --filter @abm/crm test` exits 0.

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
