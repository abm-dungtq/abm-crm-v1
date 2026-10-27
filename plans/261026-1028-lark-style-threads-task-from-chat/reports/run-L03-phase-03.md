# Run L03: phase 03, department groups, subgroups and topic mode (backend)

## Outcome
Tasks 3.1 to 3.5 are done. Each department now has one group, `dept:<department id>`. Its members follow the org chart, and the sync runs inside the same batch as every admin save: roster import, user edit, and disable or enable. `GET /api/chat/conversations` runs the same sync again as one batch before it lists. Department groups cannot be edited by hand or renamed. Subgroups can be created under a department group only, by its members or by a director or admin. Owners, directors and admins can switch a group to topic mode, but not the Inbox group. In topic mode a top-level post starts a topic, topics are listed by latest activity, and they can be closed and reopened.

The full test suite passes (702 tests). The worker typecheck passes. The web typecheck fails, but only in `src/web/components/chat-thread.tsx`, which belongs to the parallel web executor (details below).

## Files
Created:
- `apps/crm/src/worker/chat-groups.ts` exports:
  - `departmentGroupSyncStatements`, which holds the 5 statements, with the SQL copied from the phase file.
  - `ensureDepartmentGroups`, which runs them as one `db.batch`.
  - A small helper, `isDepartmentGroupKey`.
- `apps/crm/test/chat-groups.test.ts` has 6 tests in three describe blocks: department groups, subgroups and topic mode.

Modified:
- `apps/crm/src/worker/admin-routes.ts`: a private helper `syncDepartmentGroups(tx, db, actor)` appends the statements through `tx.raw`. It is called in `POST /roster/commit`, `PATCH /users/:id` and `POST /users/:id/status`, after the user rows and audits and right before `assertAdminRemains`.
- `apps/crm/src/worker/chat-routes.ts`:
  - `GET /conversations` calls `ensureDepartmentGroups` first, so the route costs 2 D1 queries.
  - `POST /conversations` accepts `parentConversationId` and enforces the parent and permission rules (422 or 403).
  - `GET /conversations/:id` adds `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `subgroups`. These come from one extra UNION ALL statement in the existing batch.
  - `PATCH /conversations/:id` adds `mode` and refuses a rename of a department group.
  - Topic-mode handling in POST messages.
  - New routes: `POST /threads/:rootId/close` and `GET /conversations/:id/topics`.
- `apps/crm/src/worker/chat.ts`:
  - `ChatConversationRow` gains `department_id` and `parent_conversation_id`.
  - `ChatConversationSummary` gains `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `system`. `listConversations` gets them through `LEFT JOIN chat_conversation p` and is still one query.
- `apps/crm/src/worker/chat-threads.ts`: new `startTopicStatements`, `listTopics` and `setThreadClosed`.
- `apps/crm/test/admin-users.test.ts`: 2 new tests. One checks that a roster commit creates and fills both department groups, with the head as owner. The other checks that a user edit to head makes them owner, and an edit to director removes them.

Not modified: `chat.test.ts` and `mcp-chat-tools.test.ts`. Their conversation-count assertions still pass with the department group present.

## Verify results
| Step | Command | Result |
|------|---------|--------|
| 3.1–3.4 | `pnpm --filter @abm/crm typecheck` | exit 0 (run after 3.4, before the parallel web edits reached `chat-thread.tsx`) |
| 3.5 | `pnpm --filter @abm/crm test -- chat-groups.test.ts admin-users.test.ts chat.test.ts chat-threads.test.ts mcp-chat-tools.test.ts` | First run: exit 1. My new test expected the department groups ordered as `dep-kd`, `dep-dt`, but `ORDER BY id` puts `dept:dep-dt` first. I fixed the order in the expectation (my own test code). Second run: exit 0, 5 files, 66 tests passed |
| Gate | `pnpm --filter @abm/crm test` | exit 0: 58 files passed, 1 skipped; 702 tests passed, 2 skipped (694 before) |
| Gate | `pnpm --filter @abm/crm typecheck` | exit 1. All errors are in `src/web/components/chat-thread.tsx` (`parentMessageId` does not exist on `ChatMessage`). This file belongs to the parallel web work, which has changed `src/web/types.ts` and not yet updated this consumer |
| Gate (split) | `npx tsc -p tsconfig.worker.json --noEmit` | exit 0 |
| Gate (split) | `npx tsc -p tsconfig.web.json --noEmit` | exit 1, and the only file with errors is `src/web/components/chat-thread.tsx` |

## Deviations and why
1. **Order of checks in PATCH.** The rename refusal (422) and the mode checks (422 for a bad value or a disallowed group, then 403) run before any write. The mode update runs last, so a failing title or `agentReadable` field never leaves a mode change behind. The response now also returns `mode`.
2. **`isTopic` passed by the user POST route.** The route now passes `conv.mode === 'topic'` as the phase says. Before, it read the root's existing `is_topic`. The value is only used by `INSERT OR IGNORE`, so behaviour is the same. The callers in `chat-agents.ts` already passed `conv.mode === 'topic'`, so that file was not touched.
3. **Topics list.** It returns user and agent messages (`author_kind IN ('user','agent')`) that are top-level and quote nothing, as the phase says. System messages are left out, and recalled roots are kept and shown as recalled. The route works for any conversation the actor can open, not only topic-mode ones.
4. **Close route.**
   - It returns 404 for task conversations, the same as the subscription route.
   - It returns 422 when `closed` is not a boolean.
   - Reopening a root that has no thread row succeeds and returns `null` as the summary.
   - Closing an already closed topic keeps the first `closed_at`/`closed_by_user_id`.
5. **Topic start followers.** Mentioned people follow with via `mention`, and `last_read_at` starts as NULL, the same as `afterThreadMessage`. The author's own messages never count as unread for them.
6. **Test step 2 (move a user).** u-huy is a `sale`, which needs a team, so the test inserts `dep-dt` together with a team `team-dt1` through SQL. The admin PATCH then sends `departmentName: 'Phòng Đào tạo', teamName: 'Đào tạo 1'`.
7. **Department group sort in detail.** `subgroups` is sorted by title (Vietnamese locale), then by id, in JS.

## Things I was unsure about
- In topic mode, an @Trợ lý question at top level still gets the agent's existing main-flow quote reply (phase 01 behaviour). That reply has `reply_to_message_id` set, so it does not appear in the topics list. Phase 05 owns agent behaviour in threads and topics.
- Subgroups stay where they are when their department is renamed or emptied. Nothing archives them. The phase does not ask for this.

Status: DONE_WITH_CONCERNS
Summary: Phase 03 is implemented. Department group sync is wired into the admin saves and the conversation list, subgroups, mode switching and topic mode work, and the full test suite passes (702 tests).
Concerns/Blockers: `pnpm --filter @abm/crm typecheck` currently exits 1, only because of `src/web/components/chat-thread.tsx`, which belongs to the parallel web executor (the worker tsconfig is clean). It should go green once the web phase updates that file.
