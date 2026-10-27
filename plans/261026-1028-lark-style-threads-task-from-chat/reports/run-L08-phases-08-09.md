# Run L08: phases 08 and 09 (web task from chat, docs)

Date: 2026-10-27. Work context: `D:\TQD\CRM`. No git write commands, deploys, `--remote` calls or background servers were run. `README.md` (root) and `.claude/` were not touched. No worker code was changed.

## Outcome
Both phases are done.
- **Web.** The task-from-chat flow works from both entry points:
  - "Tạo việc từ tin này" in the message menu.
  - "Tạo việc từ chuỗi" in the thread panel header and on topic cards.
- **Agent drafts.** Draft cards render from `meta.taskDrafts`, on agent messages only. Old `meta.taskSuggestions` cards still render as before.
- **Other cards.** Task cards (`meta.taskCard`) and the "Tự tạo việc" fallback (`meta.taskDraftFailed`) render.
- **Task detail.** It shows the "Tạo từ chat" row.
- **Docs.** ADR-012, the new Vietnamese chat guide, the GoClaw section 7 prompt and `docs/README.md` match the code.

## Tasks completed
### Phase 08
- **8.1 Task form takes a full draft.**
  - `TaskFormInitialValues` gains `description`, `memberUserIds`, `unresolvedNames`, `source` and `draft`.
  - The open-reset effect applies the description and the members. A second effect drops members that are not in `/directory` once it loads.
  - With `source` set:
    - `kind` is fixed to internal and the CRM option is hidden.
    - `source` and `draft` are sent to `createTask`.
    - The line "Tạo từ chat · việc sẽ được gửi lại vào chuỗi|tin gốc" is shown.
  - Unresolved names show the hint "Chưa khớp tên: @A, @B. Chọn lại người trong danh sách."
  - `STALE_VERSION` or 409 on a draft shows the toast "Việc nháp này đã được tạo" and closes the dialog.
- **8.2 Actions and cards.**
  - `useTaskDraftRequest()` in `chat-task-cards.tsx` is the one shared `requestTaskDraft`. On `mode 'manual'` it opens `TaskFormDialog` prefilled. On `mode 'agent'` it shows the toast "Trợ lý đang soạn việc…". The existing `agent.thinking` socket hint shows "Trợ lý đang trả lời…" in place.
  - The menu item is shown on group and direct messages that are not deleted or pending. It is not shown in task comments or on system/task-card messages.
  - `DraftCard` shows:
    - the title, and the description clamped to 4 lines with "Xem thêm";
    - Người làm, with a warning chip when the name is unresolved;
    - Người liên quan chips, with unresolved names in warning style;
    - Hạn.
  - `DraftCard` controls:
    - The requester gets "Sửa và tạo việc", which opens the prefilled form. It is hidden when `source === null`.
    - Once created, the card shows "Đã tạo việc · Mở việc".
    - Everyone else sees "Trợ lý đề xuất việc · chờ <tên> xác nhận".
  - `TaskCard` shows the title, the assignee, the due date (`fmtDateTime`, Vietnam time) and "Mở việc".
  - `FailedDraft` is shown to the requester only, on both the agent message (no block) and the system failure message. It calls `/task-drafts` with `prefer: 'manual'`.
- **8.3 Task detail.** `TaskDetail.source` is typed. The "Tạo từ chat" row links to `chatLink(...)` through `taskSourceLink` and shows the conversation title. Without `canOpen` it shows "Tạo từ chat (bạn không ở trong hội thoại này)".
- **8.4 Tests.** Six new tests in `web-chat.test.ts` cover:
  - `draftToInitialValues`: `T09:00`, a null due, members and unresolved names passing through, source and draft set, a manual draft with no draft ref, and a null source with no draft ref.
  - `taskSourceLink`: `?thread=` and `?message=`.
  - `unresolvedNamesHint`.
- **Extra requirement 1.** `chat-message-item.tsx` renders `meta.taskDrafts` only when `authorKind === 'agent'`. Legacy `taskSuggestions` keep their old card. `readTaskDrafts` normalises odd payloads, so a malformed meta cannot crash the item.

### Phase 09
- **9.1 ADR-012.**
  - New section "Chuỗi, chủ đề, nhóm phòng ban và tạo việc từ chat (2026-10-26)". It covers:
    - the 4 decisions and the deviation from Lark;
    - the data model;
    - the unread and follow rules;
    - `thread.updated`;
    - old replies becoming quote replies, and why;
    - the `[TASK]` format;
    - the D1 budget;
    - the advisor defaults for open questions 2–6.
  - The 4 alternatives were added under "Phương án đã xét".
  - `thread.updated` was added to the realtime bullet.
  - One sentence was added to the old `[TASK: …]` paragraph pointing to the new format.
- **9.2 User guide** `docs/guides/chat-user-guide.md`. It has the 8 required sections, and the FAQ has 7 Q&As. It covers these run-report behaviours:
  - department groups are synced from the staff list;
  - manual adds are removed, and directors and Admins are not added;
  - nobody can leave a department group;
  - Trợ lý answers inside the topic in topic mode;
  - the offline or no-agent path goes straight to the manual form;
  - "Tự tạo việc" appears after a failed draft;
  - direct chats always get the manual draft.
- **9.3 GoClaw section 7 and README.**
  - The `[TASK]` sample was copied exactly from the phase file. The required rule sentence is in the prompt verbatim.
  - The rule that the agent never claims to have created anything is kept.
  - The doc notes that the legacy line still works.
  - The README "Hướng dẫn" line now links the guide.

## Files
Created:
- `apps/crm/src/web/chat-task-draft.ts` (pure): `TaskFormInitialValues`, `draftToInitialValues`, `taskSourceLink`, `unresolvedNamesHint`.
- `apps/crm/src/web/components/chat-task-cards.tsx`: `useTaskDraftRequest`, `DraftCard`, `TaskCard`, `FailedDraft`, `readTaskDrafts`, `readTaskCard`, `readFailedDraftSource`.
- `docs/guides/chat-user-guide.md`

Modified:
- `apps/crm/src/web/components/task-form-dialog.tsx`
- `apps/crm/src/web/components/chat-message-item.tsx`
- `apps/crm/src/web/components/chat-thread-panel.tsx`
- `apps/crm/src/web/components/chat-topic-list.tsx`
- `apps/crm/src/web/pages/task-detail.tsx`
- `apps/crm/src/web/types.ts`
- `apps/crm/src/web/styles.css` (one new section appended, `chat: task drafts, task cards`; nothing else changed)
- `apps/crm/test/web-chat.test.ts`
- `docs/adr/adr-012-internal-chat-in-crm.md`
- `docs/integrations/goclaw-inbox-agents.md` (section 7 only)
- `docs/README.md`

## Verify commands
| Step | Command | Exit | Key output |
|---|---|---|---|
| 8.1–8.3, 8.4.2 | `pnpm --filter @abm/crm typecheck` | 0 | worker and web tsc clean |
| 8.4.1 | `pnpm --filter @abm/crm test -- web-chat.test.ts` | 0 | 1 file, 23 tests passed (17 before) |
| 8.4.3 (bundle) | `pnpm --filter @abm/crm build` | 0 | `✓ built in 3.67s` (only the usual chunk-size warning) |
| gate | `pnpm -r typecheck` | 0 | all packages done |
| 8.4.4 + gate | `pnpm -r test` | 0 | crm: 61 files passed, 1 skipped; 756 tests passed, 2 skipped. lms-core 12, zalo-bridge 114, goclaw-identity 8, d1-guard 8, lms 17, all passed |
| 9.1 | `Select-String -Path docs/adr/adr-012-internal-chat-in-crm.md -Pattern 'thread_root_id','chat_thread_follower','dept:','\[TASK\]'` | – | 7 matches (≥4) |
| 9.2 | `Test-Path docs/guides/chat-user-guide.md` / `Select-String … 'Cũng gửi vào nhóm','Chủ đề','Tạo việc từ chuỗi','Tự tạo việc'` | – | `True` / 20 matches (≥4) |
| 9.3 | `Select-String -Path docs/integrations/goclaw-inbox-agents.md -Pattern '\[/TASK\]'` / `Select-String -Path docs/README.md -Pattern 'chat-user-guide.md'` | – | 3 matches / 1 match |
| links | a script that resolves every relative markdown link in the 4 docs | – | no missing targets |

"Crm bundle script": `apps/crm` has no separate bundle script, so I ran `vite build` (`pnpm --filter @abm/crm build`).

## Deviations and why
1. **The pure helper lives in `src/web/chat-task-draft.ts`.** The phase allows this. `TaskFormInitialValues` moved there so the test can import it without React. `task-form-dialog.tsx` re-exports the type, so existing imports keep working.
2. **Some extra exports in `chat-task-cards.tsx`.** These are `readTaskDrafts`, `readTaskCard` and `readFailedDraftSource`, which defensively read the untyped `meta`. `readTaskDrafts` keeps each draft's original array index, so `draft.index` always matches the server's `$.taskDrafts[index]`.
3. **The "Tạo từ chat" line is specific to the scope.** It reads "…gửi lại vào chuỗi" for a thread and "…vào tin gốc" for a message. The phase wrote "chuỗi/tin gốc".
4. **The task-detail link is an `<a href>` that calls `navigate({ href })`.** It does not use `<Link to>`. This is the same reason as the bell fix in the L06 report: `to` would read `?thread=` as part of the path. Ctrl/middle-click still opens a new tab.
5. **The requester's name on other people's draft cards comes from the cached `/directory` query.** `meta` only holds the requester's id. The query runs only while a draft is waiting, and it falls back to "người yêu cầu".
6. **`FailedDraft` also renders on agent messages.** This covers an agent answer without a valid block, which carries `taskDraftFailed` on an agent-authored message. The system failure message also gets it.
7. **ADR line 25.** One sentence was added to the existing `[TASK: …]` paragraph so the ADR does not contradict itself. Everything else is in the new section.
8. **GoClaw prompt.** Besides the required rule, the prompt includes a template of the block with placeholders. The sample with real names is in the doc body, copied exactly from the phase file.

## Docs checked against code (file references)
- **Department sync:** `worker/chat-groups.ts:6-33`.
  - Only active users of the department are added. A head becomes the owner.
  - Anyone else, including manual adds, is deleted.
  - Directors and Admins have no department, so they are not added.
- **Hand edits refused:** `chat-routes.ts:386,431` (403 for any `system_key` group, so nobody can leave or be added by hand).
- **Subgroups:** `chat-routes.ts:182-216`. A member of the department group, a director or an admin can create one. The creator is the owner, and members can come from any department.
- **Mode switch:** owner, director or admin, and not the Inbox group (`chat-routes.ts:314-329`).
- **Close topic:** the root author, owner, director or admin (`chat-routes.ts:933-935`). A closed topic refuses user replies (`chat.ts:778`).
- **Auto-follow:** the root author, the replier and mentioned people (`chat-threads.ts:89-91`). The main-flow unread rule is in `chat.ts:326`.
- **Draft turn:** the request line is in `chat-agents.ts:624`. The failed meta is in `chat-agents.ts:797-799` and `869-873`.
- **D1 figures:** from the run reports. A message send is d1 14 (L02). The cron is d1 35 (L02). A task create is d1 15, 22 pushes and 3 hub calls (L04).

## Unsure
- The UI was only typechecked and built. There are no browser tests in the repo. The live check at phone and desktop widths is in the release phase.
- A second "Tạo việc" request within 10 minutes for the same source is deduped server-side, so it does not reopen a manual path. The guide tells users to wait or to use "Tự tạo việc" once it appears. There is no separate "make it by hand now" button while Trợ lý is drafting, because the phase did not ask for one.
- The phase files and the plan status were not ticked, because they are not on the allowed-file list.

Status: DONE
Summary: Phases 08 and 09 are complete. The web task-from-chat flow (both entry points, draft, task and failed cards, task-detail link) and the docs are in place, and typecheck, the full test suite (crm 756 passed) and the crm build all exit 0.
Concerns/Blockers: none. UI behaviour is verified by typecheck, build and unit tests only. The live check is left to the release phase.
