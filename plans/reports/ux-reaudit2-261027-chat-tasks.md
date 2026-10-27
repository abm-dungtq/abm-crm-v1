# Second UX re-audit: Chat and Tasks after fix run U4 (27/10/2026)

This was an audit only. No source file was changed. It is independent of the runs that built the fixes.
Inputs: baseline `ux-audit-261027-chat-tasks.md` (chat 12, tasks 13); first re-audit `ux-reaudit-261027-chat-tasks.md` (chat 19, tasks 16); `ux-upgrade-261027/run-u4.md`.
Evidence: `plans/reports/ux-reaudit2-261027-chat-tasks/` (`<viewport>-<page>-<state>.png`).
Rubric: `self-critique-loop.md`, judged against `ux-polish-standards.md`.
Notation: **[Observed]** means measured or seen in the running app. **[Run]** means taken from the U4 report and not re-checked here.

## Verdict

**All four bars pass.** Chat scores 22/24 (up from 19) and Tasks 22/24 (up from 16).

- **Majors.** Every baseline Major is closed except T-03, which is formally deferred. The new Major N-01 (page scrolling under the shell) is closed at all three widths.
- **Console.** There are no console errors on `/chat`, `/tasks` or `/` for Lan, Huy or the director. The sales dashboard crash is fixed.
- **What still holds scores below 2.** Typography is at 1 on both screens (B10 is deferred). Chat craft (item 12) is at 1 because of native radios and the textarea grip. Tasks depth (item 7) is at 1 because of the Kanban card style.
- **New issues.** Two Minors and three Polish items. None of them blocks a bar.

## Coverage

| Item | Detail |
|---|---|
| Environment | http://localhost:5173 in demo mode with local seed data. `agent-browser` sessions `ra2-a` (Lan, then Huy, then Lan again) and `ra2-b` (Nguyễn Minh Anh, BGĐ). Both sessions were closed at the end. |
| Viewports | 1440×900, 768×1024, 375×812. |
| Local data changed | The director created the group "Rà soát UX nhóm thử" with Lan as a member. A title edit on the task "Gửi báo giá cho Công ty Lộc Thọ" was made and then reverted with "Hủy thay đổi". A draft was typed in Lan's composer. No task or message was created. |
| Not checked | A real touch device (`pointer: coarse` cannot be emulated), a screen reader and dark mode. The two-user "Tin mới" race (L1/N-05) was not reproduced; the U4 report says it was checked by reading the code. Demo attachment images return 401, which is a known limit and is not scored. |

---

## 1. Rubric scores (0–2)

### Chat (`/chat`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 2 | `1440-chat-loctho-a.png`: a dark rail, a calm cool workspace, teal own bubbles and one teal accent. The screen reads as tidy, calm and dependable. |
| 2 | Hierarchy | 2 | `1440-chat-thread-panel.png`: the panel header is one row ("Chuỗi / Dự án Lộc Thọ", "Tạo việc", "⋯", close). The conversation actions collapse to icons while the panel is open. |
| 3 | Spacing rhythm | 2 | `1440-chat-loctho-huy.png`: each run shows the name once and the time once ("14:22", "14:35"). Bubbles inside a run are about 8px apart; runs are about 30px apart. |
| 4 | Alignment | 2 | `1440-chat-loctho-a.png`: the times under own messages are right-aligned at the bubble edge (x ≈ 1405), so they form a clean column. |
| 5 | Typography | 1 | One family renders Vietnamese well, but the size scale still sprawls (B10 deferred). The name (12px), time (12px), body (14.5px) and chip (13px) sizes all appear in `1440-chat-loctho-huy.png`. |
| 6 | Color discipline | 2 | `1440-chat-loctho-a.png`: teal marks only the selected row, the primary action and own bubbles. Red marks only unread items. |
| 7 | Depth and shape | 2 | `1440-chat-message-menu-last.png`: hairline borders with a light shadow; 14px bubbles, 8px menus and cards, pill chips. These are used the same way throughout. |
| 8 | States and feedback | 2 | Each state was checked in the app: <ul><li>The recall confirm quotes the message (`1440-chat-recall-confirm.png`). Esc returns focus to "Thao tác với tin". [Observed]</li><li>The empty topic thread shows "Chưa có trả lời" (`1440-chat-topic-panel.png`).</li><li>The disabled "Gửi" button is visibly muted.</li></ul> |
| 9 | Responsiveness | 2 | `375-chat-conversation.png`, `375-chat-thread-panel.png`, `768-chat-thread-panel.png`: the thread panel becomes a full screen with a back arrow. The document height equals the viewport height at every width (N-01, below), and nothing overflows horizontally. |
| 10 | Slop tells | 2 | None. |
| 11 | Content and copy | 2 | `1440-chat-topic-panel.png`: "Viết chủ đề mới…", "Trả lời chủ đề…", "Tạo việc từ chủ đề". The leftover "Từ cả chuỗi trả lời" in the topic task form (C-12) is minor. |
| 12 | Craft details | 1 | The fixed items are good: comboboxes in "Tạo nhóm" and group settings (`1440-chat-create-group-picked.png`, `1440-chat-group-settings-owner.png`), one "Hôm nay" per thread, and a menu that flips upward. What still holds the score at 1: <ul><li>"Chế độ tin nhắn" in group settings uses native radio buttons (`1440-chat-group-settings-owner.png`).</li><li>Every composer shows the native textarea resize grip.</li><li>The open topic card has no selected style (C-18).</li><li>An open message menu follows its anchor out of the list (N-08).</li></ul> |
| | **Total** | **22/24** | Baseline 12, first re-audit 19. The items below 2 are 5 (B10 deferred) and 12. |

### Tasks (`/tasks`, `/tasks/:id`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 2 | `1440-tasks-list-lan.png`: a neutral segmented control, teal only on the primary action and on links, and a calm workspace. |
| 2 | Hierarchy | 2 | `1440-task-detail-internal.png` and `1440-task-detail-dirty.png`: one primary at a time. "Hoàn thành" is primary at rest. After an edit, "Lưu thay đổi" is primary and "Hoàn thành" turns secondary. [Observed: the list of primary buttons changed exactly this way.] The form still outranks the comments on desktop, but that is T-03, which is deferred. |
| 3 | Spacing rhythm | 2 | `375-tasks-list-lan.png`: the first task starts at about y = 405 (it was about 460 in the first re-audit), with about 2.6 rows per screen. Gaps inside a row are clearly smaller than gaps between rows. |
| 4 | Alignment | 2 | `1440-tasks-list-huy.png`: the relative due dates are right-aligned, and the stage, "Hoàn thành" and "⋯" columns line up. |
| 5 | Typography | 1 | The same scale sprawl as chat (B10 deferred). The mono `L-0001` IDs work well. |
| 6 | Color discipline | 2 | `1440-tasks-list-huy.png`: "Việc tiếp theo" is now a neutral grey badge. Red appears only on overdue dates and counts, and teal only on title links and the primary action. The screen still works in grayscale. |
| 7 | Depth and shape | 1 | `1440-tasks-kanban-director.png` [Observed, computed style]: the `.deal-card` has a 1px border, a light two-layer shadow, a 3px red left stripe and a 6px radius. Other cards use 8px. The blue "Việc gắn lead" badge in `375-task-detail.png` is a stray tone. |
| 8 | States and feedback | 2 | Each state was checked in the app: <ul><li>The dirty bar shows "Có thay đổi chưa lưu" with "Hủy thay đổi" (`1440-task-detail-dirty.png`).</li><li>The complete dialog states the rule in plain words (`1440-task-complete-dialog-lead.png`). Esc returns focus to "Hoàn thành". [Observed]</li><li>Kanban: Esc closes the card menu and returns focus to "⋯"; opening a second card's menu closes the first (1 menu, 1 `aria-expanded=true`). [Observed]</li><li>Empty columns read "Không có việc ở cột này".</li></ul> |
| 9 | Responsiveness | 2 | Each width was checked: <ul><li>`375-tasks-list-lan.png`: full-width titles, with the due date, "Hoàn thành" and "⋯" on a line underneath.</li><li>`375-tasks-filter-overdue.png`: "Lọc 1", the chips folded away, and "Xóa bộ lọc".</li><li>`375-task-detail.png`: the priority control fits.</li><li>`768-tasks-kanban-director.png`: the board scrolls inside its own container.</li></ul> `scrollWidth` equals `innerWidth` at every width. |
| 10 | Slop tells | 2 | None. The red left stripe has a meaning (overdue), so it is scored under item 7, not here. |
| 11 | Content and copy | 2 | The copy now matches what the screens do: <ul><li>"Việc tiếp theo" replaces "Next Action" on the list, the Kanban and the complete dialog (`1440-task-complete-dialog-lead.png`: "Lead đang mở luôn cần một việc tiếp theo có hạn.").</li><li>The Sale subtitle reads "Việc bạn phụ trách, cùng làm hoặc đã tạo."</li><li>The Kanban "Xong" subtitle reads "Hoàn thành gần đây, tối đa 50 việc".</li></ul> |
| 12 | Craft details | 2 | `1440-task-detail-internal.png`: the 4-option priority control replaces the native select. `1440-chat-thread-task-form.png`: the description lines read "Tên: nội dung" with no timestamps. Dates, the calendar and the comboboxes are custom, and no native select is left in tasks. Small blemishes: N-09 (a system line in the description) and a 32px segment height. |
| | **Total** | **22/24** | Baseline 13, first re-audit 16. The items below 2 are 5 (B10 deferred) and 7. |

---

## 2. Majors: status

| ID | Source | Status | Evidence |
|---|---|---|---|
| C-01 | Baseline | Closed | `1440-chat-thread-panel.png`: the task card shows the full title, "Đỗ Ngọc Lan · Hạn 30/10 09:00" and "Mở việc". |
| C-02 | Baseline | Closed | `1440-chat-loctho-a.png`: the selected row has an accent fill and a teal left border. |
| C-03 | Baseline | Closed | `1440-chat-thread-panel.png`: the panel header is one row and keeps the group name. |
| C-04 | Baseline | Closed | `1440-chat-loctho-a.png`: full names; the time and badge sit in a trailing column. |
| C-06 | Baseline | Closed | `1440-chat-recall-confirm.png` quotes the message. "Thu hồi" is the last menu item, in danger colour, and the menu is no longer clipped. |
| C-07 | Baseline | Closed | [Observed] The draft is saved in `sessionStorage` under the key `chat-draft:u-lan:<id>:main`. After a switch to Huy the key was gone and Huy's composer was empty, so drafts do not leak between users. |
| C-08 | Baseline | Closed | Unchanged since the first re-audit. The L1 refetch is [Run], not reproduced here. |
| T-01 | Baseline | Closed | `1440-tasks-list-huy.png`, `375-tasks-filter-overdue.png`. |
| T-03 | Baseline | **Deferred** (read-first task detail) | `1440-task-detail-internal.png`: the page is still an always-editable form. |
| X-01 | Baseline | Closed | No blue fills on primary surfaces. The small blue "Việc gắn lead" badge is noted under tasks item 7. |
| X-02 | Baseline | Closed | dd/mm/yyyy hh:mm and Vietnamese labels everywhere that was checked. |
| X-03 | Baseline | **Closed** (was partly closed) | `1440-chat-create-group-picked.png`: a combobox for "Thuộc phòng ban" and a multi-combobox for "Thành viên (n/50 đã chọn)". `1440-chat-group-settings-owner.png`: a combobox for adding members. [Observed] There are 0 `<select>` elements in either dialog. |
| N-01 | First re-audit | **Closed** | [Observed] `document.scrollingElement.scrollHeight` equals `innerHeight` on every page below, and `scrollY` stayed at 0 after a 3000px scroll. |

N-01 measurements, as height/viewport:

| Page | 1440 | 768 | 375 |
|---|---|---|---|
| `/chat/<id>?thread=<root>` (chat mode, thread panel open) | 900/900 | 1024/1024 | 812/812 |
| `/chat/<topic-group>?thread=<root>` (topic mode, panel open) | 900/900 | 1024/1024 | 812/812 |
| `/chat/<topic-group>` (topic mode, panel closed) | 900/900 | 1024/1024 | 812/812 |
| `/chat/<id>` (chat mode, panel closed) | 900/900 | 1024/1024 | 812/812 |

### Other U4 changes, checked one by one

| U4 change | Result |
|---|---|
| Group pickers (create group and settings) | Pass. See X-03. Picking a member adds a removable tag ("Bỏ Đỗ Ngọc Lan"), and the count label updates. |
| One day label in the thread panel (N-03) | Pass. One "Hôm nay" in `1440-chat-thread-panel.png`, `768-chat-thread-panel.png` and `1440-chat-topic-panel.png`. |
| Message menu clipping (N-02) | Pass, with one caveat. The menu is rendered in `BODY` with `position: fixed`. On the last message it flips upward (top 574, bottom 749, inside a 900px viewport); at 375 it spans 480–655. ArrowDown/End reach "Thu hồi". Caveat: see N-08. |
| Grouped-bubble times | Pass. One time per run, own times right-aligned (`1440-chat-loctho-a.png`, `1440-chat-loctho-huy.png`). |
| "Next Action" badge and subtitles | Pass. See tasks items 6 and 11. |
| Mobile task rows and the "Lọc" button | Pass. The button shows "Lọc 1" after "Quá hạn" is picked, and `aria-expanded` toggles. |
| Priority control and description | Pass, with one caveat. The control has `aria-pressed` and fits at all three widths. Caveat: see N-09. |
| One primary button in task detail | Pass. Before an edit: "Hoàn thành". After an edit: "Lưu thay đổi" (with "Gửi" disabled). |
| Focus return after confirm dialogs | Pass. Recall confirm, Esc: focus on "Thao tác với tin". Complete dialog (internal and lead tasks), Esc: focus on "Hoàn thành". Create group, Esc: focus on "Tạo nhóm". |
| Escape on Kanban menus | Pass. See tasks item 8. |
| Drafts per user | Pass. See C-07. |
| Sales dashboard `/` | Pass. It renders for Lan at 1440 and 375 and for Huy, with no crash text and no errors. Lan's "Việc sắp tới" shows 2 "Việc nội bộ" items (`1440-dashboard-lan.png`). |

### Deferred (listed, not counted as open Majors)

- **T-03:** read-first task detail.
- **B8:** mobile bottom bar. The topbar search is still squeezed to "Tìm l" at 375.
- **B10:** token sweep and the design-guidelines doc. This keeps item 5 at 1 on both screens.
- **B11:** command palette.

### Minors carried over from earlier audits (not re-scored in full)

| ID | Status |
|---|---|
| C-18 | Still open: the open topic card has no selected style (`1440-chat-topic-panel.png`). |
| T-04 | Still open: "Trợ lý trong luồng: Chưa có · Thêm trợ lý" still sits above the comments (`375-task-detail-comments.png`). |
| S-02 | Still partly closed: Huy sees two unlabelled red badges side by side (`1440-tasks-list-huy.png`). |
| C-12 | Still partly closed: "Từ cả chuỗi trả lời" still appears in the topic task form. |
| C-05 | Still partly closed: the "⋯" is still 24×22 under a fine pointer. |
| Create-task button | Still disabled with no stated reason until a name or title is entered. This applies to "Tạo việc" and "Tạo nhóm". |

---

## 3. New issues

| ID | Sev. | Where | Evidence | Fix | Files |
|---|---|---|---|---|---|
| N-08 | Polish | Message "⋯" menu | [Observed] At 375, with the menu open on the last message, scrolling the list up by 300px moved the menu with its anchor to top 780, bottom 955 in an 812px viewport. The menu then covered the composer hint and ran off screen (`375-chat-message-menu-after-scroll.png`). This is a side effect of moving the menu to a fixed-position portal. | Close the menu when its scroll container scrolls, or when the anchor leaves the container's visible area. | `src/web/components/ui.tsx`, `src/web/components/floating.ts` |
| N-09 | Minor | "Tạo việc từ chat" description for a thread that already has a task | [Observed] The prefilled description ends with "Hệ thống: Đã tạo việc: Anh cập nhật vào báo giá giúp em" (`1440-chat-thread-task-form.png`). The task card is a system message, and it leaks into the transcript. | Skip system and task-card messages when building the description. | `src/web/chat-task-draft.ts` or `src/worker/chat-tasks.ts` (wherever the thread lines are built) |
| N-10 | Minor | Task detail, "Bình luận" tab at 375 | [Observed] The comment composer starts at y = 868 in an 812px viewport. An empty comment area pushes it below the fold, so a user must scroll to write the first comment (`375-task-detail-comments.png`). This may be pre-existing; it is not attributed to U4. | Make the comments card fill the remaining height, with the composer pinned to its bottom, or size the empty state to its content. | `src/web/pages/task-detail.tsx`, `src/web/styles.css` |
| N-11 | Polish | Main list when the thread panel opens | [Observed] After "Xem chuỗi", the narrowed main list no longer sits at the bottom; the last bubble is cut off (`1440-chat-thread-panel.png`). | Keep the scroll anchored to the bottom when the list resizes and the user was already at the bottom. | `src/web/components/chat-thread.tsx` |
| N-12 | Polish | Composer hint at 375 | The hint "Enter để gửi · Shift+Enter xuống dòng · @ để nhắc tên" wraps and leaves "tên" alone on the second line in the topic composer (`375-chat-topic.png`). On a real touch device the hint is hidden ([Run]), so only narrow desktop windows show this. | Shorten the hint under 420px, or hide it there. | `src/web/styles.css` |

Other observations, not scored:

- Tasks created before U4 still show timestamped transcripts (`1440-task-detail-internal.png`). This is legacy data.
- Creating a second task from the same thread shows no warning that a task already exists.

---

## 4. Bars

| Bar | Pass? | Detail |
|---|---|---|
| Chat ≥ 20 and Tasks ≥ 20 | **Pass** | Chat 22/24, Tasks 22/24. |
| No item scores 0 | **Pass** | The lowest score on either screen is 1 (chat items 5 and 12; tasks items 5 and 7). |
| Every Major is closed or deferred | **Pass** | 11 baseline Majors are closed, T-03 is deferred, and N-01 is closed. |
| No console errors on `/chat`, `/tasks` and `/` | **Pass** | [Observed] `errors` was empty, and the console log had no `[error]` or `[warn]` lines. This held for Lan and Huy on `/`, `/chat`, `/chat/<id>`, `/tasks`, `/tasks?view=board` and `/tasks/task-1`, and for the director on `/`, `/chat` and `/tasks` (list and board). |

All bars pass, so no fix list is required. If the team wants the next increments anyway, these are ranked by value per effort:

1. **N-09:** filter system messages out of the thread description. This is a small change in one helper.
2. **N-08:** close the message menu on container scroll.
3. **Chat item 12 → 2:** replace the "Chế độ tin nhắn" radios with the existing SegmentedControl, and fix C-18 (selected style for the open topic card).
4. **Tasks item 7 → 2:** drop either the card shadow or the border on `.deal-card`, and align its radius to 8px.
5. **N-10:** pin the comment composer in the mobile "Bình luận" tab.

## Unresolved questions

1. Should the "Cho agent đọc hội thoại này" switch default to ON for new direct messages? This is C-16, still open from the baseline.
2. Should creating a second task from a thread that already has one show a warning or a link to the existing task?

Status: DONE
Summary: After U4, Chat scores 22/24 and Tasks 22/24, no item scores 0, and every Major is closed except the formally deferred T-03. N-01 is fixed at all three widths, and there are no console errors on /chat, /tasks or / for Lan, Huy and the director.
Concerns/Blockers: No blockers. There are two new Minors (a system line in the task-from-thread description; the mobile comment composer below the fold) and three Polish items. Touch sizing and the two-user "Tin mới" race were not verified on a real device or in a live race.
