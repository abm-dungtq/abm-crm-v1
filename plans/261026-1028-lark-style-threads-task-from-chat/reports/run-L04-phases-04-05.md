# Run L04: phases 04 and 05 (task from chat backend, agent drafts, MCP threads)

Date: 2026-10-27. Work context: `D:\TQD\CRM`. No git write commands, deploys or `--remote` calls were run. `README.md`, `.claude/`, `apps/crm/src/web/**` and `apps/crm/test/web-chat.test.ts` were not touched.

## Outcome

Both phases are implemented and verified. The full crm suite passes (61 files passed, 1 skipped; 750 tests passed, 2 skipped). The worker and web typechecks are clean. The budget test logs `task_budget { d1: 15, pushes: 22, hubCalls: 3, subrequests: 25 }`, which is within d1 <= 40, pushes <= 25 and hubCalls + pushes = 25 <= 40.

## Tasks completed

### Phase 04: task from chat (backend)
- Contracts: `createTaskInput` accepts an optional `source` (conversation, message, scope `message|thread`) and an optional `draft` (message id, index 0..2). A draft without a source and a source on a non-internal task are both rejected.
- `createTask`:
  - Checks the source in one query: the actor is a member, the message is in that conversation and not deleted, and an agent actor is refused.
  - Checks the draft: it is an agent message, the requester is the actor, the index exists and the stored source matches.
  - Stores `source_*` on the task.
  - Marks the draft used inside the same batch through a guarded `json_set`, so a concurrent second create gets 409 and creates no task.
  - Emits `task.created` with the members and the source.
- New `chat-tasks.ts`:
  - Builds a manual draft for a message or a thread: the title is the first line, cut on a word boundary; the description is the transcript, in UTC+7, capped at 5000 characters; the members are the mentioned members, excluding the actor.
  - Gives the placement rule for a card.
  - Posts the system task card into the source message or thread.
- `approval-notify.ts`:
  - Loads the task once.
  - Notifies the assignee as before.
  - Notifies the members ("... thêm bạn vào việc") without duplicates, skipping the actor and the assignee.
  - Posts the card when there is a source. A failed card is logged and never fails the command.
- `queries.ts`: `TASK_SELECT` carries the source columns. `taskDetail` returns `source` with `conversationTitle` and `canOpen`, and the title is null when the actor cannot open the chat.
- `chat-routes.ts`: `POST /api/chat/conversations/:id/task-drafts` returns `{mode:'manual', draft}`, or `{mode:'agent'}` once phase 05 is in.

### Phase 05: agent drafts, MCP threads
- New `chat-task-markers.ts`, `extractTaskDrafts`:
  - Parses `[TASK]...[/TASK]` blocks, with keys in English or Vietnamese and case, spaces and diacritics ignored. `description:` takes every line after it.
  - A block with no close tag runs to the end of the text.
  - Due dates are validated on the calendar.
  - A name resolves only when it matches exactly one member.
  - Still reads the old single-line `[TASK: ...]`.
  - Keeps at most 3 drafts and removes the blocks from the body.
- `chat-agents.ts`:
  - `extractTaskSuggestions` and `taskSuggestions` are replaced by `taskDrafts`, which carries `source` and `createdTaskId: null`.
  - New `scheduleTaskDraftTurn`: it runs for group chats with an enabled agent and an online bridge, uses one batched read, and dedupes per message, scope, requester and 10-minute window. It makes the requester follow the thread and publishes `agent.thinking`.
  - Applies a draft reply (the first draft, with source = the request) and a failed draft (`meta.taskDraftFailed`).
  - Requirement 2: in topic mode, a top-level `@Trợ lý` question becomes the topic root and the answer goes into that topic.
- `chat-routes.ts`: the task-drafts route tries the agent first. `prefer: 'manual'` skips it, and a scheduling error falls back to manual.
- `chat.ts`:
  - Agent conversation items carry `mode` and `parent_conversation_id`.
  - Agent messages carry `thread_id`, `reply_to_id` and, on roots, `reply_count`.
  - `agentMessages` reads the main flow by default, or a whole thread when given a `threadId`.
- `mcp-tools.ts`:
  - `read_messages` accepts `thread_id`, checked against a root in the same conversation, otherwise NOT_FOUND.
  - `get_task` returns `source {conversation_id, message_id, scope}` only when the agent may read that conversation.

### Supervisor requirement 1 (`chat-threads.ts`)
- A new follower row created by a manual follow or mute starts with `last_read_at = now`. Existing rows keep their marker.
- Test: follow a thread that already has 3 replies, and unread is 0; after a 4th reply, unread is 1; the author's unread count stays the same after a re-follow.

## Files changed or created
- `packages/contracts/src/index.ts` (createTaskInput only)
- `apps/crm/src/worker/commands.ts` (createTask and a new `checkTaskSource` helper)
- `apps/crm/src/worker/approval-notify.ts`
- `apps/crm/src/worker/queries.ts` (TASK_SELECT, taskDetail, `TaskSourceDetail`)
- `apps/crm/src/worker/chat-routes.ts` (task-drafts route)
- `apps/crm/src/worker/chat-tasks.ts` (new)
- `apps/crm/src/worker/chat-task-markers.ts` (new)
- `apps/crm/src/worker/chat-agents.ts`
- `apps/crm/src/worker/chat.ts` (agent helpers only)
- `apps/crm/src/worker/mcp-tools.ts`
- `apps/crm/src/worker/chat-threads.ts` (follower insert only)
- `apps/crm/test/chat-task-from-chat.test.ts` (new)
- `apps/crm/test/chat-task-markers.test.ts` (new)
- `apps/crm/test/chat-agents.test.ts`
- `apps/crm/test/mcp-chat-tools.test.ts`
- `apps/crm/test/chat-threads.test.ts`

`test/approval-notify.test.ts` did not need changes.

## Verify commands

| Command | Exit | Key output |
|---|---|---|
| `pnpm --filter @abm/crm test -- chat-task-from-chat.test.ts task-engine.test.ts approval-notify.test.ts` (phase 04) | 0 | 3 files, 24 tests passed |
| same, verbose | 0 | `task_budget { d1: 15, pushes: 22, hubCalls: 3, subrequests: 25 }` |
| `pnpm -r typecheck` (after phase 04) | 0 | clean |
| `pnpm exec tsc -p tsconfig.worker.json --noEmit` (after phase 05, includes tests) | 0 | clean |
| `pnpm test -- chat-task-markers.test.ts chat-agents.test.ts mcp-chat-tools.test.ts chat-task-from-chat.test.ts chat-threads.test.ts` (phase 05 plus requirement 1) | 0 | 5 files, 71 tests passed |
| `pnpm --filter @abm/crm typecheck` (worker + web) | 0 | clean |
| `pnpm --filter @abm/crm test` (full) | 0 | 61 files passed, 1 skipped; 750 tests passed, 2 skipped |
| `pnpm test -- chat-task-from-chat.test.ts --reporter=verbose` (final) | 0 | 16 tests; `task_budget { d1: 15, pushes: 22, hubCalls: 3, subrequests: 25 }` |

## Deviations and why
1. **A used draft gives 409 even when the second create is sequential.** The phase expects the second create to get 409. Without a pre-check, a sequential second create would fail the source match first with 422. `checkTaskSource` returns STALE_VERSION when `createdTaskId` is already set. The guarded batch assert still covers the race, and a test checks it with a mocked race.
2. **The test draft meta includes `source`.** The phase sample meta had no source, but the phase also requires the stored source to match the input source, so the fixture includes it.
3. **Topic placement goes beyond requirement 2.** `sourcePlacement` also puts a task card or an agent draft for a top-level message in a topic-mode group into that topic. This matches requirement 2, where a top-level message in topic mode is a topic root.
4. **A failed draft carries extra meta.** The failure notice for a draft turn carries `taskDraftFailed: {source}` and `requestedByUserId`, so the web can show a "make it manually" fallback for the requester.
5. **Agent draft turns run only in groups.** In a direct chat, the route returns the manual draft.
6. **A draft turn unmutes a muted requester.** It uses `setThreadSubscription('following')` as the phase specifies, so a requester who had muted the thread is unmuted.
7. **A missing message gives 404.** The task-drafts route returns 404 for a missing or deleted source message; the phase gave no code.
8. **The agent conversation list has extra fields.** `list_conversations` items now include `mode` and `parent_conversation_id`. Existing assertions use `toMatchObject`, so nothing broke.

## Unsure / follow-ups
- The web still reads `meta.taskSuggestions` in `src/web/components/chat-message-item.tsx`. That field is no longer written, so the web phase must switch it to `meta.taskDrafts`. I did not touch it because that file belongs to the parallel executor. The web typecheck passes because meta is untyped there.
- The phase files were not ticked off because they were not on the allowed-file list.

Status: DONE
Summary: Phases 04 and 05 and both supervisor requirements are implemented. The full crm suite and both typechecks pass, and task_budget is d1 15, pushes 22, hubCalls 3.
Concerns/Blockers: The web must switch from `meta.taskSuggestions` to `meta.taskDrafts` (owned by the web phase). See the deviations list for the extra behaviour choices.
