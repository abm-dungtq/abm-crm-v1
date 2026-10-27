# Run U2: task forms, triage and task detail (2026-10-27)

All requested items are done. The three gates pass, and every acceptance check was verified in the browser (agent-browser, director `u-bgd` plus Sale `u-long`, demo mode) and by unit tests. Screenshots are in `plans/reports/ux-upgrade-261027/run-u2/`. The browser session was closed afterwards.

## Gates

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 |
| `pnpm --filter @abm/crm test` | exit 0: 62 files passed, 1 skipped; 792 tests passed, 2 skipped (both skips were there before this run). The budget tests are green. |
| `pnpm --filter @abm/crm build` | exit 0 (only the existing chunk-size warning) |
| `grep -r "datetime-local" apps/crm/src/web` | 0 matches |

## Items and how each was verified

### Shared Vietnamese date-time field
`components/date-time-field.tsx` and `date-time.ts`.

What it does:
- The field reads and writes dd/MM/yyyy with a 24-hour time.
- It accepts short forms ("31/10 14h", "1/11/26 9h30", "31.10 lúc 8") and pasted ISO.
- An entry it cannot read shows a Vietnamese error and reverts to the last valid value on blur.
- The calendar popup uses Monday-first weeks. Every day button has a spoken label ("Thứ Bảy, 31/10/2026"). It supports arrows, PageUp and PageDown, has time chips, and Escape returns focus to the calendar button.
- The value shape is unchanged: "YYYY-MM-DDTHH:mm" in Vietnam time, sent through the existing `fromLocalInput`.

Where it is used:
- Task create form, task detail, the next-action field (complete dialog and lead actions), class-detail session and makeup fields, and the fee "received at" field.
- Chat task drafts reuse the same task form dialog.

Browser checks:
- No `input[type=datetime-local]` exists in the create dialog or on the page.
- "31/10 14h" becomes `31/10/2026 14:00`. "31/02" shows the error and keeps 14:00 (`1440-dtf-invalid.png`).
- The calendar keyboard moved focus from "Thứ Bảy, 31/10/2026" to "Chủ Nhật, 08/11/2026", Enter set the value, and Escape kept the modal open with focus back on the calendar button (`1440-dtf-calendar.png`).
- The complete dialog defaults the next action to `28/10/2026 09:00` (`375-complete-next-action.png`).

### Shared combobox
`components/combobox.tsx`.

What it does:
- Single-select and multi-select, following the ARIA combobox pattern: arrows, Home and End, Enter, Escape (which does not close the surrounding dialog), Tab, and type-to-filter.
- Matching ignores Vietnamese accents (`text-search.ts`).
- The multi-select shows removable tags, Backspace removes the last tag, and it enforces a 20-person cap with a message.

Where it is used: assignee (create form and task detail), lead (server search), "Người cùng làm" (create form and task detail), and the assignee filter on /tasks.

Browser checks:
- "duc long" matched only "Vũ Đức Long" (`1440-tasks-assignee-combobox.png`).
- Lead search "L-0005" picked by keyboard (`1440-create-task-lead.png`).
- Two members added by typing and Enter, and Escape kept the modal open (`1440-create-task-members.png`).

### Triage on /tasks
`task-filters.ts`, `pages/tasks.tsx`, `components/task-board.tsx` and `router.tsx`.

What it does:
- A search box, an assignee filter (hidden for Sale), status chips (list view), and due chips (Quá hạn / Hôm nay / Tuần này) with counts.
- All filter state lives in the URL, and filtering runs client-side over the loaded lists.
- A notice appears when a list reaches the 300-per-status API cap. The API is unchanged.
- Each row has a "⋯" menu with "Dời sang mai 9:00", "Dời +3 ngày (9:00)" and "Mở việc". It uses the existing `updateTask` with `dueAt` only, so it never sends a null due date for CRM tasks.

Browser checks:
- `?assignee=u-long` kept 4 rows after a reload.
- "gui tai lieu" found the matching task, with `?q=` in the URL (`1440-tasks-search.png`).
- The Hôm nay filter shows the filtered empty state with "Xóa bộ lọc" (`1440-tasks-due-empty.png`).
- The row menu moved a task to 30/10 09:00 with a toast (`1440-tasks-row-menu.png`).

### Page title
Director sees "Việc của nhóm" (`1440-tasks-team.png`). With "Chỉ việc của tôi" the title is "Việc của tôi" (`1440-tasks-mine.png`). Sale sees "Việc của tôi" with no assignee filter and no toggle (`375-tasks-sale.png`). The nav label is "Công việc" for every role.

### Kanban column switcher
- At 375, one column shows with a switcher above it (Cần làm / Đang làm / Xong, with counts and aria-pressed); switching to "Đang làm" showed only that column (`375-tasks-board.png`).
- At 768, two columns sit side by side and the third wraps below (`768-tasks-board.png`).
- At 1440 the switcher is hidden and all three columns show (`1440-tasks-board.png`).
- Card "⋯" menu: a lead task offers only "Chuyển sang Xong" (`375-board-card-menu.png`).

### Task detail (limited to these three changes)
`pages/task-detail.tsx`.
- **One status control.** A segmented "Cần làm / Đang làm" control for open internal tasks the user may edit, and a badge otherwise. The old select and the "Bắt đầu làm" button are removed. Browser: toggled to Đang làm and back, both saved.
- **Sticky save bar.** It appears only when there are unsaved edits. It says why saving is blocked ("Nhập tiêu đề để lưu.", with Save disabled) and offers "Hủy thay đổi", which restored the saved title (`1440-task-detail-savebar.png`).
- **Comments tab.** At 860px and below, "Chi tiết / Bình luận" tabs appear; the Bình luận tab shows only comments (`375-task-detail.png`, `375-task-detail-comments.png`).

### 44px touch targets
In the `(pointer: coarse)` block, chips, small buttons, icon buttons, menu items, tabs, segmented buttons, switcher buttons, combobox options and calendar days use a new `--hit-min: 44px` token. Desktop density is unchanged: chips measured 28px at fine pointer.

Verification: device emulation does not report a coarse pointer, so I re-applied that media block's rules in the page at 375. Switcher buttons measured 115×44, chips about 100×44 and card "⋯" buttons 44×44, with no overflow (`375-tasks-board-touch.png`).

### No horizontal overflow at 375 and 768
Checked on the tasks list, the board, task detail and the complete dialog.

### Unit tests
`test/web-tasks.test.ts` covers:
- date formatting and parsing, including invalid days, US month-first input, date-only mode, the API value shape and quick due values across a month end;
- calendar weeks and labels;
- accent-insensitive matching;
- the task filters: due windows in Vietnam time, search fields, combined filters, the URL schema, the title and the list cap.

## Files changed in this run
- New: `apps/crm/src/web/{date-time.ts, task-filters.ts, text-search.ts}`, `apps/crm/src/web/components/{date-time-field.tsx, combobox.tsx, floating.ts}`, `apps/crm/test/web-tasks.test.ts`.
- Modified: `apps/crm/src/web/{format.ts, chat-task-draft.ts (comment only), router.tsx, styles.css}`, `components/{icons.tsx, layout.tsx, lead-actions.tsx, mention-input.tsx, task-board.tsx, task-form-dialog.tsx}`, `pages/{tasks.tsx, task-detail.tsx, class-detail.tsx, fees.tsx}`.
- The other modified files in the working tree are from run U1 and were not touched here.

## Deviations and decisions
- **Pages outside the brief's list.** class-detail and fees were changed because the brief requires the `datetime-local` grep to be empty. Their native `type="date"` inputs (and those in partners and learner-accounts) were left as they are. The brief covers date fields in task forms; these are outside task work.
- **Kanban card "⋯" menu.** I added a "Chuyển sang …" menu on cards. With one column visible on a phone, dragging between columns is impossible, so this is the only way to move a card there. It reuses the board's existing move logic.
- **Empty next-action due.** `nextActionPayload` now sends an empty `dueAt` instead of crashing when the field is cleared. The server's existing validation message then applies.
- **Small copy changes on the board.** In the "Đang làm" subtitle and the empty column text.
- **Priority** stays a native select. It has three fixed values, so a combobox adds nothing.
- **Save bar.** It sits at the bottom of the main column (sticky), and the old card-head save button was removed.
- **Fixes made during browser checks:**
  - Typed or shared links such as `?mine=1` and `?q=2026` are now accepted. The router JSON-parses them into numbers, which were being dropped. A unit test covers this.
  - The popup now opens upward whenever its full height does not fit below and there is more room above. Before, the calendar was cut off at the bottom of a 900px-tall window.

## Not verified
- I did not test on a real touch device. The 44px sizes were measured by re-applying the coarse-pointer rules, as described above.
- I did not run a screen reader. The roles, labels, aria-activedescendant and aria-pressed values were checked in the DOM.
- I did not reach the API cap notice in the browser, because demo data has fewer than 300 tasks. The cap detection is unit-tested.
- The browser checks changed local demo data. "Gửi báo giá cho Công ty Lộc Thọ" now has its due date moved to 30/10 09:00, and its status was toggled to Đang làm and back.

Status: DONE
Summary: Shared Vietnamese date-time field and combobox, /tasks triage with URL filters and quick reschedule, role-based titles, the Kanban column switcher, the scoped task-detail changes and 44px touch targets are in place. Typecheck, the full test suite and the build all pass, and every item was checked in the browser at 1440, 768 and 375.
Concerns/Blockers: Touch sizes and screen-reader behaviour were verified indirectly. Local demo data for one task was changed during the checks.
