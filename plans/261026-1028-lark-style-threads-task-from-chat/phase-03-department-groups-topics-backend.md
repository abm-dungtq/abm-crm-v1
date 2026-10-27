---
phase: 3
title: "Department groups, subgroups, topic mode (backend)"
status: pending
priority: P1
effort: "1d"
dependencies: [2]
---

# Phase 03: Department groups, subgroups, topic mode (backend)

## Goal
1. **Department groups.** Each department gets exactly one group, `dept:<department id>`, created automatically. Its members are the active users whose `app_user.department_id` is that department; a user with role `head` is an owner. Membership changes in the same D1 batch as the admin save (roster import, user edit, disable or enable). `GET /api/chat/conversations` re-runs the same sync. Nobody adds, removes or leaves a department group by hand.
2. **Subgroups.** Any member of a department group, and any director or admin, can create a group under it with members from any department. There is one level only: the parent must be a department group.
3. **Topic mode.** An owner, director or admin can set `mode` to `'topic'` or `'chat'` (not on the Inbox group). In topic mode:
   - Every new top-level user message starts a topic (a `chat_thread` row with `is_topic = 1`, the author following).
   - The main view is a list of topics, sorted by latest activity.
   - Topics can be closed and reopened. A closed topic rejects user replies.
   - Old messages stay as they are.

Proves acceptance criteria 6, 7 and 8 (server side).

**Deviation from Lark, recorded on purpose.** Lark has no parent/child groups. Subgroups are nested under department groups here because the user asked for it on 2026-10-26.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Work from `D:\TQD\CRM`; PowerShell; `pnpm` on PATH.
- The department sync must be set-based SQL, a fixed number of statements whatever the head count. No per-user loops.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26)
- Admin user writes in `apps/crm/src/worker/admin-routes.ts`:
  - `POST /roster/commit` (~line 106): `GuardedTx` `importRoster`, creates departments, teams and users.
  - `PATCH /users/:id` (~line 165): `updateUser`, changes `department_id`.
  - `POST /users/:id/status` (~line 206): `disableUser`/`enableUser`.

  Each ends with `commit(c, tx)`. `tx.raw(statement)` appends to the same batch in call order (`guarded-tx.ts:60`).
- System group pattern: `ensureInboxConversation` in `apps/crm/src/worker/inbox-notices.ts:27-50` (INSERT OR IGNORE conversation, DELETE members who no longer qualify, INSERT OR IGNORE qualifying members, in one batch).
- `chat-routes.ts` already blocks member edits on any conversation with `system_key` (`POST/DELETE /conversations/:id/members`). Department groups get `system_key 'dept:<id>'`, so they inherit the block.
- Group creation: `chatRoutes.post('/conversations'` in `chat-routes.ts`. `PATCH /conversations/:id` handles `title` and `agentReadable`. `GET /conversations/:id` returns the detail.
- Seed: one department `dep-kd` with users `u-head` (head), `u-hung`, `u-lan`, `u-long`, `u-mai` and `u-huy`. `u-admin` and `u-bgd` have no department (`seed/demo.sql:3-13`).

## Files to Create / Modify
- Create: `apps/crm/src/worker/chat-groups.ts`
- Modify: `apps/crm/src/worker/admin-routes.ts`, `apps/crm/src/worker/chat-routes.ts`, `apps/crm/src/worker/chat.ts`, `apps/crm/src/worker/chat-threads.ts`
- Create: `apps/crm/test/chat-groups.test.ts`
- Modify: `apps/crm/test/admin-users.test.ts` (new department sync cases), and in `apps/crm/test/chat.test.ts` / `apps/crm/test/mcp-chat-tools.test.ts` only assertions that counted a user's conversations (seed users now also see `dept:dep-kd`)

## Tasks

### Task 3.1 — Department sync
- Target: `apps/crm/src/worker/chat-groups.ts` (new).
- Steps: export `departmentGroupSyncStatements(db, organizationId, now): D1PreparedStatement[]` returning, in order:
  1. Create missing department groups:

     ```sql
     INSERT OR IGNORE INTO chat_conversation (id, organization_id, kind, title, system_key, department_id, mode, created_at, updated_at)
     SELECT 'dept:' || d.id, d.organization_id, 'group', d.name, 'dept:' || d.id, d.id, 'chat', ?2, ?2
     FROM department d WHERE d.organization_id = ?1
     ```
  2. Rename to the current department name:

     ```sql
     UPDATE chat_conversation SET title = (SELECT d.name FROM department d WHERE d.id = chat_conversation.department_id), updated_at = ?2
     WHERE organization_id = ?1 AND department_id IS NOT NULL
       AND title IS NOT (SELECT d.name FROM department d WHERE d.id = chat_conversation.department_id)
     ```
  3. Remove people who no longer qualify:

     ```sql
     DELETE FROM chat_member WHERE conversation_id IN (SELECT id FROM chat_conversation WHERE organization_id = ?1 AND department_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM chat_conversation c JOIN app_user u ON u.department_id = c.department_id
         WHERE c.id = chat_member.conversation_id AND u.id = chat_member.user_id AND u.status = 'active')
     ```
  4. Add new members, marked as read now so a newcomer does not start with the whole history unread:

     ```sql
     INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at, last_read_at)
     SELECT 'dept:' || u.department_id, u.id, CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END, ?2, ?2
     FROM app_user u WHERE u.organization_id = ?1 AND u.status = 'active' AND u.department_id IS NOT NULL
     ```
  5. Keep roles current:

     ```sql
     UPDATE chat_member SET role = (SELECT CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END FROM app_user u WHERE u.id = chat_member.user_id)
     WHERE conversation_id IN (SELECT id FROM chat_conversation WHERE organization_id = ?1 AND department_id IS NOT NULL)
       AND role IS NOT (SELECT CASE WHEN u.role = 'head' THEN 'owner' ELSE 'member' END FROM app_user u WHERE u.id = chat_member.user_id)
     ```

  Also export `ensureDepartmentGroups(db, organizationId)`, which runs those statements as one `db.batch`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.2 — Hook the sync into admin saves and the conversation list
- Target: `admin-routes.ts`, `chat-routes.ts`.
- Steps:
  1. In `POST /roster/commit`, `PATCH /users/:id` and `POST /users/:id/status`, call `for (const s of departmentGroupSyncStatements(db, actor.organizationId, tx.now)) tx.raw(s);`. Place the call after the `tx.update`/`tx.insertVersioned` calls and before `assertAdminRemains`, so the sync sees the new rows inside the same batch.
  2. In `GET /conversations` (chat-routes), call `await ensureDepartmentGroups(db, actor.organizationId)` before `listConversations`. The route then costs 2 D1 queries.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.3 — Subgroups, mode, detail, list fields
- Target: `chat-routes.ts`, `chat.ts`.
- Steps:
  1. `POST /conversations` (group) accepts an optional `parentConversationId`. When it is set:
     - The parent must be a `group` in the same organization with `department_id IS NOT NULL` and not archived. Otherwise return 422 `'Nhóm nhỏ chỉ tạo được trong nhóm phòng ban'`.
     - The actor must be a member of the parent, or have role `director` or `admin`. Otherwise return 403.
     - Members may be any active users of the organization (the existing `validateActiveUsers` check).

     Store `parent_conversation_id`. The creator is the owner, as today.
  2. `PATCH /conversations/:id`:
     - Accept `mode: 'chat' | 'topic'`. It is allowed only on `kind 'group'` with `system_key` either NULL or starting with `dept:`; the Inbox group is excluded. Check the prefix with `substr(system_key, 1, 5) = 'dept:'` or in JS, not with LIKE. The actor must be the owner, a director or an admin; otherwise 403. Update `mode` and publish `conversation.updated`.
     - Reject `title` on a department group with 422 `'Tên nhóm phòng ban theo tên phòng ban'`.
  3. `GET /conversations/:id` adds `mode`, `departmentId`, `parentConversationId`, `parentTitle`, and `subgroups: { id, title }[]`. The subgroups are the children the actor is a member of; leave the list empty for a non-department group. All of this comes from the existing batch plus one statement in it.
  4. `ChatConversationSummary` (in `listConversations`) adds `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `system: boolean` (`system_key IS NOT NULL`). `parentTitle` uses `LEFT JOIN chat_conversation p ON p.id = c.parent_conversation_id`. The department name is visible to everyone in the organization.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.4 — Topic mode
- Target: `chat-routes.ts`, `chat-threads.ts`, `chat.ts`.
- Steps:
  1. POST message in a `mode = 'topic'` conversation:
     - A top-level user message with `replyToMessageId` is rejected with 422 `'Ở chế độ Chủ đề, hãy trả lời trong chủ đề'`.
     - A top-level user message with no reply target creates the topic. Add one exported function in `chat-threads.ts`, `startTopicStatements(db, { conversationId, rootId, authorUserId, mentionIds, now })`. It returns `INSERT OR IGNORE chat_thread (is_topic 1, reply_count 0, last_activity_at now)` and the follower insert (author with via `author`, mentions with via `mention`). Run it in one batch after `insertMessage`. Then publish `message.created` and `thread.updated` to the members.
  2. `afterThreadMessage` creates the thread row with `is_topic = 1` when the conversation is in topic mode. This turns an old message into a topic on its first reply. Pass `isTopic = conv.mode === 'topic'` from every caller.
  3. `GET /conversations/:id/topics?before=&limit=` (limit 1–50, default 30):
     - It returns top-level messages, user or agent, with no `reply_to_message_id`, ordered by `COALESCE(t.last_activity_at, m.created_at) DESC, m.id DESC`, using `LEFT JOIN chat_thread t ON t.root_message_id = m.id`.
     - `before` is an activity timestamp.
     - Each item is a `ChatMessageItem` with its `thread` summary. Reuse the shared mapper and `loadThreadSummaries`; the latest replies give the "2 trả lời mới nhất" on the card.
     - Topic and conversation unread: the main-flow unread already counts new topics.
  4. `POST /threads/:rootId/close { closed: boolean }`:
     - The root author, the conversation owner, a director or an admin may call it.
     - Closing requires `is_topic = 1`. Otherwise return 422 `'Chỉ đóng được chủ đề'`. Reopening is always allowed.
     - It sets `closed_at`/`closed_by_user_id`, or NULL when reopening.
     - It publishes `thread.updated` to members and returns the `ThreadSummary`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.5 — Tests
- Target: `apps/crm/test/chat-groups.test.ts` (new; harness from `chat.test.ts:1-35`), `apps/crm/test/admin-users.test.ts`.
- Steps:
  1. `GET /chat/conversations` as `u-lan` contains `dept:dep-kd`, titled `Phòng Kinh doanh`. Its members are exactly the 6 `dep-kd` users. `u-head` has role `owner`. `u-admin` does not see it.
  2. Insert department `dep-dt` `Phòng Đào tạo` with SQL (the PATCH route only accepts existing departments), then admin `PATCH /admin/users/u-huy { departmentName: 'Phòng Đào tạo', teamName: '' , version }` (check `updateUserInput` and `placementError` for the exact fields a sale needs; use a role that is valid without a team if required). Right after the save:
     - `u-huy` is in `dept:<new id>` and no longer in `dept:dep-kd`.
     - A second department group exists.
     - Admin disables `u-long`, and `u-long` leaves `dept:dep-kd` in the same request; enabling `u-long` again restores the membership.
  3. Department group guards:
     - `POST /conversations/dept:dep-kd/members` returns 403.
     - Self-removal returns 403.
     - Renaming returns 422.
     - `u-head` switching `mode` to `topic` returns 200. `u-lan` (member) switching mode returns 403.
     - Switching mode on the Inbox group returns 422.
  4. Subgroups:
     - `u-lan` creates a subgroup under `dept:dep-kd` with `u-admin` (no department) as a member. The response is 200, and `GET` on the subgroup shows `parentConversationId = 'dept:dep-kd'`.
     - `u-admin` (no department) creating a subgroup under `dept:dep-kd` is allowed because of the admin role.
     - A user of `dep-dt` (not a member of `dept:dep-kd`, not director/admin) is refused with 403.
     - A subgroup under a normal group or under a subgroup returns 422.
  5. Topic mode:
     - After the switch, a top-level post creates a `chat_thread` row with `is_topic = 1`, and the author follows.
     - `GET /topics` orders a topic that just got a reply above a newer topic without replies.
     - A quote reply at top level returns 422.
     - The author closes the topic. A user reply then returns 422 `'Chủ đề đã đóng'`. Reopening lets the reply through.
     - Closing a non-topic thread returns 422.
     - Messages from before the switch are still listed.
- Verify: `pnpm --filter @abm/crm test -- chat-groups.test.ts admin-users.test.ts chat.test.ts chat-threads.test.ts mcp-chat-tools.test.ts` exits 0, then `pnpm --filter @abm/crm typecheck` and `pnpm --filter @abm/crm test` both exit 0.

## Success criteria
- Department groups always match the org chart right after each admin save. Subgroup and mode permissions are as listed. Topic mode creates, lists, closes and reopens topics.

## Risk
- **Sync statement removes the wrong rows** (low likelihood, high impact). Every statement is restricted to `department_id IS NOT NULL` conversations of the organization. Test 2 covers move, disable and enable.
- **Lazy sync writes on every list call.** `INSERT OR IGNORE` and conditional `UPDATE`/`DELETE` change no rows when nothing changed, and the whole sync is a single batch.
- **New members missed by open tabs.** There is no realtime event for an admin save; the list refreshes on its next fetch, which is acceptable at 18 users.

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
