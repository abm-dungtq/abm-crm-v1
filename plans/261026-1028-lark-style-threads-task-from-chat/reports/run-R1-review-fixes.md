# Run R1: backend review fixes

Brief: `brief-R1.md` plus the supervisor addendum, which tightens fixes 1 and 2. Every fix has a test. No git write commands were run, nothing was deployed, and no `--remote` command was used.

## Files changed (all on the allowed list)
- `apps/crm/src/worker/chat-groups.ts` adds `departmentGroupDriftStatement`, a single SELECT with OR'd `EXISTS` clauses. `ensureDepartmentGroups` now runs that check first and runs the sync batch only when it finds drift. The function is wrapped in try/catch and logs `console.error('department_sync_failed', { organizationId })`.
- `apps/crm/src/worker/chat-threads.ts` changes `afterThreadMessage`, `setThreadClosed` and `setThreadSubscription` (details under each fix below).
- `apps/crm/src/worker/chat-routes.ts` updates the comment on the list route, passes `{ explicit: true }` from the subscription route, uses the new `setThreadClosed` signature, and adds a `last_reply_at` recompute to the recall batch.
- `apps/crm/src/worker/commands.ts` changes `createTask` (it passes the task's user ids on) and `checkTaskSource` (it checks draft membership and that the draft is not recalled).
- Tests changed: `apps/crm/test/chat-groups.test.ts`, `chat-threads.test.ts`, `chat-task-from-chat.test.ts`, `mcp-chat-tools.test.ts`. No existing assertion was changed or removed.

## Fixes
1. **Department sync drift check.** The check detects all five cases the sync repairs:
   - (a) a department with no `dept:<id>` group;
   - (b) a group title that differs from the department name;
   - (c) a user member who is missing, inactive, or now in another department;
   - (d) an active user who is missing from their department's group;
   - (e) a member whose role differs from the one the sync sets (`head` → owner, everyone else → member).

   The `department` table has no status column, so "active department" means every department of the org, which is what the sync uses too.

   Tests:
   - After the repairing GET, a second GET runs no batch and no write. Its D1 count is exactly one lower, because the sync batch is gone.
   - Drift is created directly in SQL for each case: a new department; a renamed department plus a user inserted into it; a disabled member; a moved member; a wrong role. In each case the next GET runs one batch and repairs the data, and the GET after that is quiet.
   - When the batch throws, the list still returns 200 and the error is logged with `{ organizationId }` only.
2. **Direct-chat thread replies.** On the first reply ever in a direct chat, every user member becomes a follower: the replier as `reply`, everyone else as `author`, with `last_read_at` NULL. This is one `INSERT OR IGNORE … SELECT` in the same batch, guarded by `NOT EXISTS` (no other reply to this root). Because of that guard, someone who unfollows is not added back later.

   Tests:
   - The other person's first thread-only reply shows as unread (`unread` 1 and `threadUnread` 1) and produces a `chat_thread` notification. After they unfollow, later replies do not add them back.
   - In a direct chat with the agent (bridge offline, so the agent's offline notice lands in the thread), the person is the only follower and no notification rows are created.
3. **Outsider tests.** One table-driven test checks that a non-member gets 404 `NOT_FOUND` on all seven routes (context is checked for both a reply and the root), and that nothing changed afterwards.

   The case "`threadRootId` from another conversation where the poster is a member of both → 422" was already covered by the existing test `invalid thread targets are rejected with 422`: u-long is in both groups, and it asserts 'Không tìm thấy tin gốc của chuỗi'.

   Also added:
   - MCP `read_messages` with `thread_id` on a direct chat with `agent_readable=0` returns `NOT_FOUND`, and the text does not leak.
   - `u-bgd` and `u-admin` outside the source chat get 404 from `createTask`.
4. **Draft assignee and members.** When `draft` is set, the assignee and every member must be user members of the source conversation. Otherwise the result is 422 `VALIDATION_FAILED`, 'Người nhận và người cùng làm phải là thành viên của cuộc trò chuyện'. The member count is a subquery in the existing draft read, so this adds no query.
5. **Recalled draft.** The draft read now requires `deleted_at IS NULL`. A recalled draft returns 422 'Việc nháp không còn dùng được'.
6. **Mention followers.** A new mention follower's `last_read_at` is the reply's `created_at` minus 1 ms. Test: after two earlier replies, the mention gives unread 1, and one more reply gives 2.
7. **A draft request no longer unmutes (see the deviation below).** `setThreadSubscription` gained an `opts: { explicit?: boolean }` argument. Only `explicit: true` runs the `UPDATE … muted`, and the subscription route passes it. Every other caller, including `scheduleTaskDraftTurn` in `chat-agents.ts`, now only inserts the follower row. The returned `muted` value is read back from the row. Test: mute the thread, request a draft, and the row stays `{ via: 'author', muted: 1 }`. An explicit `following` still unmutes.
8. **Closing topics after a switch to topic mode.** In topic mode, `setThreadClosed` closes any root of the conversation. A root without replies gets its thread row created (`is_topic` 1), and an existing `is_topic = 0` row is closed as it is. Test: after the switch, both a root that has replies (`is_topic` 0) and a root with no replies close, refuse new replies, reopen, and accept replies again.
9. **Recalling a reply.** The recall batch now also sets `last_reply_at` to the MAX `created_at` of the remaining non-deleted replies, or NULL if none are left. `last_activity_at` is unchanged. Test: recall the last reply and `last_reply_at` falls back to the remaining one; recall that one too and it becomes NULL; `last_activity_at` stays the same throughout.

## Verify
- `pnpm --filter @abm/crm typecheck`: exit 0, worker and web both clean.
- `pnpm --filter @abm/crm test`: exit 0, "Test Files 61 passed | 1 skipped (62); Tests 769 passed | 2 skipped (771)". There were no web failures from the parallel work.
- Budgets:
  - `message_budget { d1: 14, pushes: 6, hubCalls: 5, subrequests: 11 }` (limit 40)
  - `task_budget { d1: 15, pushes: 22, hubCalls: 3, subrequests: 25 }` (limit 40)

## Deviations and uncertainties
- **Fix 7.** `scheduleTaskDraftTurn` lives in `chat-agents.ts`, which is not on the allowed list. I made the fix inside `setThreadSubscription` (`chat-threads.ts`) by making "do not unmute" the default and having the subscription route opt in. `chat-agents.ts` was not touched and needs no change.
- **Fix 2.** I followed the addendum ("when the thread row is first created") by using the first reply as the trigger. A thread row can also be created earlier by a manual follow, or by a topic start in a group. Using the first reply means the direct-chat members are still added in those cases.
- **Fix 3.** The 422 for a root in another conversation was already tested, as described under fix 3, so I did not add a duplicate.

Status: DONE
Summary: All nine review fixes and the addendum are in place, each with a test. Typecheck and the full test suite pass (769 passed), and both budgets are well under 40.
Concerns/Blockers: none. Fix 7 was made inside `setThreadSubscription` because `chat-agents.ts` is outside the allowed list.
