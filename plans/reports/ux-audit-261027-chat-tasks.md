# UX audit: Chat and Tasks (CRM web) — 27/10/2026

Route: preserve and improve. Audit only; no source file was changed.
Evidence folder: `plans/reports/ux-audit-261027-chat-tasks/` (screenshots named `<viewport>-<page>-<state>.png`).
Method: `ak-frontend-design/references/workflow-ux-audit.md`, judged against `ux-polish-standards.md`, `product-ui-patterns.md` and the 12-item rubric in `self-critique-loop.md`.

Notation: **[Observed]** means seen in the running app or measured in the browser; **[Code]** means read in source; **[Hypothesis]** means inferred and not verified.

---

## 1. Design brief (from existing tokens and components)

| Line | Value |
|---|---|
| Register | Product UI. Internal daily-use operations tool (B2B sales and training CRM) in Vietnamese. Dense but calm. |
| Scene | Sales staff, leaders and directors at a Vietnamese training company. Office desktops most of the day, phones between calls and meetings. They move between team chat, threads and their task list many times an hour. Mood words: calm, dependable, quick. |
| Direction | "Direction 3: Hybrid Dark Rail + Light Workspace" (`styles.css` line 5). Dark slate navigation rail, cool light-grey workspace, white cards with hairline borders, one teal action colour. Chat follows a Zalo-like bubble pattern. |
| Color | Neutrals: `--rail-bg` oklch(18.0% 0.032 267), `--bg` oklch(97.2% 0.005 258), `--surface` oklch(100% 0 0), `--surface-2` oklch(98.4% 0.003 248), `--surface-3` oklch(96.8% 0.007 248), `--border` oklch(92.9% 0.013 256), `--border-strong` oklch(86.9% 0.020 253), `--text` oklch(20.8% 0.040 266), `--text-2` oklch(37.2% 0.039 257), `--muted` oklch(55.4% 0.041 257). Action accent: `--accent` oklch(47.8% 0.079 190), `--accent-hover` oklch(41.4% 0.068 191), `--accent-weak` oklch(94.6% 0.016 187). Semantic: `--danger` oklch(50.0% 0.182 30), `--warn` oklch(50.1% 0.127 52), `--ok` oklch(46.5% 0.114 154), `--info` oklch(48.8% 0.217 264), `--agent` oklch(54.1% 0.247 293). Second blue in use today: `--brand` / `--subnav-active` oklch(54.6% 0.215 263) (see finding X-01). Strategy to keep: cool neutrals plus one teal accent that marks only actions and selection; semantic colours only for status. Dark-mode variants exist for workspace tokens. |
| Type | Be Vietnam Pro (full Vietnamese diacritics), one family; system mono for codes such as `L-0001`. Body 14px / 1.5; h1 22px (19px under 860px); h2 16px. |
| Signature | The dark rail with its active pill; teal-tinted own bubbles, white incoming bubbles, violet agent bubbles; the stage "pips" badge on tasks and leads. |
| Dials | Density 7/10 (compact rows, 36px controls). Motion 2/10 (120 ms colour transitions, reduced motion respected). Variance 3/10. Radius 6–8px for controls and cards, 14px for bubbles, pill for chips. Depth: hairline border plus a very light shadow. |

Three adjectives the screens give off today: tidy, utilitarian, slightly unfinished. These partly match the Scene ("calm, dependable"). The broken task card, the US-format date fields and the cut-off titles are what undermine "dependable".

---

## 2. Summary

Overall: the chat and tasks screens rest on a sound, consistent base. Tokens are coherent, Vietnamese copy is mostly natural, there are loading, empty and error states, unread counts agree across the nav, section and row, and the notification panel is well built. The problems are not about direction. They are about finish and wayfinding. Several layouts crush their own titles. The key "create a task from chat" outcome renders broken. Date entry uses the browser's US format. Triage on tasks has no filter or search.

### Top 5 issues

1. **The "Đã tạo việc" card is broken (C-01, Major).** The check icon renders at 238×238px, the task title collapses to 0px width, and "Mở việc" overlaps the assignee. This happens at every viewport. It is the confirmation of the chat-to-task journey.
2. **The open conversation is never highlighted (C-02, Major).** The router sets `aria-current="page"`, but the CSS only styles `[aria-current='true']`. Users lose "where am I" in the list.
3. **Headers crush their own titles (C-03, C-04, Major).** With a thread open at 1440px, the panel title reads "Cl / P…". In topic mode the group name disappears completely. In the list, "Phòng Kinh doanh" becomes "Phòn…". On mobile the conversation header shows "P..".
4. **Date and people inputs are browser defaults (X-02, X-03, Major).** `datetime-local` shows "mm/dd/yyyy --:-- --" and "10/30/2026 09:00 AM", with an English accessible label ("Show local date and time picker"). The assignee, lead and add-member fields are raw `<select>`s, and "Người cùng làm" is a wall of chips for every staff member.
5. **Task triage has no tools (T-01, Major).** The list has no search and no filter by assignee, priority or type. A Director sees 15 overdue tasks across the team under the title "Việc của tôi".

### Fastest high-impact wins (each under half a day)

These are A1–A5 in the plan: one CSS rule to size icons in task cards; one selector so `aria-current='page'` gets the selected style; a thread-panel header that moves "Theo dõi / Tắt thông báo" into a "⋯" menu; removing the redundant "Phòng ban" chip from list rows; confirm dialogs before "Xóa", "Rời nhóm" and "Thu hồi".

---

## 3. Coverage

| Item | Detail |
|---|---|
| Environment | http://localhost:5173, Worker on 127.0.0.1:8787 in DEMO mode with local D1 seed data. `agent-browser` 0.39.4, headless Chromium, sessions `uxaudit-chat` and `uxaudit-chat2` (both closed). |
| Viewports | 1440×900, 768×1024, 375×812. |
| Users | Đỗ Ngọc Lan (Sale), Bùi Quang Huy (Sale, used as recipient and group owner), Nguyễn Minh Anh (BGĐ / Director). |
| Data created | 3 messages in "Phòng Kinh doanh"; a thread with 2 replies; 1 task from that thread ("Gửi báo giá cho Công ty Lộc Thọ"); group "Dự án Lộc Thọ" switched to topic mode with 2 topics; subgroup "Nhóm B2B miền Bắc" with 1 message; a direct chat Lan↔Huy. |
| Chat covered | Tất cả and Chuỗi tabs; department tree with subgroup; groups; direct chats; message "⋯" menu; quote ("Trả lời") code path; thread panel (empty, with replies, mobile and tablet); topic-mode list and topic panel; group settings dialog; create group and create subgroup dialogs; new direct dialog; task-from-thread form; posted task card; unread state as recipient. |
| Tasks covered | List (Sale and Director), Kanban (all viewports), task detail (desktop and mobile), "Tạo từ chat" back-link (it returns to the exact thread: `/chat/dept%3Adep-kd?thread=…`), manual "Tạo việc" dialog, "Hoàn thành" next-action dialog on mobile. |
| Shell covered | Rail nav and badges, notification bell (empty and with 1 unread), account menu and demo role switch, mobile drawer (Escape closes it), topbar search at each width. |
| Not reached | **Trợ lý drafting** (`DraftCard`, "Việc nháp", "Sửa và tạo việc"): the local demo returned manual mode, so no agent draft appeared. Its look is assessed from code only. **"Thêm trợ lý" dialog** was not opened. **Attachments and image lightbox** were not exercised. **Dark mode** was not captured. **Real keyboard focus order** was checked in code only (`:focus-visible` exists globally). **iOS Safari** behaviour is inferred, not tested. The console showed no errors; only Vite and React DevTools info lines. |

---

## 4. Journey analysis

### J1. Reply in a thread (desktop and mobile)

Observed path (desktop): hover a message so the hidden "⋯" appears (24×22px, `opacity: 0` until hover) → click "⋯" → "Trả lời theo chuỗi" → the panel opens with the composer focused → type → Enter. That is 3 pointer actions plus typing, with one moment of searching for the hidden trigger. An existing thread is easier: the "N trả lời · Xem chuỗi" pill is always visible.

Friction:
- The trigger is invisible until hover (`styles.css` line 905). On touch it sits at 60% opacity and 24px, or needs a 500ms long-press that nothing hints at.
- Once open, the panel header carries 3–4 equal-weight buttons, which squeeze the title to "Cl / P…" and push the close button to a second row (`1440-chat-thread-panel-empty.png`). In topic mode the conversation header loses the group name entirely (`1440-chat-topic-panel.png`).
- The thread placeholder is two lines of keyboard hints and gets clipped in the narrow panel ("Shift+Enter xu…").
- Leaving the conversation discards a half-written reply (C-07).

Proposed flow: a small hover/focus toolbar on each message with icon buttons for "Trả lời", "Trả lời theo chuỗi" and "Tạo việc", visible on keyboard focus too; on touch, the long-press opens a bottom sheet. The panel header becomes one row: title and conversation name on the left, "Tạo việc" plus "⋯" (Theo dõi, Tắt thông báo, Đóng chủ đề) plus "Đóng" on the right. The placeholder becomes "Trả lời trong chuỗi…".

### J2. Create a task from a thread

Observed path: open the thread → "Tạo việc từ chuỗi" (1) → a centred modal covers the thread → the form is prefilled with title = the raw root message ("Anh Huy gửi giúp em báo giá … ạ.") and description = a timestamped transcript, assignee = the requester (Lan) even though the message names Huy, due date empty → edit the title (1) → pick the assignee in a raw `<select>` (1) → tap "+3 ngày" (1) → "Tạo việc" (1). That is 5 actions plus title editing. Then a toast "Đã tạo công việc" appears with no link, and the card posted into the thread is broken (C-01). The "Tạo từ chat" link on the task detail correctly returns to the exact thread.

Friction: the modal hides the source text you are summarising; the transcript is noisy; the assignee and "Người cùng làm" pickers do not scale; the date field shows US format; the success state is the broken card.

Proposed flow: open the form in a right-side drawer (480–560px) so the thread stays visible. Prefill a trimmed title and a quoted excerpt with a link instead of the transcript. Show suggestion chips for assignees taken from thread participants and @mentions; pick with a searchable combobox. Use a Vietnamese date-time field with the existing quick chips. On success, show the toast "Đã tạo việc · Mở việc" and a compact card (16px icon, title, "Bùi Quang Huy · Hạn 30/10 09:00", "Mở việc").

### J3. Find unread

Observed (as Huy): rail "Chat 3" → "PHÒNG BAN 3" → row badge 3 → open → messages scroll to the bottom; after about 2s the conversation is marked read and every badge clears (`1440-chat-unread-huy.png` → `1440-chat-open-unread-huy.png`). The bell lists "Đỗ Ngọc Lan giao việc cho bạn" with an unread dot and "Đánh dấu đã đọc hết", which works well.

Friction:
- There is no "Tin mới" divider, so after the badge clears the user cannot tell which messages were new.
- There is no search box or "Chưa đọc" filter in the conversation list, which will hurt once there are dozens of groups.
- Thread replies are only surfaced for followed threads (Chuỗi tab badge, or a red dot on the row when the main flow is read).
- On mobile the chat unread count exists only inside the drawer (`375-shell-nav-drawer.png`); the topbar has no chat indicator.
- The row time does not match the preview: "12:54" next to the 12:56 task card (C-10).

Proposed flow: a "Tin mới" divider at the first unread message, kept until the user leaves; a "Chưa đọc" chip and a search field above the list; a mobile bottom bar with a Chat badge.

### J4. Triage tasks on mobile (375×812)

Observed: ☰ → "Việc của tôi" (2 taps) → about 310px of banner, topbar, title, subtitle, controls, tabs and group header before the first task → about 3.5 tasks per screen, each with "Bình thường" and "Next Action" badges and a "Hoàn thành" button (`375-tasks-list.png`). Completing opens a dialog whose next-action date is US format and whose copy cites "QĐ13" (`375-tasks-complete-next-action-dialog.png`). Rescheduling requires opening the detail page, where the form is first and comments start 1151px down a 2446px page (`375-task-detail.png`). Kanban on mobile shows one column at a time with no column switcher.

Proposed flow: a bottom tab "Việc" with the overdue count; compact rows (title, contact, relative due "Quá 22 ngày", trailing "⋯" with "Xong", "Dời sang mai 9:00", "Dời +3 ngày", "Mở"); a sticky filter chip row ("Quá hạn 6", "Hôm nay", "Sắp tới"); on Kanban under 900px, a column switcher with counts and a "Chuyển sang…" item on each card.

---

## 5. Findings

Severity: Blocker (task impossible or data risk), Major (task slowed or confusing), Minor (friction), Polish (lacks care).
Prefixes: C = chat, T = tasks, S = shell, X = cross-cutting.

| ID | Where | Evidence | Category | Sev. | Why it matters | Fix |
|---|---|---|---|---|---|---|
| C-01 | Thread panel / main flow, "Đã tạo việc" card (`TaskCard`), all viewports | **[Observed]** `1440-chat-task-card-in-thread.png`, `768-chat-thread-panel.png`, `375-chat-thread-panel.png`. Measured: svg 238×238, title width 0px. **[Code]** `Icon` has no intrinsic size (`icons.tsx`), and there is no `.chat-task-card svg` rule. **[Hypothesis]** `DraftCard` head (`.chat-task-card-head`) has the same defect. | Visual polish / Logic | Major | This is the success state of the chat-to-task journey; the task title is invisible and the layout looks broken. | `.chat-task-card svg { width:16px; height:16px; flex:none }`. Also give `Icon` a default `width/height="1em"` so unsized icons never balloon. |
| C-02 | Conversation list, every row | **[Observed]** eval: the selected row has `aria-current="page"` and a transparent background (`1440-chat-subgroup-tree.png`). **[Code]** CSS uses `.conv-row[aria-current='true']` (lines 501, 799); TanStack `Link` overrides it with `"page"`. | Navigation | Major | No "you are here" in a three-pane layout; it is easy to post in the wrong group. | Select `[aria-current='page'], [aria-current='true']`, or pass `activeProps={{ 'aria-current': 'true' }}`. |
| C-03 | Thread / topic panel header; conversation header while panel open, 1440 | **[Observed]** `1440-chat-thread-panel-empty.png` ("Cl / P…", X wraps), `1440-chat-topic-panel.png` (title "Dự án Lộc Thọ" gone, panel title "Chủ / D…"). | Layout | Major | Users lose context of which conversation and which thread they are in. | One-row header: title block (`min-width: 120px`), "Tạo việc" icon+label, "⋯" menu (Theo dõi / Tắt thông báo / Đóng chủ đề), close. Conversation header: hide the "Nhóm · N thành viên" badge and member line when the panel is open (container query). |
| C-04 | List rows and conversation header, 1440 and 375 | **[Observed]** "Phòn…" with unread badge (`1440-chat-unread-huy.png`); "Phòng Ki…" at rest; mobile header "P.." (`375-chat-conversation.png`). | Layout | Major | Names are the main scanning cue in chat. | Remove the "Phòng ban" chip from rows (the section header already says it); put time and badge in a fixed trailing column; at narrow widths put member and type badges on line 2. |
| C-05 | Message "⋯" trigger | **[Observed]** 24×22px; `opacity:0` until hover; 0.6 on touch (`styles.css` 905–909). Long-press (500 ms) has no hint. | Interaction feedback / Accessibility | Minor | Core actions (reply, thread, task) are hidden; the touch target is below 44px. | Hover/focus-within toolbar with 32px icon buttons on desktop; 44px on `(pointer: coarse)`; long-press opens a bottom sheet. |
| C-06 | Message menu, group settings, topic close | **[Observed]** "Thu hồi" fires at once, no separator or danger colour (`1440-chat-message-menu.png`). **[Code]** "Xóa" / "Rời nhóm" in `chat-group-settings.tsx` 244–250 have no confirm. Mode change and "Đóng chủ đề" use `window.confirm`. | Copy/guidance / Safety | Major | One mis-click removes a colleague, makes the owner leave, or recalls a message; native confirms are unstyled and English-chromed. | Shared `ConfirmDialog` naming the object and consequence (e.g. "Xóa Vũ Đức Long khỏi nhóm Dự án Lộc Thọ? Người này sẽ không xem được tin mới." → "Xóa khỏi nhóm"). Put "Thu hồi" last, after a divider, in `--danger`. |
| C-07 | Composer (main and thread) | **[Observed]** typed text, switched conversation, came back: textarea empty. **[Code]** `ChatComposer` is keyed by conversation; `text` is local state. | State / continuity | Major | Lost drafts while hopping between groups (the core habit in team chat). | Persist drafts in `sessionStorage` under `chat-draft:{conversationId}:{rootId or main}`; clear on send. |
| C-08 | Open conversation with unread | **[Observed]** no divider; read after about 2s (`1440-chat-open-unread-huy.png`). **[Code]** `useDebouncedMarkRead` 2000 ms. | Information architecture | Major | Users cannot see which messages were new once badges clear. | "Tin mới" divider at the first unread message; mark read when the divider scrolls into view; "Chưa đọc" filter chip in the list. |
| C-09 | Conversation list | **[Observed]** no search field; global search covers only leads and accounts (**[Code]** `layout.tsx` 281). | Navigation | Minor (Major as groups grow) | Finding a group or person relies on scrolling. | Search input above the tabs (diacritic-insensitive via existing `foldDiacritics`), plus Ctrl/Cmd+K for chats and tasks. |
| C-10 | List row preview and time | **[Observed]** row time "12:54" while the preview is the 12:56 "Đã tạo việc…" card; the thread reply "Bổ sung: …" appeared as the group preview though "Cũng gửi vào nhóm" was unchecked. **[Hypothesis]** `lastMessage` includes thread replies and system cards; `lastMessageAt` does not. | Logic | Minor | Preview and time disagree; thread-only replies look as if posted to the group. | Use one source for both; prefix thread items "Trong chuỗi: …". |
| C-11 | List tab, deep link | **[Code]** `listTab` is `useState`, so Chuỗi is lost on reload. **[Observed]** opening `/chat` before picking a demo user landed on `/` (`1440-shell-deeplink-lost-after-login.png`). **[Hypothesis]** real password login behaves the same. | State / continuity | Minor | Shared links and reloads lose place. | `?list=threads` in the URL; keep the redirect target through login. |
| C-12 | Topic mode copy | **[Observed]** topic composer "Nhập tin nhắn…" + "Gửi"; topic cards and panel "Tạo việc từ chuỗi"; reply placeholder "Trả lời trong chuỗi…" (`1440-chat-topic-list.png`). | Copy | Minor | Mixed mental model (chuỗi vs chủ đề). | "Viết chủ đề mới…", "Đăng chủ đề", "Trả lời chủ đề…", "Tạo việc từ chủ đề". |
| C-13 | Composer placeholder | **[Observed]** clipped in the thread panel and at 375 ("Shift+Enter xu…"). | Copy / Layout | Minor | Keyboard hints are meaningless on phones and crowd the field. | Placeholder "Nhắn cho Phòng Kinh doanh…"; hint "Enter để gửi · Shift+Enter xuống dòng" as small text only on `(hover:hover)` devices. |
| C-14 | Message list | **[Observed]** every bubble repeats sender and "27/10 12:54" even today; mini avatar shows only "L" (`1440-chat-dept-messages.png`). **[Code]** `fmtDue` already produces "Hôm nay …". | Visual polish | Minor | Visual noise halves reading speed in busy groups. | Group consecutive messages by author within 5 minutes; day separators ("Hôm nay", "Hôm qua", "Thứ Hai 20/10"); time only inside a day. |
| C-15 | Below every conversation | **[Observed]** permanent row "Tin nhắn có thể được agent mà thành viên đã kết nối đọc." | Copy / IA | Polish | Uses a row of vertical space for a rarely relevant notice. | Show only when an agent can read the conversation, as an info icon with a tooltip in the header. |
| C-16 | Direct chat header | **[Observed]** "Cho agent đọc hội thoại này" is checked by default for a new DM; the header lists "Thành viên: Bùi Quang Huy, Đỗ Ngọc Lan" (`1440-chat-direct-conversation.png`). | IA / Privacy | Minor | A privacy-relevant default is on and phrased as a raw checkbox; the member line is redundant in 1:1. | Confirm the intended default with the product owner; render it as a labelled switch with a one-line explanation; drop the member line for DMs. |
| C-17 | Chat page height, 1440×900 | **[Observed]** a 100px empty band under the chat card (`1440-chat-default.png`). **[Code]** `.inbox` height `calc(100vh - 208px)` was sized for the Inbox KPI strip. | Layout | Polish | Wasted space; the composer sits higher than needed. | Chat-specific height `calc(100dvh - topbar - banner - gutters)`. |
| C-18 | Topic list | **[Observed]** the open topic card is not marked (`1440-chat-topic-panel.png`). | Navigation | Minor | Same "where am I" gap as C-02. | `aria-current` plus accent-weak background on the open topic card. |
| C-19 | Task-from-chat prefill | **[Observed]** title = raw message with "ạ."; description = timestamped transcript; assignee = requester (`1440-chat-task-from-thread.png`). | Copy / Flow | Minor | Every task from chat needs manual cleanup. | See J2: trimmed title, quoted excerpt and link, participant and mention suggestions for the assignee. |
| T-01 | `/tasks` list, Sale and Director | **[Observed]** only Đang mở / Đã xong and (managers) "Chỉ việc của tôi"; no search, assignee, priority or type filter, no sort; Director sees "Quá hạn 15" under the title "Việc của tôi" (`1440-tasks-list-director.png`). | Information architecture | Major | Leaders cannot triage by person; Sales cannot find a task by customer. | Filter bar: search, "Người phụ trách" combobox, Loại, Ưu tiên, Hạn; state in the URL; managers get "Công việc của nhóm" and optional group-by person. |
| T-02 | Task rows and Kanban cards | **[Observed]** "Bình thường" and "Next Action" badges on almost every row; overdue shown as a bare date "05/10 09:00" (`1440-tasks-list.png`). | Visual polish / Copy | Minor | Badges that are always present carry no information and hide the ones that matter. | Hide normal priority; keep "Cao" / "Khẩn cấp"; mark Next Action with a small icon; relative due "Quá 22 ngày" / "Hôm nay 17:00". |
| T-03 | Task detail | **[Observed]** the page is an always-editable form; "Lưu thay đổi" is a disabled button at the card's top-right; status appears 3 times (badge, select, header buttons); comments sit below subtasks, at 1151px on mobile (`1440-task-detail-from-chat.png`, `375-task-detail.png`). | Layout / Flow | Major | Reading and discussing are the common actions; editing is rare and has no dirty-state feedback. | Read-first header with one status control; inline-edit fields; sticky save bar when dirty; desktop two columns with comments in the main column under the description; mobile tabs "Chi tiết · Bình luận · Việc con". |
| T-04 | Comments block on task detail | **[Observed]** a toolbar "Trợ lý trong luồng: Chưa có · Thêm trợ lý" above every comment thread. | IA | Minor | Agent setup competes with the actual discussion. | Move "Thêm trợ lý" into the composer's "+" menu; show the agent row only when agents exist. |
| T-05 | Kanban at 768 and 375 | **[Observed]** one column per screen (`768-tasks-kanban.png` column about 696px wide); no column switcher; "Đang làm · Chỉ dành cho việc nội bộ"; empty columns say "Kéo việc vào cột này". **[Hypothesis]** touch drag conflicts with horizontal scroll-snap. | Responsiveness | Minor | Moving a task on a phone is hard; the column rule is unclear. | Under 900px: segmented column switcher with counts; 2 columns at 768; card "⋯ → Chuyển sang…"; copy "Việc gắn lead không đổi sang Đang làm". |
| T-06 | Complete / next-action dialog | **[Observed]** "…(QĐ13)…"; "Hoàn thành" disabled with no reason (`375-tasks-complete-next-action-dialog.png`). | Copy | Minor | Internal rule code means nothing to staff; a silent disabled button stalls them. | "Lead đang mở luôn cần một việc tiếp theo có hạn." Enable the button and validate inline ("Nhập việc cần làm tiếp theo"). |
| T-07 | Task list on mobile | **[Observed]** about 310px of chrome before the first task; a "Hoàn thành" button on every row; rescheduling needs the detail page (`375-tasks-list.png`). | Responsiveness / Flow | Minor | Triage on a phone is slow. | See J4: compact rows, trailing "⋯" quick actions, sticky bucket chips, shorter subtitle. |
| S-01 | Mobile shell | **[Observed]** chat unread count only inside the drawer; topbar search squeezed to "Tìm l" (`375-chat-list.png`). | Navigation | Minor | Two taps to learn whether anything is waiting. | Bottom tab bar (Tổng quan, Lead, Chat•, Việc•, Thêm); search becomes an icon that opens a full-screen search. |
| S-02 | Topbar badges | **[Observed]** two identical red "1" badges side by side (bell and approvals) with no visible label (`1440-shell-bell-huy.png`). "Việc của tôi" has no count for new or overdue tasks. | IA | Minor | The user cannot tell which "1" matters without hovering. | Approvals as a labelled pill ("Duyệt 1") or neutral badge colour; overdue count on "Việc của tôi". |
| X-01 | Global colour | **[Observed]** blue `--brand` / `--subnav-active` for the nav pill, segmented controls (Danh sách/Kanban, Việc nội bộ) and info badges, next to teal `--accent` primary buttons and selected chips (`1440-tasks-manual-form.png`). | Visual polish | Major | Two accents dilute the meaning of "this is the action/selection" (rubric item 6). | One interaction accent (teal). Nav active pill uses the teal or a neutral light slate; `SegmentedControl` default tone becomes neutral (white thumb). Keep blue only for `info` and channel identity. |
| X-02 | All date-time fields (task form, task detail, complete dialog) | **[Observed]** "mm/dd/yyyy --:-- --", "10/30/2026 09:00 AM", English label "Show local date and time picker". | Inputs / Accessibility | Major | Day and month are swapped for Vietnamese users, which risks wrong deadlines; the screen-reader text is English. | A styled `DateTimeField`: dd/MM/yyyy HH:mm 24h, typeable, calendar popover, the existing quick chips, Vietnamese labels. |
| X-03 | Assignee, lead, add member, add agent pickers | **[Observed]** raw `<select>` (9 people today); "Người cùng làm" and group-member chips list every staff member with no search. | Inputs | Major | Will not scale past about 20 staff; no type-ahead for diacritics. | `Combobox` (single and multi) with `foldDiacritics` search, keyboard navigation, "Không tìm thấy 'x'". |
| X-04 | Touch sizing at 375 | **[Observed]** inputs 14px font, chips 28px, `.btn-sm` 30px tall. **[Hypothesis]** iOS Safari zooms on focus below 16px. | Accessibility | Minor | Zoom-on-focus and small targets on the phone. | `@media (pointer:coarse)`: inputs 16px, chips and small buttons at least 40–44px. |
| X-05 | Type and radius scale | **[Code]** 13 font sizes in `styles.css` (10.5, 11, 11.5, 12, 12.5, 13, 14, 14.5, 16, 18, 19, 22, 24); radii 4, 5, 6, 7, 8, 9, 10, 12, 14, 999. | Visual polish | Polish | Many near-identical sizes read as noise. | Tokenise: `--text-xs 12`, `--text-sm 13`, `--text-md 14`, `--text-lg 16`, `--text-xl 20`, `--text-2xl 24`; radii `--r-sm 6`, `--r-md 8`, `--r-lg 12`, `--r-pill`. |
| X-06 | Toasts after create | **[Observed]** "Đã tạo công việc" has no action. | Feedback | Minor | The user must hunt for the new task. | Toast action "Mở việc"; "Hoàn tác" for recall where the API allows it. |

Counts: 0 Blocker, 12 Major, 19 Minor, 3 Polish (34 findings).

---

## 6. Rubric scores (0–2)

### Chat (`/chat`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 1 | Dark rail, cool workspace and teal bubbles express Direction 3, but the blue nav pill and the broken task card break the calm. |
| 2 | Hierarchy | 1 | The primary "Tạo nhóm" is clear; the thread panel has 4 equal-weight buttons and no single primary action. |
| 3 | Spacing rhythm | 1 | Consistent 8/12px inside rows; crowding in the panel header; the repeated meta line under every bubble flattens grouping. |
| 4 | Alignment | 1 | Rows align; titles truncate to "Phòn…" and "P..", and the close button wraps below the header row. |
| 5 | Typography | 1 | One family with good Vietnamese rendering; 13 distinct sizes in CSS; more than 6 sizes on the chat screen. |
| 6 | Color discipline | 1 | Teal means action; blue also means "active" (nav) and "info" (member badge). |
| 7 | Depth and shape | 1 | Hairline plus light shadow throughout; radii range from 4 to 14px plus pills. |
| 8 | States and feedback | 1 | Loading, empty and error states exist; the selected state is broken (C-02); the "⋯" is invisible until hover; no unread divider. |
| 9 | Responsiveness | 1 | Re-composes to one column under 900px with back buttons; the title crushes to "P.."; 845px page in an 812px viewport; targets below 44px. |
| 10 | Slop tells | 2 | No gradients or decorative noise apart from the brand mark; no clichés. |
| 11 | Content and copy | 1 | Natural Vietnamese; chuỗi/chủ đề mixed in topic mode; keyboard hints inside placeholders. |
| 12 | Craft details | 0 | 238px icon in the task card; "⋯" as a text glyph; full date on every bubble. |
| | **Total** | **12/24** | Target is at least 20. Three weakest: 12 (C-01, C-14), 9 (C-04, X-04), 8 (C-02, C-08). |

### Tasks (`/tasks`, `/tasks/:id`)

| # | Item | Score | Evidence |
|---|---|---|---|
| 1 | Brief fidelity | 1 | Fits the workspace style; the blue segmented thumb competes with the teal primary button. |
| 2 | Hierarchy | 1 | List: "Tạo việc" is obvious. Detail: the edit form outranks reading and comments; 3 header actions plus a status select. |
| 3 | Spacing rhythm | 1 | Even 16px card padding; mobile stacks about 310px of chrome before content. |
| 4 | Alignment | 2 | Dates are right-aligned and buttons line up in a column on desktop. |
| 5 | Typography | 1 | Same scale sprawl; mono `L-0001` works well. |
| 6 | Color discipline | 1 | Red overdue dates are meaningful; the blue "Bình thường" badge on every row is decoration. |
| 7 | Depth and shape | 1 | Kanban cards combine border, shadow and a 3px red left border. |
| 8 | States and feedback | 1 | Empty states exist; "Lưu thay đổi" and "Hoàn thành" are disabled with no reason; no dirty-state bar. |
| 9 | Responsiveness | 1 | No horizontal overflow; Kanban shows one column at 768; comments at 1151px on mobile. |
| 10 | Slop tells | 2 | None. |
| 11 | Content and copy | 1 | Mostly clear; "QĐ13", "Việc của tôi" for a Director's team view, and "Chỉ dành cho việc nội bộ" are unclear. |
| 12 | Craft details | 0 | US date and AM/PM in a Vietnamese UI; raw selects; English picker label. |
| | **Total** | **13/24** | Three weakest: 12 (X-02, X-03), 2 (T-03), 8 (T-03, T-06). |

---

## 7. Cross-cutting token and component recommendations

Tokens (all in `apps/crm/src/web/styles.css`):
- **One interaction accent.** Teal `--accent` for primary buttons, selection, focus and links. Retire `--subnav-active` blue for the nav pill; use `--accent` (or a neutral slate pill on the dark rail). Keep `--brand` blue only for `info` and channel identity.
- **Type scale.** `--text-xs: 12px; --text-sm: 13px; --text-md: 14px; --text-lg: 16px; --text-xl: 20px; --text-2xl: 24px`. Map 10.5, 11 and 11.5 to `xs`, 12.5 to `sm`, and 14.5 to `md`. Inputs use `--text-lg` under `(pointer:coarse)`.
- **Radius scale.** `--r-sm: 6px` (controls), `--r-md: 8px` (cards, menus), `--r-lg: 12px` (dialogs, drawers), `--r-bubble: 14px`, `--r-pill: 999px`.
- **Spacing tokens.** `--space-1 … --space-8` on a 4px base, replacing inline `style={{ padding: '10px 12px 6px' }}` in `chat.tsx`.
- **Touch.** `--hit-min: 44px` applied under `(pointer:coarse)` to `.chip`, `.btn-sm`, `.icon-btn` and `.chat-msg-actions-btn`.
- **Motion.** `--dur-fast: 120ms; --dur-panel: 200ms; --ease-out: cubic-bezier(.2,.8,.2,1)`. Animate the thread panel and drawers in (fade plus 8px translate). Reduced motion already holds.

Shared components (in `components/ui.tsx` or new kebab-case files under `components/`):
- `DateTimeField` for dd/MM/yyyy HH:mm 24h with the quick chips (X-02).
- `Combobox` and `MultiCombobox` with diacritic-insensitive search (X-03).
- `ConfirmDialog` that names the object and consequence and repeats the verb (C-06), replacing `window.confirm`.
- `Toast` with an action slot ("Mở việc", "Hoàn tác") (X-06).
- `OverflowMenu` built from the "⋯" pattern used three times today (message, department row, thread header), with icon, label, divider and danger item.
- `Drawer` already exists (`.drawer` in CSS); reuse it for the task form from chat and for task detail from lists.
- `Icon` gets a default `width="1em" height="1em"` so an unsized icon can never fill its container (C-01 class of bug).
- Design guidelines: `docs/design-guidelines.md` does not exist (only `docs/source-package/design/abm-agentic-crm-design.md`). Record these tokens there once accepted. Not created here because this task is audit-only.

---

## 8. Prioritized fix plan

### (A) Quick wins

| # | Change | Files | Acceptance check |
|---|---|---|---|
| A1 | Size icons in chat task cards; default `Icon` to 1em | `src/web/styles.css`, `src/web/components/icons.tsx` | At 375, 768 and 1440 the "Đã tạo việc" card shows a 16px icon, the full title on one line and "Mở việc" without overlap; card height at most 72px. |
| A2 | Selected-row style for `aria-current='page'` | `src/web/styles.css` (lines 501, 799) | Open any conversation: its row has `--brand-soft`/accent-weak background and a 3px left border; the eval shows a non-transparent background. |
| A3 | Thread/topic panel header: one row; Theo dõi / Tắt thông báo / Đóng chủ đề into "⋯" | `src/web/components/chat-thread-panel.tsx`, `src/web/styles.css` | At 1440 with a thread open, the header is 56px tall, "Chuỗi" or "Chủ đề" and the conversation name are fully visible, and the close button is on the same row. |
| A4 | Rows: drop the "Phòng ban" chip, fixed trailing column for time and badge; header hides badges when the panel is open | `src/web/pages/chat.tsx`, `src/web/styles.css` | "Phòng Kinh doanh" reads in full with an unread badge at 1440; the mobile header shows the full name; the topic group name stays visible with the panel open. |
| A5 | Confirm before "Xóa", "Rời nhóm", "Thu hồi"; replace `window.confirm`; "Thu hồi" last, after a divider, in danger colour | `src/web/components/ui.tsx` (ConfirmDialog), `chat-group-settings.tsx`, `chat-message-item.tsx`, `chat-thread-panel.tsx` | Each destructive action opens a styled dialog naming the person or message; Cancel leaves data unchanged; no `window.confirm` remains in `src/web` (grep). |
| A6 | Persist composer drafts per conversation and thread | `src/web/components/chat-composer.tsx` | Type, switch conversation, return: text is restored; after send the draft is cleared; reload keeps it within the tab session. |
| A7 | Topic-mode and placeholder copy | `chat-topic-list.tsx`, `chat-thread-panel.tsx`, `chat-composer.tsx` | No visible "chuỗi" in a topic-mode group; the placeholder is not clipped at 375 or in the panel; hint shown only on hover-capable devices. |
| A8 | `?list=threads` in the URL | `src/web/pages/chat.tsx`, `src/web/chat-links.ts`, `src/web/router.tsx` | Reload on the Chuỗi tab keeps it selected; Back returns to Tất cả. |
| A9 | Hide normal priority; relative overdue text | `src/web/components/task-form-dialog.tsx` (PriorityBadge), `src/web/format.ts`, `src/web/pages/tasks.tsx`, `src/web/components/task-board.tsx` | No "Bình thường" badge in the list or Kanban; overdue rows read "Quá N ngày"; "Cao" and "Khẩn cấp" still show. |
| A10 | Neutral default tone for `SegmentedControl`; nav active pill uses the accent | `src/web/components/ui.tsx`, `src/web/styles.css` | The `/tasks` header and "Tạo việc" dialog show no blue fill; grayscale screenshot still shows the active segment. |
| A11 | Mobile touch and input sizing | `src/web/styles.css` | At 375 the computed input font-size is 16px; chips, `.btn-sm` and the message "⋯" are at least 40px tall under `(pointer:coarse)`. |
| A12 | Agent notice only when relevant; DM header without member line | `src/web/pages/chat.tsx` | A conversation with no readable agent shows no footer row; the DM header shows the name only. |
| A13 | Chat height fills the viewport | `src/web/styles.css` | No empty band under the chat card at 1440×900; at 375×812 `scrollHeight` equals the viewport height on the conversation view. |
| A14 | Next-action dialog copy and inline validation | `src/web/components/lead-actions.tsx` | No "QĐ13"; pressing "Hoàn thành" with an empty "Việc cần làm" focuses it and shows a message under the field. |
| A15 | Toast with "Mở việc" after creating a task | `src/web/components/ui.tsx` (toast action), `task-form-dialog.tsx` | After create, the toast has a working "Mở việc" link to `/tasks/:id`. |

### (B) Structural changes

| # | Change | Files | Acceptance check |
|---|---|---|---|
| B1 | `DateTimeField` (dd/MM/yyyy HH:mm, 24h, Vietnamese labels, quick chips) replacing every `datetime-local` | new `src/web/components/date-time-field.tsx`; `task-form-dialog.tsx`, `pages/task-detail.tsx`, `lead-actions.tsx`, `styles.css` | `document.querySelectorAll('input[type=datetime-local]').length === 0` on all three screens; a due date shows "30/10/2026 09:00"; typing "31/10 14:00" works; axe shows no English labels. |
| B2 | `Combobox` / `MultiCombobox` for assignee, lead, members, add member, add agent | new `src/web/components/combobox.tsx`; `task-form-dialog.tsx`, `pages/task-detail.tsx`, `chat-group-settings.tsx`, `chat-thread.tsx`, `pages/chat.tsx` | Typing "huy" lists Bùi Quang Huy; arrow keys and Enter select; "Không tìm thấy 'xyz'"; works with 200 seeded users without scrolling a chip wall. |
| B3 | Unread wayfinding: "Tin mới" divider, jump to first unread, "Chưa đọc" filter, list search | `pages/chat.tsx`, `components/chat-thread.tsx`, `components/chat-composer.tsx` (`useDebouncedMarkRead`), `styles.css`. **[Hypothesis]** may need `lastReadAt` in the conversation payload. | As recipient: opening a conversation with 3 unread shows the divider above the first of them; it stays until leaving; the "Chưa đọc" chip shows only conversations with unread; search "lộc" finds "Dự án Lộc Thọ". |
| B4 | Message grouping and day separators | `components/chat-message-item.tsx`, `components/chat-thread.tsx`, `format.ts`, `styles.css` | Three consecutive messages from one author within 5 minutes show one name and time; a "Hôm nay" separator appears; earlier days show "Thứ Hai 20/10". |
| B5 | Task-from-chat in a side drawer with clean prefill and assignee suggestions | `components/task-form-dialog.tsx` (drawer variant), `chat-task-draft.ts`, `chat-task-cards.tsx`, `chat-thread-panel.tsx` | From a thread the drawer opens beside it with the thread visible at 1440; the title has no trailing particle or timestamp; participants appear as assignee chips; J2 drops to at most 3 actions for the common case. |
| B6 | Task triage: filter bar, URL state, manager view, row quick actions | `pages/tasks.tsx`, `router.tsx` (search schema), `list-query.ts`, `components/task-board.tsx`. **[Hypothesis]** `/tasks` may need `q`, `assignee`, `priority` parameters. | Director filters by "Vũ Đức Long" and sees only his tasks, and reload keeps the filter; managers see the title "Công việc của nhóm"; a row "⋯" offers "Xong", "Dời sang mai 9:00", "Dời +3 ngày". |
| B7 | Task detail read-first layout with sticky save bar and comments prominent | `pages/task-detail.tsx`, `components/chat-thread.tsx` (agent bar), `styles.css` | Status is editable in one place; editing a field shows a sticky "Lưu / Hủy" bar; on mobile the "Bình luận" tab is reachable within one tap from the top. |
| B8 | Mobile shell: bottom tab bar with badges, search as full-screen sheet | `components/layout.tsx`, `styles.css` | At 375 the Chat tab shows the unread count and the Việc tab shows the overdue count without opening the drawer; the search sheet opens from an icon. |
| B9 | Kanban under 900px: column switcher, 2 columns at 768, "Chuyển sang…" menu | `components/task-board.tsx`, `styles.css` | At 375 the switcher shows "Cần làm 7 · Đang làm 0 · Xong 0"; a task moves column without dragging; at 768 two columns are visible. |
| B10 | Token consolidation and design guidelines | `styles.css`; new `docs/design-guidelines.md` | At most 6 font sizes and 5 radii in tokens; no raw hex in component CSS except tokens; the guidelines doc lists the brief, tokens and the components above. |
| B11 | Ctrl/Cmd+K palette across leads, chats and tasks | `components/layout.tsx`, new `components/command-palette.tsx`; search API | Ctrl+K opens the palette; typing "báo giá" lists the task "Gửi báo giá cho Công ty Lộc Thọ" and the conversation where it came from. |

Suggested order: A1–A5 first (one PR), then A6–A15, then B1 + B2 (shared inputs unblock B5–B7), then B3, B6, B8, and B4, B9–B11 last.

---

## 9. Unresolved questions

1. Should "Cho agent đọc hội thoại này" really default to on for new direct chats (C-16)?
2. Should leaders and directors land on their own tasks or on the team view by default, and what should the page be called for them (T-01)?
3. Does the API expose a per-conversation `lastReadAt` (or first-unread id) for the "Tin mới" divider, and do `/tasks` endpoints accept search and assignee filters (B3, B6)?
4. Is a short "Hoàn tác" window acceptable for "Thu hồi", or should recall stay confirm-only (C-06)?
5. Should thread replies ever appear as the group's list preview (C-10)?
