# UX re-audit: Chat and Tasks after upgrade runs U1–U3 (27/10/2026)

Audit only; no source file was changed. Independent of the runs that built the upgrade.
Baseline: `plans/reports/ux-audit-261027-chat-tasks.md` (chat 12/24, tasks 13/24, 34 findings).
Evidence: `plans/reports/ux-reaudit-261027-chat-tasks/` (`<viewport>-<page>-<state>.png`).
Method: `self-critique-loop.md` rubric, judged against `ux-polish-standards.md` and `product-ui-patterns.md`.
Notation: **[Observed]** means seen or measured in the running app; **[Code]** means read in source; **[Run]** means taken from a run report and not re-checked here.

## Verdict

The upgrade is real and large. Chat went from 12 to 19 and Tasks from 13 to 16. Ten of the twelve baseline Majors are closed, and the two worst baseline defects (the broken task card and the US-format dates) are gone. **The bars are not met.** Chat misses 20 by one point. Item 9 (responsive) and item 12 (craft) score 1 on both screens. Two baseline Majors are only partly closed. The upgrade also introduced one new Major: in an open conversation the whole page scrolls under the shell, on desktop and on mobile.

## Coverage

| Item | Detail |
|---|---|
| Environment | http://localhost:5173 in demo mode with local seed data. `agent-browser` sessions `reaudit-a` (Lan, Sale), `reaudit-b` (Nguyễn Minh Anh, BGĐ) and `reaudit-c` (Huy, Sale). All three were closed at the end. |
| Viewports | 1440×900, 768×1024, 375×812. |
| Data created (local) | Two thread replies and one task, "Anh cập nhật vào báo giá giúp em", created from a thread in "Dự án Lộc Thọ". Five main-flow messages from Lan in "Dự án Lộc Thọ". |
| Not checked | Real touch device (`pointer: coarse` cannot be emulated), screen reader, dark mode, the "Thêm trợ lý" dialog, and the DM switch (C-16), which relies on the run evidence. Demo images return 401, which is a known demo-only limit and is not scored. |

---

## 1. Rubric scores (0–2)

### Chat (`/chat`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 2 | `1440-chat-loctho-lan.png`: a dark rail, a cool workspace, teal own bubbles, a violet agent bubble and one teal accent. It reads as tidy, calm and dependable, which matches the Scene. |
| 2 | Hierarchy | 2 | `1440-chat-thread-panel-empty.png`: one-row panel header ("Chuỗi / Dự án Lộc Thọ", "Tạo việc", "⋯", close); conversation header actions collapse to icons while the panel is open. |
| 3 | Spacing rhythm | 1 | `768-chat-conversation.png`: runs are grouped, but "14:34" sits under every bubble of a run, so gaps inside a run equal gaps between runs. |
| 4 | Alignment | 1 | `1440-chat-keyboard-focus.png`: timestamps under right-aligned own bubbles sit at each bubble's left edge (x = 1107, 1132, 1137, 1157, 1232), which gives a ragged column. |
| 5 | Typography | 1 | One family renders Vietnamese well, but 13 font sizes remain in `styles.css` (B10 deferred). Name 12px, time 12px, body 14.5px and chip 13px all appear in `1440-chat-loctho-lan.png`. |
| 6 | Color discipline | 2 | `1440-chat-default-lan.png`: teal marks only the primary action, the selected chip and the selected rail item. Red marks only unread and "Tin mới". |
| 7 | Depth and shape | 2 | `1440-chat-agent-draft-card.png`: hairline borders with a light shadow; 14px bubbles, 8px cards and menus, pill chips, used consistently. |
| 8 | States and feedback | 2 | `1440-chat-new-divider-huy.png` (divider), `1440-chat-list-search-empty.png` (echoes the query, "Xóa bộ lọc"), `1440-chat-recall-confirm.png`, `1440-chat-keyboard-focus.png` (visible focus ring), `1440-chat-task-created-card.png` (toast with "Mở việc"). |
| 9 | Responsiveness | 1 | `375-chat-page-scroll-regression.png`: the document is 2030px tall in an 812px viewport, so the conversation scrolls away and leaves an empty grey screen (N-01). There is no horizontal overflow. |
| 10 | Slop tells | 2 | None. |
| 11 | Content and copy | 2 | `1440-chat-topic-panel.png`: "Viết chủ đề mới…", "Trả lời chủ đề…", "Tạo việc từ chủ đề". Short placeholders. The remaining "chuỗi" in the topic task form is minor (C-12). |
| 12 | Craft details | 1 | `1440-chat-thread-panel-replies.png` shows "Hôm nay" twice in one thread. `1440-chat-create-group.png` shows a raw `<select>` "Thuộc phòng ban" and a chip wall. `1440-chat-message-menu.png` shows "Thu hồi" clipped by the list edge. |
| | **Total** | **19/24** | Baseline 12. Weakest items: 9 (N-01), 12 (N-02, N-03, X-03), 3 and 4 (N-04). |

### Tasks (`/tasks`, `/tasks/:id`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 2 | `1440-tasks-list-director.png`: neutral segmented control, teal used only for the primary action, a calm workspace. |
| 2 | Hierarchy | 1 | `1440-task-detail-savebar.png`: two teal primaries ("Hoàn thành" and "Lưu thay đổi") are visible together. The edit form still outranks the comments on desktop (`1440-task-detail.png`). |
| 3 | Spacing rhythm | 1 | `375-tasks-list.png`: about 460px of chrome before the first task (baseline about 310px), and about 2.5 tasks per screen. |
| 4 | Alignment | 2 | `1440-tasks-list-lan.png`: relative due dates are right-aligned, and the stage, "Hoàn thành" and "⋯" columns line up. |
| 5 | Typography | 1 | Same scale sprawl (B10 deferred). Mono `L-0001` works well. |
| 6 | Color discipline | 1 | `1440-tasks-list-lan.png`: a teal "Next Action" badge on every row, plus teal titles, puts more than 12 accent elements above the fold. The badge carries no information. |
| 7 | Depth and shape | 1 | `1440-tasks-kanban-director.png`: cards combine a border, a shadow and a 3px red left border. |
| 8 | States and feedback | 2 | `1440-tasks-search-lan.png` ("Xóa bộ lọc"), `1440-task-detail-savebar.png` (dirty bar with "Hủy thay đổi"), `375-tasks-complete-dialog.png` (enabled button with inline rule), `1440-tasks-row-menu.png`. |
| 9 | Responsiveness | 1 | `375-tasks-kanban.png` and `375-task-detail-comments.png` re-compose well. The list rows in `375-tasks-list.png` only shrink: the title column is about 170px wide and wraps to 3–4 lines next to "Hoàn thành" and "⋯" (N-06). |
| 10 | Slop tells | 2 | None. |
| 11 | Content and copy | 1 | "Next Action" is English on every row and in the complete dialog ("Next Action tiếp theo"). Lan's subtitle says "Việc được giao cho bạn" while the list includes a task she created for Huy (`1440-tasks-search-lan.png`, `1440-task-detail.png`). The Kanban "Xong 0" column has the subtitle "50 việc hoàn thành gần nhất". |
| 12 | Craft details | 1 | `1440-tasks-datetime-calendar.png` and `1440-tasks-assignee-combobox.png` are well made. "Độ ưu tiên" is still a native `<select>` with the browser arrow next to the custom combobox chevron (`1440-tasks-create-dialog.png`). Descriptions from chat are a timestamped transcript (`1440-task-detail.png`). |
| | **Total** | **16/24** | Baseline 13. Weakest items: 9 (N-06), 6 and 11 ("Next Action" badge), 12 (native priority select). |

---

## 2. Baseline findings: status

Closed: 18. Partly closed: 12. Open: 2. Deferred: 2 (plus the palette part of C-09). Total: 34.

| ID | Sev. | Status | Evidence |
|---|---|---|---|
| C-01 | Major | Closed | `1440-chat-task-created-card.png`, `375-chat-thread-panel.png`: 16px icon, full title, "Đỗ Ngọc Lan · Hạn 30/10 09:00 · Mở việc". |
| C-02 | Major | Closed | `1440-chat-loctho-lan.png`: the selected row has an accent-weak fill and a 3px teal left border. |
| C-03 | Major | Closed | `1440-chat-thread-panel-empty.png`, `1440-chat-topic-panel.png`: one-row header; the group name stays visible. |
| C-04 | Major | Closed | `1440-chat-default-lan.png`, `375-chat-conversation.png`: full names; time and badge sit in a trailing column. |
| C-05 | Minor | Partly closed | [Code] `styles.css` 966–970: the "⋯" is still 24×22 and at `opacity: 0` until hover or focus-visible. 44px under coarse pointer [Run]. There is no hover toolbar and no long-press hint. |
| C-06 | Major | Closed | `1440-chat-recall-confirm.png` quotes the message; "Thu hồi" is last, after a divider, in danger colour (`1440-chat-message-menu-last-clipped.png`). |
| C-07 | Major | Closed | [Observed] Typed a draft, left the conversation and came back: the text was restored (`1440-chat-list-search-empty.png` composer). |
| C-08 | Major | Closed | `1440-chat-new-divider-huy.png` (divider above Lan's new messages), `1440-chat-unread-filter-huy.png` ("Chưa đọc" chip). See N-05 for the stale-list caveat. |
| C-09 | Minor | Closed (palette deferred) | `1440-chat-list-search-empty.png`: accent-insensitive list search with an empty state. Ctrl/Cmd+K is B11. |
| C-10 | Minor | Closed | `1440-chat-thread-panel-replies.png`: after thread-only replies at 14:30, the row still shows "Anh xem rồi báo em nha. 14:22". |
| C-11 | Minor | Partly closed | `1440-chat-threads-tab.png`: `?list=threads` survives a reload. Keeping the redirect target through login was not addressed. |
| C-12 | Minor | Partly closed | `1440-chat-topic-panel.png`: topic copy is fixed. The task form source box still says "Từ cả chuỗi trả lời" in topic mode [Run U3, deviation]. |
| C-13 | Minor | Closed | `375-chat-conversation.png`: "Nhập tin nhắn…" fits; the hint line is gated to hover-capable devices [Code]. |
| C-14 | Minor | Partly closed | `768-chat-conversation.png`: runs are grouped and day separators exist. The time still repeats under every bubble (N-04), and "Hôm nay" appears twice in a thread (N-03). |
| C-15 | Polish | Closed | `1440-chat-loctho-lan.png`: a bot icon in the header meta line; the footer row is gone. |
| C-16 | Minor | Partly closed | [Run U1] The DM header shows the name only and a labelled switch with an explanation. Whether it should default to ON is still an open product question. |
| C-17 | Polish | Closed at rest | `1440-chat-default-lan.png`: no band under the card. Scrolling brings a band back, tracked as N-01. |
| C-18 | Minor | Open | `1440-chat-topic-panel.png`: the open topic card has no selected style. |
| C-19 | Minor | Partly closed | `1440-chat-agent-draft-form.png`, `1440-chat-thread-task-form.png`: a source quote, a cleaned title and the mention-based assignee. The description is still a timestamped transcript, and the form is a modal, not a drawer. |
| T-01 | Major | Closed | `1440-tasks-list-director.png`, `1440-tasks-search-lan.png`: search, assignee combobox, status and due chips, URL state, "Việc của nhóm". |
| T-02 | Minor | Partly closed | `1440-tasks-list-lan.png`: "Bình thường" is hidden and dates read "Quá 22 ngày". The English "Next Action" badge is still on every row. |
| T-03 | Major | Partly closed | `1440-task-detail-savebar.png`, `375-task-detail-comments.png`: one status control, a dirty bar and mobile tabs. The page is still an always-editable form, and comments still sit below subtasks on desktop (`1440-task-detail.png`). |
| T-04 | Minor | Open | `1440-task-detail.png`, `375-task-detail-comments.png`: "Trợ lý trong luồng: Chưa có · Thêm trợ lý" still sits above every comment thread. |
| T-05 | Minor | Closed | `375-tasks-kanban.png` (switcher with counts), `768-tasks-kanban-director.png` (2 columns), card "⋯" [Run U2]. |
| T-06 | Minor | Closed | `375-tasks-complete-dialog.png`: no "QĐ13", the button is enabled, and the rule is in plain words. |
| T-07 | Minor | Partly closed | `1440-tasks-row-menu.png` adds "Dời sang mai 9:00 / Dời +3 ngày / Mở việc". The mobile list got denser chrome, not lighter (N-06). |
| S-01 | Minor | Deferred (B8) | `375-chat-list.png`: the topbar search is still squeezed to "Tìm l"; there is no bottom bar. |
| S-02 | Minor | Partly closed | `1440-chat-list-huy.png`: the bell (3) and approvals (1) are still two unlabelled red badges side by side. A director with nothing pending sees no badge (`1440-tasks-list-director.png`). No overdue count on "Công việc". |
| X-01 | Major | Closed | `1440-tasks-kanban-director.png`, `1440-chat-default-lan.png`: no blue fills; the nav pill and the segmented control are teal or neutral. |
| X-02 | Major | Closed | `1440-tasks-datetime-calendar.png`, `375-tasks-complete-dialog.png`: dd/mm/yyyy hh:mm, Monday-first calendar, Vietnamese labels. |
| X-03 | Major | Partly closed | `1440-tasks-assignee-combobox.png`: comboboxes for task assignee, lead and members. In chat, "Thuộc phòng ban" is still a raw `<select>` with a chip wall for members (`1440-chat-create-group.png`), and "add member" is still a raw `<select>` [Code] `chat-group-settings.tsx` 225–236. |
| X-04 | Minor | Partly closed | [Run U1, U2] The coarse-pointer rules exist (16px inputs, `--hit-min: 44px`). Not verified on a real device. |
| X-05 | Polish | Deferred (B10) | [Code] Still 13 font sizes and 12 radius values, and 114 hex literals in `styles.css`. |
| X-06 | Minor | Closed | `1440-chat-task-created-card.png`: toast "Đã tạo công việc · Mở việc". |

Baseline Majors: 10 of 12 are closed. T-03 and X-03 are partly closed.

---

## 3. New issues introduced by the upgrade

| ID | Sev. | Where | Evidence | Fix | Files |
|---|---|---|---|---|---|
| N-01 | **Major** | Any open conversation (main flow; the same rows are used in the thread panel and task comments), all viewports | [Observed] At 1440×900 the document `scrollHeight` is 1439px; at 375×812 it is 2030px. Wheel or touch scroll past the end of the message list scrolls the page, so the shell and composer slide up and leave an empty grey area (`1440-chat-page-scroll-regression.png`, `375-chat-page-scroll-regression.png`). Cause: U3 added `<span class="visually-hidden">{sender}:</span>` to continued messages (`chat-message-item.tsx` 243). `.visually-hidden` is `position: absolute` (`styles.css` 136), and no ancestor inside the scroller is positioned, so the spans are placed relative to the page and extend it. This undoes A13. | Make the scroller the containing block: `.inbox-messages { position: relative; }`, and the same on the thread-panel and comment scrollers. Alternatively, `[data-message-id] { position: relative; }`. Acceptance: document `scrollHeight` equals `innerHeight` on `/chat/:id` at all three viewports. | `src/web/styles.css` |
| N-02 | Minor | Message "⋯" menu | [Observed] The menu is `position: absolute` inside `.inbox-messages`. On a message near the bottom, "Thu hồi" is cut off by the list edge (`1440-chat-message-menu.png`). On the last message the menu grows the scroll area and the list jumps (`1440-chat-message-menu-last-clipped.png`). This breaks the overlay rule "popovers render in a portal or top layer". | Position `OverflowMenu` with the existing `floating.ts` helper (flip up when space below is short) or render it in a portal. | `src/web/components/ui.tsx`, `src/web/components/floating.ts`, `src/web/styles.css` |
| N-03 | Minor | Thread panel | [Observed] "Hôm nay" appears above the root and again above the replies on the same day (`1440-chat-thread-panel-replies.png`, `768-chat-thread-panel.png`). | Build the replies flow seeded with the root's day, or drop a separator whose day equals the previous row's day. | `src/web/components/chat-thread-panel.tsx`, `src/web/chat-flow.ts` |
| N-04 | Minor | Message grouping | [Observed] Every bubble in a grouped run keeps its own "14:34" line (`768-chat-conversation.png`). B4 asked for one name and one time per run. Own-message times are also left-aligned under right-aligned bubbles (`1440-chat-keyboard-focus.png`). | Show the time only under the last bubble of a run (keep the tooltip on each); right-align the meta line for own messages. | `src/web/components/chat-message-item.tsx`, `src/web/chat-flow.ts`, `src/web/styles.css` |
| N-05 | Minor | "Tin mới" divider | [Observed] Huy's list was loaded before Lan posted 3 messages, so the list was stale: no badge and no "Chưa đọc" count. Opening the conversation then showed **no divider**, and the 3 messages were marked read silently. After a fresh list load the divider worked (`1440-chat-new-divider-huy.png`: the divider sits only above the 2 later messages). The screenshot of the miss was overwritten during the session. [Hypothesis] With the WebSocket connected, the list is fresher, but any lag reproduces this. | Take the snapshot from a fresh source: refetch the conversation item on open and wait for it before mark-read, or return `lastReadAt` with the messages response. | `src/web/components/chat-thread.tsx`, `src/web/pages/chat.tsx` |
| N-06 | Minor | `/tasks` list at 375 | [Observed] The added search box and two chip rows push the first task to about y = 460 (baseline about 310). The title column is about 170px wide and wraps to 3–4 lines next to "Hoàn thành" and "⋯" (`375-tasks-list.png`). | Under 600px: put "Hoàn thành" and "⋯" on the meta line under a full-width title; put the status and due chips in one horizontally scrollable row; shorten the subtitle. | `src/web/pages/tasks.tsx`, `src/web/styles.css` |
| N-07 | Polish | Task detail | [Observed] With unsaved edits, "Hoàn thành" (header) and "Lưu thay đổi" (save bar) are both teal primaries (`1440-task-detail-savebar.png`). | While dirty, render the header action as secondary. | `src/web/pages/task-detail.tsx` |

### Other observations (not caused by the upgrade, or not attributable)

- **Console error outside scope.** For Sale users (Lan, Huy), `/` after login crashes in `DashboardBody` with "Cannot read properties of null (reading 'pipeline')" and shows "Không thể hiển thị trang" (`1440-dashboard-lan-console-error.png`). The director's dashboard does not crash. Neither `dashboard.tsx` nor any worker dashboard file is in the upgrade's changed files (git status), so this is very likely pre-existing or caused by the data. It needs its own bug ticket.
- "Tạo việc" in the create dialog is disabled with no reason until a title is entered (`1440-tasks-create-dialog.png`). This is the same pattern T-06 fixed elsewhere.
- Kanban "Xong 0" has the subtitle "50 việc hoàn thành gần nhất" (`1440-tasks-kanban-director.png`).
- The avatar initials for "Học vụ thử (local)" read "T(" (`1440-chat-new-direct.png`).
- Two groups are both named "Dự án Lộc Thọ" in the seed data; the list cannot tell them apart (`1440-chat-default-lan.png`).
- Demo mode: attachment images return 401 and their alt text overlaps the caption (`1440-chat-loctho-lan.png`). Known limit, not scored.

---

## 4. Bars

| Bar | Met? | Detail |
|---|---|---|
| Both screens ≥ 20/24 | **No** | Chat 19, Tasks 16. |
| No item scores 0 | **Yes** | The lowest score on either screen is 1. |
| Items 8, 9, 12 score 2 | **No** | Item 8 = 2 on both. Item 9 = 1 on both (N-01; N-06). Item 12 = 1 on both (chat: raw select, duplicate separator, clipped menu; tasks: native priority select, transcript description). |
| Every Major closed or deferred | **No** | T-03 and X-03 are partly closed, and the new N-01 is open. |
| No console errors | **Yes on chat and tasks; no app-wide** | No errors or warnings on any chat or tasks screen in three sessions. The Sale dashboard crash on `/` (above) is the only error. It is outside this scope and not attributable to the upgrade. |

Deferred by design and not counted as regressions: B8 (mobile bottom bar, S-01), B10 (token sweep and guidelines doc, X-05), B11 (command palette, C-09 palette part).

---

## 5. Smallest set of fixes that meets the bars (ranked)

1. **Fix N-01, the page scrolling under the shell** (one CSS line, `styles.css`). Chat item 9 goes to 2, which brings chat to 20/24 and closes the only new Major.
2. **Close X-03 in chat.** Use the U2 `Combobox` for "Thuộc phòng ban" and the members multi-select in "Tạo nhóm", and for "add member" in group settings. Files: `pages/chat.tsx` (create group dialog), `components/chat-group-settings.tsx`. With items 3 and 4 below, chat item 12 goes to 2 and X-03 is closed.
3. **Dedupe the thread day separator (N-03) and anchor the message menu (N-02).** Files: `chat-thread-panel.tsx`, `chat-flow.ts`, `ui.tsx`, `floating.ts`. This is the rest of chat item 12.
4. **Remove the "Next Action" badge.** Replace it with a small icon or with the Vietnamese "Việc tiếp theo" in muted text, and use the same words in the complete dialog. Files: `pages/tasks.tsx`, `components/task-board.tsx`, `components/lead-actions.tsx`. Tasks items 6 and 11 go to 2 (fix the "Việc được giao cho bạn" subtitle and the Xong subtitle in the same pass, in `pages/tasks.tsx` and `task-board.tsx`).
5. **Re-compose mobile task rows (N-06).** Files: `pages/tasks.tsx`, `styles.css`. Tasks item 9 goes to 2.
6. **Replace the native priority select** with a 3-option segmented control (Thấp / Bình thường / Cao). Use the trimmed excerpt plus a link for task-from-chat descriptions instead of the transcript. Files: `task-form-dialog.tsx`, `pages/task-detail.tsx`, `src/worker/chat-tasks.ts`. Tasks item 12 goes to 2, which brings tasks to 20/24.
7. **Close T-03.** Make the task detail read-first, with comments in the main column under the description on desktop. Files: `pages/task-detail.tsx`, `styles.css`. Alternatively, the supervisor can formally defer the rest of T-03, because U2 scoped task detail to "three changes". One of the two is needed for the "every Major" bar.

Expected after 1–6: chat 21, tasks 20, items 8, 9 and 12 at 2 on both, and no open Major except T-03 (step 7 or a formal deferral).

## Unresolved questions

1. Should the remaining part of T-03 (read-first layout, comments position) be fixed now or formally deferred?
2. Is "Việc của tôi" for Sale meant to include tasks the user created for others? If yes, the subtitle "Việc được giao cho bạn" is wrong; if no, the list query is wrong.
3. Should the "Cho agent đọc hội thoại này" switch default to ON for new DMs (C-16, carried over from the baseline)?
4. Who owns the Sale dashboard crash on `/`? It is outside this audit, but every Sale login lands there.

Status: DONE_WITH_CONCERNS
Summary: Chat rose from 12 to 19/24 and Tasks from 13 to 16/24, and 10 of 12 baseline Majors are closed, but the bars are not met: the upgrade added one Major (the page scrolls under the shell in conversations), items 9 and 12 are at 1 on both screens, and T-03 and X-03 are only partly closed.
Concerns/Blockers: Touch sizing was not verified on a real device. The screenshot of the missing divider (N-05) was overwritten. A dashboard crash for Sale users on `/` lies outside scope but logs the only console error.
