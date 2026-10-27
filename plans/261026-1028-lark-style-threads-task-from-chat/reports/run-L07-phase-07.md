# Run L07: phase 07, web groups tree, subgroups, group settings, topic mode

## Outcome
Tasks 7.1 to 7.5 are done, plus the extra requirement to follow the real `mode` from the API.
- In the "Tất cả" tab the sidebar now has four sections, in this order: Phòng ban (department groups with their subgroups nested under them), Nhóm, Hệ thống (Inbox) and Tin riêng.
- Subgroups can be created from a department group's `⋯` menu, from the group settings, or from the create dialog's "Thuộc phòng ban" picker.
- A new "Cài đặt nhóm" dialog replaces the members-only dialog. It holds the name, the message mode, the members and the subgroups.
- Groups in topic mode show a "Chủ đề mới" composer and the topic list instead of the chat flow.
- The thread panel can close and reopen a topic.

Typecheck, `web-chat.test.ts` (17 tests, 8 of them new) and the build all exit 0. The only files I changed are the ones listed in phase 07.

## Files
Created:
- `apps/crm/src/web/chat-tree.ts` (pure) exports:
  - `buildChatTree` and `sumUnread`.
  - The permission helpers `canSwitchMode`, `canManageMembers`, `canCreateSubgroup` and `canCloseTopic`.
  - The types `ChatTree`, `ChatTreeDepartment` and `ChatTreeActor`.
- `apps/crm/src/web/components/chat-group-settings.tsx` holds `ChatGroupSettingsDialog`. The add/remove member and rename code was moved here from `GroupMembersDialog`.
- `apps/crm/src/web/components/chat-topic-list.tsx` holds `ChatTopicList` and the topic card.

Modified:
- `src/web/types.ts`:
  - `ChatConversationSummary` gains `mode`, `departmentId`, `parentConversationId`, `parentTitle` and `system`.
  - `ChatConversationDetail.mode` is now required. The detail also gains `departmentId`, `parentConversationId`, `parentTitle` and `subgroups`.
  - New type `ChatConversationMode`.
- `src/web/pages/chat.tsx`:
  - The sidebar is built from `buildChatTree`, with a shared `ChatSectionHeader`.
  - New `ChatDepartmentRow` has the "Phòng ban" chip and a `⋯` menu with "Tạo nhóm nhỏ".
  - Subgroup rows use `.chat-subgroup-row`, and a non-member department is shown as a non-clickable header.
  - `CreateGroupDialog` gains the "Thuộc phòng ban" select and sends `parentConversationId`. Its title becomes "Tạo nhóm nhỏ trong <phòng ban>" when a parent is chosen.
  - The pane's header button is now "Cài đặt nhóm". It shows "Phòng ban" and "Chủ đề" markers and switches to `ChatTopicList` when `mode === 'topic'`.
  - `GroupMembersDialog` was removed (moved).
- `src/web/components/chat-thread-panel.tsx`:
  - New "Đóng chủ đề" / "Mở lại" button with a confirm. It calls `POST /chat/threads/:id/close` and is shown when `canCloseTopic`.
  - The header says "Chủ đề" for a topic.
- `src/web/chat-socket.ts`: comment only (see deviation 1).
- `src/web/styles.css`: one new section, `chat: department tree, group settings, topics`, appended after the existing chat section.
- `test/web-chat.test.ts`: 8 new tests covering `buildChatTree` and the four permission helpers.

## Verify results
| Step | Command | Result |
|------|---------|--------|
| 7.1 | `pnpm --filter @abm/crm typecheck` | exit 0 |
| 7.2–7.4 | `pnpm --filter @abm/crm typecheck` | First run: exit 1, `chat-group-settings.tsx(47,69) TS2345`. `canCreateSubgroup` took a `Pick<ChatConversationSummary,...>`, and a detail's `kind` includes `'task'`. I fixed it by widening the parameter type to `{ kind: ChatConversationDetail['kind']; departmentId }`, my own code. Second run: exit 0 |
| 7.5.1 | `pnpm --filter @abm/crm test -- web-chat.test.ts` | exit 0, 1 file, 17 tests passed |
| 7.5.2 | `pnpm --filter @abm/crm typecheck` | First run: exit 1, but only in `test/chat-task-from-chat.test.ts` (`setBridgeOnline` and `runCompletions` not found). That file belongs to the parallel backend executor. A minute later, `tsc -p tsconfig.worker.json` and `tsc -p tsconfig.web.json` each exited 0, and the full `pnpm --filter @abm/crm typecheck` rerun exited 0 |
| 7.5.3 | `pnpm --filter @abm/crm build` | exit 0, `✓ built in 3.36s` (only the usual chunk-size warning) |

## Extra requirement: the real `mode`
`GET /conversations/:id` now always returns `mode`, so `ChatConversationDetail.mode` is required. The summary has it too.
- The existing consumers already read `conv.mode` for "Trả lời theo chuỗi" (`chat-message-item.tsx`), and for "Cũng gửi vào nhóm" and the thread composer (`chat-thread-panel.tsx`). They now follow the server value.
- The only `?? 'chat'` defaults left are on `query.data?.mode` while the detail is still loading. In `chat-thread.tsx`, which I did not touch, the default also covers task comments before the detail arrives.
- A topic-mode group renders `ChatTopicList`, so no main chat flow is shown there. The thread panel hides "Cũng gửi vào nhóm" for topics (`thread.isTopic` or `mode === 'topic'`).

## Deviations and why
1. **`chat-socket.ts`.** I only added a comment. The socket already invalidates `['chat', conversationId]` on `message.created`, `message.deleted` and `thread.updated`. React Query matches keys by prefix, so the topics key `['chat', id, 'topics']` is already refreshed. Adding another explicit invalidation would cancel and restart the same fetch.
2. **`canCreateSubgroup(parent, actor)`.** A non-null `parent` is a department group from the reader's own list, and being in the list means being a member. `null` means the reader is not a member, so only a director or admin may create the subgroup. There is no endpoint that lists every department group. So for directors and admins the parent picker offers the department groups in their list plus the orphan headers (parents of subgroups they are in).
3. **Sync note for the Inbox group.** Department groups show "Thành viên tự đồng bộ theo phòng ban" as the phase says. For the Inbox group I show "Thành viên tự đồng bộ theo danh sách nhân viên", because the Inbox does not follow departments and the phase text would be wrong there.
4. **"Rời nhóm" stays.** In normal groups a plain member still sees "Rời nhóm" on their own row, as before. `canManageMembers` only controls adding and removing other people.
5. **Ordering.** Rows are sorted by `lastMessageAt`, falling back to `updatedAt` when a group has no message yet, so a new group does not sink to the bottom.
6. **Mark read in topic view.** It posts the conversation read `at = max(detail.lastMessageAt, newest loaded topic root createdAt)`, through the same `useDebouncedMarkRead` hook as the chat view.
7. **Confirms** use `window.confirm`, the same way other screens in the repo do. There is no confirm-dialog component.

## Things I was unsure about
- In topic mode, an @Trợ lý question at top level still gets the agent's main-flow quote reply. That reply is not a topic, so it does not appear in the list (agent behaviour belongs to phase 05). The "Trợ lý đang trả lời…" hint in the topic view clears when a new agent topic arrives or after the usual 2 minutes.
- The UI was only typechecked and built. As the phase says, the 360px phone check is done live in phase 10.

Status: DONE
Summary: Phase 07 is complete: department tree sidebar, subgroup creation, group settings (name, mode, members, subgroups), topic list view and close/reopen of topics. Typecheck, web-chat.test.ts (17 tests) and the build exit 0.
Concerns/Blockers: none. The first typecheck run hit a transient error in the parallel executor's `test/chat-task-from-chat.test.ts`, and the rerun exited 0.
