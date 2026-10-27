# Run U3: chat structure (2026-10-27)

All requested items are done, and the three gates pass. Every acceptance check was verified in the browser at 1440, 768 and 375 (agent-browser, demo user `u-huy`), with unit tests behind the pure parts. Screenshots are in `plans/reports/ux-upgrade-261027/run-u3/`. The browser session was closed at the end.

## Gates

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 |
| `pnpm --filter @abm/crm test` | exit 0. 63 files passed and 1 skipped; 810 tests passed and 2 skipped. Both skips were there before this run. The `task_budget` and `message_budget` tests are green. |
| `pnpm --filter @abm/crm build` | exit 0. Only the existing chunk-size warning appears. |

## Items and how each was verified

### Unread wayfinding

**"Tin mới" divider**
- `ChatThread` reads the conversation's `lastReadAt` and `unread` from the cached conversation list when the conversation opens. Marking it read waits until that snapshot exists, so the snapshot is always taken before mark-read runs.
- The divider goes above the first message from someone else that is newer than the snapshot. It is drawn only when `unread > 0` at open.
- The snapshot is kept per conversation id, so the divider stays in place until the person leaves the conversation.
- On open, the list scrolls so the divider sits near the top. A `?message=` deep link takes precedence over this. After the first open, new messages scroll to the bottom as before.
- Browser checks:
  - At 1440: Huy had 4 unread. Four seconds after opening, the badge had cleared (marked read), and the divider was still above Lan's first new message (`1440-chat-new-divider.png`).
  - At 768: Lan posted 3 messages, and the divider sat above the first of those 3 (`768-chat-new-divider.png`).
  - At 375: same check with 2 messages (`375-chat-new-divider.png`).
  - After a reload, once the conversation was read, there was no divider (`768-chat-conversation.png`).

**"Chưa đọc" chip**
- The list chips are now Tất cả / Chưa đọc (with a count) / Chuỗi.
- "Chưa đọc" keeps conversations with unread messages or unread followed-thread replies.
- The open conversation stays in the filtered list after it is read, so it does not vanish while the person is in it.
- Browser checks: `1440-chat-unread-filter.png` and `375-chat-unread-filter.png`. With the filter on, opening a conversation left it listed, with its badge cleared (`1440-chat-new-divider.png`).

**List search**
- The search matches conversation titles only, ignoring accents and case. It reuses U2's `matchesSearch`, through a new `filterConversations` in `chat-tree.ts`.
- When a filter is active, empty sections are hidden. If nothing matches, the list shows "Không có hội thoại nào …" with a "Xóa bộ lọc" button. Escape clears the search.
- Browser checks:
  - "lộc", "loc tho" and "loc" each found both "Dự án Lộc Thọ" groups (`1440-chat-list-search.png`, `375-chat-list-search.png`).
  - "xyz" showed the empty state (`1440-chat-list-search-empty.png`).

### Message grouping and day separators
- `buildChatFlow` in the new `src/web/chat-flow.ts` builds the list rows:
  - a day separator before each new Vietnam calendar day ("Hôm nay", "Hôm qua", otherwise dd/MM/yyyy);
  - the "Tin mới" divider;
  - `continued` on a message that follows one by the same person or agent within 5 minutes, with no separator in between. System messages never group.
- A continued message has no avatar (a spacer keeps the alignment) and no name. Screen readers still get a hidden "Name:" before each continued message.
- The author name moved from under the bubble to a line above the first bubble of each run. Own messages show no name line.
- Message times are now HH:mm, with the full date and time in the tooltip.
- The same rows are used in the main flow, in task comments, and in the thread panel (root and replies).
- Browser checks:
  - `1440-chat-day-separators.png` shows "20/10/2026", "Hôm qua", "Hôm nay" and "Tin mới".
  - Three messages from Lan within a minute show one avatar and one name (`768-chat-new-divider.png`).

### Task from chat
**Form**
- The form already used the shared Combobox and DateTimeField from U2.
- Its title is now "Tạo việc từ chat".
- A source box shows the scope, a one-line quote of the source, and where the card will go:
  - for a message: "Từ một tin nhắn", with "Thẻ việc sẽ được gửi trả lời ngay tin này.";
  - for a thread: "Từ cả chuỗi trả lời", with "Thẻ việc sẽ được gửi vào cuối chuỗi.".
- The quote comes from:
  - the message, for "Tạo việc từ tin này";
  - the thread root, for "Tạo việc" in the panel;
  - the cached main-flow messages, for an agent draft card.
- Browser checks: `1440-manual-task-from-message.png`, `1440-agent-draft-form.png`, `1440-thread-task-form.png`, `375-thread-task-form.png` (no overflow).

**Server: `buildManualTaskDraft` / `draftTitleFrom`**
- Title, from the first line that has words:
  - mentions at the start or end (the people being addressed) are removed;
  - mentions inside the sentence are kept as plain names;
  - trailing punctuation and the closing particles "ạ", "nhé" and "nha" are stripped, repeatedly;
  - the first letter is capitalised, and the length cap is still 200.
- Description for a thread: the root, then "…" when older replies were left out, then the newest 5 replies. The 5000-character cap is kept.
- `assigneeUserId` is the mentioned member when exactly one member is mentioned. That person is removed from `memberUserIds`. The mentions are still collected from the root and its newest 50 replies, as before.
- Browser check: the message "Anh @Bùi Quang Huy gửi giúp em báo giá Lộc Thọ nhé ạ." prefilled the title "Anh Bùi Quang Huy gửi giúp em báo giá Lộc Thọ" and the assignee "Bùi Quang Huy".
- Tests in `test/chat-task-from-chat.test.ts`:
  - two existing tests were updated for the new title and assignee;
  - a new test checks that a thread draft quotes the root, a "…" line and only the newest 5 replies, and that no assignee is set when two people are mentioned;
  - a new title-cleanup test covers addressed mentions, inline mentions, particles, punctuation, "Gia Nha" being kept, a mention-only first line, empty input and the length cap.

### Unit tests for the pure parts
`test/web-chat-flow.test.ts` (new) covers:
- day labels, including the Vietnam/UTC midnight edge and the year boundary;
- HH:mm times;
- grouping: 5-minute window, author changes, system messages, agents, and a day break;
- the divider position: own messages ignored, no read marker, all messages read, a bad marker;
- the conversation filter: accents, unread, and the open-conversation rule;
- `taskSourceSummary`.

## Local seed data (local D1 only, never remote)
Inserted through the running dev API (`127.0.0.1:8787`, demo headers) and `wrangler d1 execute abm-crm-eval --local`. The scripts are in `%TEMP%\grok-crm\u3\` (`seed.mjs`, `seed.sql`, `more.mjs`).
- A group "Dự án Lộc Thọ" (`9a855678-cf36-4168-9aa6-2cdad69849de`). Lan created it, with Huy, Long and Hùng.
- Messages in that group:
  - one back-dated to 20/10;
  - two back-dated to yesterday;
  - Huy's `last_read_at` set to yesterday 15:02;
  - three messages from Lan today, the third with 2 attachments: `yeu-cau-bao-gia.png` (1×1) and `ghi-chu-khach.txt`;
  - 5 more messages from Lan during the browser checks.
- One agent message, `agent:u3-seed-draft`. Its `meta_json.taskDrafts[0]` is a draft for Huy, sourced from Lan's message, with one unresolved name "Hoàng Mai".
- An earlier run had already created another group with the same title. That is why "lộc" finds two groups.

## Files changed
- New:
  - `apps/crm/src/web/chat-flow.ts`
  - `apps/crm/test/web-chat-flow.test.ts`
- Modified:
  - `apps/crm/src/worker/chat-tasks.ts`
  - `apps/crm/src/web/types.ts`: `ChatManualTaskDraft.assigneeUserId` is now `string | null`.
  - `apps/crm/src/web/chat-tree.ts`: `hasUnread`, `filterConversations`.
  - `apps/crm/src/web/chat-task-draft.ts`: `sourceExcerpt`, `taskSourceSummary`.
  - `apps/crm/src/web/pages/chat.tsx`
  - `apps/crm/src/web/components/chat-thread.tsx`
  - `apps/crm/src/web/components/chat-thread-panel.tsx`
  - `apps/crm/src/web/components/chat-message-item.tsx`
  - `apps/crm/src/web/components/chat-task-cards.tsx`
  - `apps/crm/src/web/components/task-form-dialog.tsx`
  - `apps/crm/src/web/styles.css`
  - `apps/crm/test/chat-task-from-chat.test.ts`

## Deviations and decisions
- **Mentions in the title.** Stripping every mention would leave broken sentences ("Gửi báo giá cho trước thứ 6"). So only the addressed mentions at the start or end are removed, and inline mentions become plain names.
- **Particles are stripped only in lower case.** This keeps names such as "Gia Nha".
- **Day separator format.** It follows the brief (dd/MM/yyyy), not the audit's "Thứ Hai 20/10".
- **Divider with no read marker.** When `lastReadAt` is null but there are unread messages, the divider goes above the first message from someone else. No divider is drawn when the unread count at open is 0.
- **The search and "Chưa đọc" filter are kept in memory, not in the URL.** They survive the route switching between `/chat` and `/chat/:id`, and a reload starts clean.
- **The agent badge "Trợ lý" is hidden when the agent is itself named "Trợ lý".** Before, it read "Trợ lý Trợ lý".
- **The form stays a modal, not a side drawer.** The brief asks only for the shared inputs and a clear source.
- **Topic mode.** `ChatTopicList` has no divider or grouping. In topic mode the form says "chuỗi" because the form does not know the thread is a topic.

## Not verified
- **Inline images and file links in demo mode.** Plain `<img>` and link requests carry no `X-Demo-User` header, so `/api/chat/attachments/:id` returns 401 and the image shows as broken. This is a limitation of demo mode from before this run; with a real session cookie they load. The attachment message itself rendered: a file chip with its size, and image alt text.
- **Thread panel grouping with real replies.** The demo threads have 0 replies. Grouping there uses the same unit-tested `buildChatFlow`.
- **Divider near the top when content is short.** The 8px top offset only applies when there is enough content below the divider; otherwise the list stops at the bottom, which is expected.
- **Screen reader and real touch device.** Not run.

Status: DONE
Summary: The "Tin mới" divider, "Chưa đọc" chip, accent-insensitive list search, message grouping with day separators, a clear source in the task-from-chat form, and cleaner manual drafts (title, last 5 replies, single-mention assignee) are in place. They were checked in the browser at 1440, 768 and 375, and typecheck, tests and build all pass.
Concerns/Blockers: Inline attachments return 401 in demo mode (a limitation from before this run). Thread-panel grouping was checked only by unit tests.
