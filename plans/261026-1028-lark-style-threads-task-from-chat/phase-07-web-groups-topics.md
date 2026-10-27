---
phase: 7
title: "Web: department tree sidebar, subgroups, group settings, topic mode"
status: pending
priority: P1
effort: "1d"
dependencies: [3, 6]
---

# Phase 07: Web groups and topics

## Goal
1. **Sidebar tree.** In the "Tất cả" tab, sections appear in this order:
   - **Phòng ban**: each department group the user belongs to, with its subgroups nested and indented under it. A subgroup whose department group the user does not belong to is listed under a non-clickable header with the parent's title.
   - **Nhóm**: normal groups.
   - **Hệ thống**: the Inbox group.
   - **Tin riêng**.

   Each row keeps its unread badge and the thread dot from phase 06. A department group row shows a small "Phòng ban" chip.
2. **Create subgroup.** A department group's header menu, and the create-group dialog, offer "Tạo nhóm nhỏ trong <phòng ban>". The dialog has a parent picker, limited to department groups the user is a member of (all department groups for director and admin), and a member picker for people from any department.
3. **Group settings dialog.** It replaces the members-only dialog and has three parts:
   - Name: read-only for department groups, with "Theo tên phòng ban".
   - **Chế độ tin nhắn**: radio "Trò chuyện" or "Chủ đề", enabled for the owner, director and admin, with the help text "Tin cũ giữ nguyên; chỉ tin mới theo chế độ mới."
   - Members: read-only with the note "Thành viên tự đồng bộ theo phòng ban" for department groups and Inbox; add and remove as today for others. Subgroups are listed with links.
4. **Topic mode view.** When `mode === 'topic'`, the conversation pane shows:
   - At the top, a "Chủ đề mới" composer (the same `chat-composer`, without a quote).
   - Then the topic list from `GET /topics`, newest activity first, with "Tải thêm". Each topic card shows the author, the time, the root text (clamped to 4 lines), `N trả lời`, the 2 latest replies (author + snippet), the replier initials, a "Đã đóng" chip when closed, and the button **Xem chủ đề**, which opens the phase 06 thread panel.
   - The panel header has **Đóng chủ đề / Mở lại** for the root author, the owner, the director and the admin.
   - Messages from before the switch appear as topics with 0 replies.

Proves acceptance criteria 6, 7 and 8 (UI side).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Reuse the existing classes and the phase 06 `chat-*` classes. New classes go in the same `chat:` section of `styles.css`.
- Keep the tree-building and permission logic in pure functions in `chat-tree.ts` and test them.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26, after phases 03 and 06)
- `pages/chat.tsx`:
  - `ChatPage` list sections, starting at line ~110.
  - `CreateGroupDialog` (line ~419).
  - `GroupMembersDialog` (line ~664).
  - `ChatConversationPane` (line ~248), which renders `<ChatThread conversationId embedded />`.
- API (phase 03):
  - `ChatConversationSummary` has `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `system`.
  - `ChatConversationDetail` has `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `subgroups`.
  - `POST /chat/conversations` accepts `parentConversationId`.
  - `PATCH /chat/conversations/:id { mode }`.
  - `GET /chat/conversations/:id/topics`.
  - `POST /chat/threads/:rootId/close { closed }`.
- The actor's role comes from `useActor()`.

## Files to Create / Modify
- Create: `apps/crm/src/web/chat-tree.ts` (pure), `apps/crm/src/web/components/chat-group-settings.tsx`, `apps/crm/src/web/components/chat-topic-list.tsx`
- Modify: `apps/crm/src/web/pages/chat.tsx`, `apps/crm/src/web/components/chat-thread-panel.tsx` (close/reopen), `apps/crm/src/web/chat-socket.ts` (topics query invalidation only), `apps/crm/src/web/types.ts`, `apps/crm/src/web/styles.css`
- Modify: `apps/crm/test/web-chat.test.ts`

## Tasks

### Task 7.1 — Pure tree and permission helpers
- Target: `apps/crm/src/web/chat-tree.ts`.
- Steps: export
  1. `buildChatTree(conversations)` returns `{ departments: { group: Summary | null; parentId: string; title: string; children: Summary[] }[]; groups: Summary[]; system: Summary[]; directs: Summary[] }`.
     - Department groups are those with `departmentId`.
     - Children are grouped by `parentConversationId`.
     - An orphan child (parent not in the list) produces an entry with `group: null` and `title = parentTitle`.
     - The Inbox group is `system && !departmentId`.
     - Order inside each section: unread first, then `lastMessageAt` descending. Departments are sorted by title with `localeCompare('vi')`.
  2. `canSwitchMode(detail, actor)`: the conversation is a group, not the Inbox group, and the actor is an owner, director or admin.
  3. `canManageMembers(detail, actor)`: not system (department or Inbox), and the actor is an owner, director or admin.
  4. `canCreateSubgroup(parentSummary, actor)`: the parent is a department group and the actor is a member (it appears in the list) or a director or admin.
  5. `canCloseTopic(thread, rootAuthorUserId, detail, actor)`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 7.2 — Sidebar and create dialog
- Target: `pages/chat.tsx`.
- Steps:
  1. Render the "Tất cả" tab from `buildChatTree`. Section headers reuse the current header style. Subgroup rows get `.chat-subgroup-row` (indent 20px plus a thin left guide line).
  2. A department group row has a `⋯` with "Tạo nhóm nhỏ", which opens `CreateGroupDialog` with the parent preset.
  3. `CreateGroupDialog` gets an optional "Thuộc phòng ban" select (empty = normal group). Its options come from the tree's department groups, filtered by `canCreateSubgroup`. Send `parentConversationId`. Error messages from the API are shown as today.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 7.3 — Group settings
- Target: `components/chat-group-settings.tsx`, replacing `GroupMembersDialog` usage in `chat.tsx`. Keep the add/remove member code by moving it, not rewriting it.
- Steps:
  1. Name field: editable through the existing rename for normal groups when the user is allowed; read-only with a hint for department groups.
  2. Mode radio, shown only when `canSwitchMode`. Saving calls `PATCH { mode }` and invalidates `['chat', 'conversation', id]`, `['chat', 'conversations']` and `['chat', id]`. A confirm dialog says: "Chuyển sang Chủ đề: mỗi tin mới sẽ là một chủ đề, mọi người trả lời trong chủ đề. Tin cũ giữ nguyên." Switching back uses the matching text.
  3. Members: read-only list with the sync note when `!canManageMembers`. Subgroups list with links (`chatLink`). For department groups, a button "Tạo nhóm nhỏ" when allowed.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 7.4 — Topic list
- Target: `components/chat-topic-list.tsx`, plus the switch in `ChatConversationPane` (`mode === 'topic'` renders `ChatTopicList` instead of `ChatThread`). Keep the conversation header and the agents dialog.
- Steps:
  1. `useQuery(['chat', id, 'topics'])` on `GET /chat/conversations/<id>/topics`, with paging by `before = last item's thread?.lastActivityAt ?? createdAt`.
  2. The top composer posts top-level messages, which the server turns into topics, then invalidates the topics query. Socket events `message.created` and `thread.updated` for this conversation invalidate it too: extend the `chat-socket.ts` invalidation to the `['chat', id, 'topics']` key (no other change to that file).
  3. Topic card `.chat-topic-card` as described in the Goal. **Xem chủ đề** sets `?thread=<id>`.
  4. In `chat-thread-panel.tsx`, add **Đóng chủ đề** / **Mở lại** (with a confirm) when `thread.isTopic` and `canCloseTopic`. It calls `POST /chat/threads/<id>/close`.
  5. Mark the main conversation read when the topic list is shown, exactly as the chat view does today.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 7.5 — Tests and build
- Target: `apps/crm/test/web-chat.test.ts` (extend).
- Steps: test
  - `buildChatTree`: a department with 2 subgroups, an orphan subgroup, Inbox in system, directs separate, unread ordering.
  - `canSwitchMode` for owner, member, director and the Inbox group.
  - `canManageMembers`, false for department and Inbox groups.
  - `canCreateSubgroup` for a member, a non-member and an admin.
  - `canCloseTopic` for the author, the owner and another member.
- Verify:
  1. `pnpm --filter @abm/crm test -- web-chat.test.ts` exits 0.
  2. `pnpm --filter @abm/crm typecheck` exits 0.
  3. `pnpm --filter @abm/crm build` exits 0.

## Success criteria
- The tree, subgroup creation, the settings and the topic view all compile, and the helpers are tested. The live check is in phase 10.

## Risk
- **Phone width.** The tree indent must not overflow at 360px. Use `truncate` on titles; the live check is in phase 10.
- **Shared web files** (`chat-socket.ts`, `chat-thread-panel.tsx`) were created or changed in phase 06. This phase starts only after 06, so there is no conflict.

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
