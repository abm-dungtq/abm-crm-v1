# Run U4: security hardening, review fixes, re-audit fixes, sale dashboard crash

Date: 2026-10-27 (Asia/Saigon). Work tree: D:\TQD\CRM (no git writes, no deploy, dev servers left untouched).

## Gates

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 (all 7 packages "Done") |
| `pnpm --filter @abm/crm test` | 63 files passed, 1 skipped; 819 tests passed, 2 skipped. This includes `message_budget`/`task_budget` and the new tests. |
| `pnpm --filter @abm/crm build` | exit 0. The only output is Vite's existing warning that a chunk is over 500 kB. |
| H1 timing test (200 mentions + 10 kB, < 50 ms) | passes |
| `/` as a sales user (u-lan), no console errors | verified in the browser at 1440/768/375 |

## Items done and how each was verified

### 1. H1: regex hardening (security)

- **Trailing and leading mentions in titles.** `TRAILING_MENTIONS` and `LEADING_MENTIONS` are gone. `stripAddressedMentions` now:
  - finds every mention once (`matchAll` with bounded `MENTION_SOURCE`);
  - walks the spans from both ends with index loops over single-character gap sets;
  - turns mentions in the middle of a sentence into plain names.
  The trailing noise and particles ("ạ", "nhé", "nha") are trimmed by moving an end index. `flatten` now splits and trims instead of using a `\s*` regex.
- **Mention parsing.** `parseMentions`, `parseUserMentions`, `parseAgentMentions` and `renderMentionText` share one bounded `MENTION_SOURCE`: `@\[([^\]]{1,200})\]\((user|agent):([^)\s]{1,128})\)`.
- **Task marker keys.** `KEY_LINE_RE` took 1.1 s on 10k spaces. It is replaced by `splitKeyLine`: `indexOf(':')`, then a trimmed key of 1 to 40 characters.
- **Date field.** `parseFieldInput` no longer uses `\s+lúc\s+`. It collapses whitespace first, then does a literal replace.
- **Tests** in `test/chat-task-from-chat.test.ts` and `test/chat-task-markers.test.ts`:
  - 200 mentions plus 10 kB of text, under 50 ms;
  - hostile inputs ("@[" ×5000, 10k spaces, 10k "ạ "), each under 50 ms;
  - title cases with gaps (comma, dash, semicolon) between mentions;
  - key spacing in task markers.

Regex verdicts. Every regex added or changed in this release:

| Regex (file) | Verdict |
|---|---|
| old `LEADING_MENTIONS` / `TRAILING_MENTIONS` (chat-tasks.ts) | Super-linear (nested `(?:mention\s*)+` with optional gaps). **Removed**, replaced by an index loop. |
| old `TRAILING_NOISE` (chat-tasks.ts) | Quadratic on long whitespace (36.9 ms on 10k spaces). **Removed**, replaced by an end-index loop. |
| old `flatten` `\s*\n\s*` (chat-tasks.ts) | Quadratic on whitespace (29.6 ms on 10k spaces). **Replaced** with split/trim/join. |
| old `KEY_LINE_RE` (chat-task-markers.ts) | Super-linear (1110 ms on 10k spaces). **Replaced** with `indexOf`. |
| old mention regex `@\[([^\]]+)\]\(...\)` (chat.ts, mention-input.tsx, chat-task-draft.ts, chat-composer.tsx) | Quadratic on "@[" ×5000 (14.8 ms). **Bounded** to `{1,200}` / `{1,128}`. |
| old `\s+lúc\s+` (date-time.ts) | Quadratic on whitespace. **Replaced** (collapse, then a literal replace). |
| `MENTION_SOURCE` (new, chat.ts) | Linear: literal delimiters, bounded classes. |
| `MENTION_GAP_CHAR`, `SPACE_CHAR`, `TRAILING_PUNCT_CHAR` (chat-tasks.ts) | Single character, tested one character at a time. Linear. |
| `/\s+/g` collapse, `/[\r\n]+/` split (chat-tasks.ts) | Linear (single class, no nesting). |
| `BLOCK_OPEN_RE`, `BLOCK_CLOSE_RE`, `LEGACY_LINE_RE` (chat-task-markers.ts) | Linear: anchored, groups separated by literals. Measured at 0.1 ms. |
| `calendarDate`, `/^@+/`, `/[,;]/`, `/^\n+/` (chat-task-markers.ts / chat-tasks.ts) | Linear. |
| text-search `/[\u0300-\u036f]/g`, `split(/\s+/)` | Linear. |
| date-time `DATE_RE`, `TIME_RE`, `splitFieldValue` | Anchored and bounded quantifiers. Linear. |
| `detectActiveMention` `(?:^|\s)@([^@\n\r[\]()]{0,40})$` (mention-input.tsx) | Bounded to 40. Accepted. |
| chat-message-item `/…$/` | Literal. |

### 2. M1: drafts keyed per user

- **Key.** `chatDraftKey(userId, conversationId, threadRootId?)` returns `chat-draft:{userId}:{conversationId}:{root|main}`, and the composer uses it.
- **Clearing.** `clearChatDrafts()` removes every `chat-draft:` key and never throws. It runs on logout (`LogoutButton`, before the POST) and on a demo user switch (`setDemoUser`, when the id changes).
- **Tests.** `test/web-chat.test.ts` covers the key shape and the clearing.

### 3. M2: date-time commit only on blur, Enter or a pick

- **Behaviour.** `DateTimeField` keeps the typed text while you type. It commits only on blur, on Enter or on a calendar or quick pick. An entry it cannot read reverts to the value the field had when it gained focus.
- **Helper.** The logic lives in `commitFieldText`.
- **Tests.** `test/web-tasks.test.ts`:
  - "2" over 30/10 09:00 reverts;
  - "31/10 14h" commits;
  - a day alone keeps the existing time;
  - empty text clears the field;
  - an unreadable entry over an empty field stays empty.

### 4. M3, M4, M5, L1–L5

- **M3 (Kanban menu).** `OverflowMenu` now closes outside presses with a capture-phase document listener, and handles Escape in its own React `onKeyDown`. A parent that stops propagation (the draggable card) can no longer hide either event.
  - *Verified in the browser:* Escape closes the card menu and focus returns to "⋯". With a real pointer, opening a second card's menu closes the first (1 menu open, 1 `aria-expanded=true`).
- **M4 (focus return).**
  - `Modal` remembers the element that had focus when it opened. On close or unmount it restores focus there.
  - Choosing a menu item puts focus back on "⋯" before the item's action runs, so a dialog opened from the menu returns to "⋯".
  - *Verified:* recall confirm, then Esc, leaves focus on "Thao tác với tin". Task "Hoàn thành" dialog, then Esc, leaves focus on "Hoàn thành".
- **M5 (search drops keystrokes).** A `lastPushedQ` ref ignores the URL echoing back the value this page pushed.
  - *Verified:* typed "liên hệ lần đầu" with random 90–340 ms gaps around the 250 ms debounce. The input and URL both ended with the full text.
- **L1 (fresh "Tin mới" snapshot).** On open, the conversation list is refetched. The snapshot waits for a list (or an error) newer than the open time. Marking read already waits for the snapshot.
- **L2 (Kanban "Xong").** The "Xong" column ignores the due filter.
- **L3 (recall confirm).** The recall `ConfirmDialog` mounts only while it is open.
- **L4 (thread flow).** New `buildThreadFlow(root, replies)` builds one flow over `[root, ...replies]`. The thread panel uses it.
  - *Verified:* the thread panel shows one "Hôm nay" (it showed two before).
  - Tests in `test/web-chat-flow.test.ts`.
- **L5 (keyboard and ARIA).**
  - `OverflowMenu` handles ArrowUp/ArrowDown (wrapping), Home, End and Tab (closes). ArrowDown/ArrowUp on the button opens the menu. `aria-controls` is set only while the menu is open.
  - Combobox and MultiCombobox set `aria-controls` only while the list is shown.

### 5. N-01: page scroll on chat

- **Fix.** `.inbox-messages` has `position: relative`. That class is shared by the main list, the thread panel and the topic list.
- **Verified** on `/chat/<id>?thread=<root>` (thread panel open) and `/chat/<topic-group>`: `scrollHeight` was 900 with `innerHeight` 900 at 1440, 768 and 375, and there was no horizontal overflow.

### 6. Re-audit items

- **Group pickers.**
  - "Tạo nhóm" uses a Combobox for "Thuộc phòng ban" (placeholder "Nhóm thường", with a clear button).
  - The chip wall is replaced by a MultiCombobox: max 50, which matches the server limit; label "Thành viên (n/50 đã chọn)"; tag list "Thành viên đã chọn".
  - The group settings add-member select is now a Combobox.
  - *Verified* at 1440 and 375: picking a member adds a tag, with no overflow.
- **N-03 (duplicate day label).** Fixed by the thread flow (see L4).
- **N-02 (clipped message menu).** The menu renders in a portal (the open `<dialog>` if there is one, otherwise `body`). It is fixed-positioned and flips above "⋯" when there is no room below.
  - *Verified:* the last message's menu opened upward (`bottom: 162px`, fully inside the 900 px viewport, parent `BODY`).
- **Grouped bubbles.**
  - The time shows only on the last bubble of a run (`endsRun`). Other bubbles carry the full time as a tooltip.
  - The "⋯" of a mid-run bubble sits beside the bubble, so the run stays tight.
  - The meta row of your own messages is right-aligned, with the time last.
  - Tests cover `endsRun`.
- **Badges and subtitles.**
  - The "Next Action" badge now reads "Việc tiếp theo" in the neutral (muted) tone on the task list, Kanban and task detail.
  - The `NextActionFields` default legend is "Việc tiếp theo".
  - Kanban "Xong" subtitle: "Hoàn thành gần đây, tối đa 50 việc".
  - Dashboard card: "Việc sắp tới".
- **Mobile task rows (≤ 600 px).**
  - A "Lọc" button shows a count of active filters (person, status, due) and folds the other filters away. It has `aria-expanded` and `aria-controls`.
  - Titles are clamped to 2 lines, with the full title as a tooltip.
  - The due time, "Hoàn thành" and "⋯" move to a line under the title.
  - *Verified* at 375: badge shows "Lọc 1" after picking "Quá hạn", and there is no overflow.
- **Priority.** A `PriorityControl` (a SegmentedControl that fills the field width) replaces the select in the task form dialog and in task detail. It has 4 values: Thấp, Bình thường, Cao, Khẩn cấp.
  - *Verified* at 1440, 768 and 375: no overflow, and `aria-pressed` reflects the value.
- **Description from a chat thread.** Lines are now "Tên: nội dung" with no timestamps. The task already links to its source.

### 7. Task detail: one primary button

- The header "Hoàn thành" is secondary while there are unsaved edits. "Lưu thay đổi" is then the primary button.
- The quick subtask "Thêm" is secondary.
- *Verified:* before an edit the primary is "Hoàn thành". After editing the title the primary is "Lưu thay đổi".

### 8. Sale subtitle

The `/tasks` subtitle for Sale is now "Việc bạn phụ trách, cùng làm hoặc đã tạo." This matches `taskScope`: CRM tasks assigned to the sale, plus internal tasks they created, are assigned or are a member of. *Verified* in the browser.

### 9. Sale dashboard crash

- **Cause, proven.**
  - `dashboard()` sets `upcoming` from `listTasks`, which includes internal tasks with `lead: null`.
  - `dashboard.tsx` read `t.lead.pipeline` for every upcoming item.
  - The web type wrongly claimed the lead was never null.
  - The dev database had this case live: `/api/dashboard` for u-lan returned two `kind: internal` items with no lead in `upcoming` ("Gửi báo giá cho Công ty Lộc Thọ" and "Anh cập nhật vào báo giá giúp em").
- **Fix.**
  - `upcoming` is typed `TaskItem[]`.
  - An internal task renders with a "Việc nội bộ" badge.
  - Every title links to `/tasks/$taskId`.
  - A task with no due date shows "Chưa đặt hạn".
  - The task KPI query uses `LEFT JOIN lead`, so the counts match `/tasks`.
- **Verified.** `/` for u-lan renders both internal tasks with no console errors at 1440, 768 and 375.
- **Test.** `test/task-engine.test.ts`, "a sale sees their internal task on the dashboard, without a lead, and in its task counts":
  - a sales user creates an internal task;
  - the dashboard returns 200 with the task as `{kind: 'internal', lead: null}`;
  - the overdue and today KPIs equal the `/tasks` bucket counts.

## Extra fix found during browser checks

The new Modal focus-restore cleanup closed the dialog. In React's development double-run of effects, that close fired the `close` event, which called `onClose`. Any dialog mounted already open (the recall confirm, "Hoàn thành việc") then shut itself immediately. A close made by the cleanup is now silent. After the fix, the recall confirm and the complete-task dialog both open, and both return focus on Esc.

## Files changed in this run

- **Worker:**
  - `apps/crm/src/worker/chat.ts`
  - `apps/crm/src/worker/chat-tasks.ts`
  - `apps/crm/src/worker/chat-task-markers.ts`
  - `apps/crm/src/worker/queries.ts`
- **Web:**
  - `apps/crm/src/web/api.ts`
  - `apps/crm/src/web/chat-links.ts`
  - `apps/crm/src/web/chat-flow.ts`
  - `apps/crm/src/web/chat-task-draft.ts`
  - `apps/crm/src/web/date-time.ts`
  - `apps/crm/src/web/types.ts`
  - `apps/crm/src/web/styles.css`
- **Web components:**
  - `components/ui.tsx`
  - `components/floating.ts`
  - `components/combobox.tsx`
  - `components/icons.tsx` (adds a "filter" icon)
  - `components/date-time-field.tsx`
  - `components/mention-input.tsx`
  - `components/chat-composer.tsx`
  - `components/chat-message-item.tsx`
  - `components/chat-thread.tsx`
  - `components/chat-thread-panel.tsx`
  - `components/chat-group-settings.tsx`
  - `components/task-board.tsx`
  - `components/task-form-dialog.tsx`
  - `components/lead-actions.tsx`
- **Web pages:**
  - `pages/chat.tsx`
  - `pages/tasks.tsx`
  - `pages/task-detail.tsx`
  - `pages/dashboard.tsx`
  - `pages/change-password.tsx`
- **Tests:**
  - `apps/crm/test/chat-task-from-chat.test.ts`
  - `apps/crm/test/chat-task-markers.test.ts`
  - `apps/crm/test/web-chat.test.ts`
  - `apps/crm/test/web-chat-flow.test.ts`
  - `apps/crm/test/web-tasks.test.ts`
  - `apps/crm/test/task-engine.test.ts`

`README.md` and `.claude/` show as modified in `git status`, but those changes come from earlier runs. This run did not touch them.

## Screenshots (`plans/reports/ux-upgrade-261027/run-u4/`)

- **Dashboard (sale):** `dashboard-sale-{1440,768,375}.png`
- **Tasks (sale):** `tasks-sale-{1440,768,375}.png`, `tasks-sale-375-filters-open.png`
- **Kanban:** `kanban-menu-open-1440.png`
- **Chat:**
  - `chat-thread-{1440,768,375}.png`, `chat-topic-{1440,768,375}.png`
  - `chat-message-menu-flip-1440.png`, `chat-recall-confirm-1440.png`
  - `chat-create-group-{1440,375}.png`
- **Task detail:** `task-detail-dirty-{1440,768,375}.png`

The browser session was closed at the end.

## Deviations

- **Priority** keeps all 4 values, as the brief allows.
- **Thread description** drops timestamps instead of adding a link per line, because the task already links to its source chat.
- **Mentions** are now limited to 200 characters for a name and 128 for an id. Longer ones are not recognised as mentions.
- **Dashboard task KPIs** ("Việc hôm nay", "Việc quá hạn") and the truncation totals now include internal tasks, matching `/tasks`.
- **"Việc tiếp theo"** uses the existing neutral Badge tone, not a new style.

## Not verified / open

- **"Gửi" button on task detail.** At 1440 px, the comment composer's "Gửi" button is also teal (it is disabled while empty) and sits next to the details pane. The brief only asked to demote "Hoàn thành" and "Thêm", so "Gửi" was left as it is.
- **Keyboard check on Kanban arrows.** Arrow/Home/End navigation was exercised on a single-item Kanban menu. The longer message menu got the first-item focus check, but not a key-by-key run.
- **L1 refetch.** Checked by reading the code and by the existing tests. A two-user race (a message arriving between list load and open) was not reproduced in the browser.

Status: DONE_WITH_CONCERNS
Summary: All brief items are implemented, and typecheck, the 819-test CRM suite (including the H1 timing and budget tests) and the build pass. The sale dashboard crash (internal tasks with no lead) is proven, fixed and tested, and the browser checks at 1440/768/375 found no console errors.
Concerns/Blockers: On task detail at desktop width, the comment composer's "Gửi" is still a teal primary button next to the details pane. Keyboard arrow navigation was only run key by key on a one-item menu.
