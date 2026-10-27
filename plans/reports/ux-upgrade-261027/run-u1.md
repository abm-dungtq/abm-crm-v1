# UX upgrade run 1: chat and tasks fixes (A1–A15 plus backend fixes 5 and 6)

Date: 2026-10-27 (Asia/Saigon). Source: `plans/reports/ux-audit-261027-chat-tasks.md` section 8A, plus the supervisor decisions in `brief-U1.md`.
Screenshots: `plans/reports/ux-upgrade-261027/run-u1/`.

## Outcome

All 15 A-items and both backend fixes are implemented. Every acceptance check except the real-touch-device sizing (A11, see "Unverified") was confirmed in the browser against the running dev servers (demo mode). All three gates exit 0:

- `pnpm -r typecheck` passes.
- `pnpm --filter @abm/crm test` passes: 61 files, 777 tests passed, 2 skipped. The budget tests (message_budget, task_budget and two more) are green.
- `pnpm --filter @abm/crm build` passes. Vite prints its usual chunk-size warning, which was there before this run.

## Items and how each was verified

| Item | What changed | Verification |
|---|---|---|
| A1 | `SegmentedControl` defaults to the neutral tone. The nav active pill and inbox channel button use `--on-accent`. `--subnav-active` maps to `--accent`. | /tasks Danh sách/Kanban and the Tạo việc dialog type switch show the neutral segmented look (`1440-tasks-list.png`, `1440-tasks-create-dialog.png`). |
| A2 | The selected conversation row (`aria-current="page"`) gets the accent-weak fill and a 3px accent left border. | Measured in the browser: `aria-current="page"`, background rgb(226,241,239), 3px teal border (`1440-chat-dept-selected.png`). |
| A3 | The thread/topic panel header is a single row: title, "Tạo việc", an overflow menu (Theo dõi / Thông báo / Đóng chủ đề) and close. | Header is 56px tall with every control on one row and no clipped subtitle (`1440-chat-thread-panel.png`, `1440-chat-topic-panel.png`). |
| A4 | New conversation row grid (avatar, then name and preview, then time and badge). The "Phòng ban" chip is gone. The header has a name line plus a meta line. | "Phòng Kinh doanh" is not clipped in the row or the header at 1440, 768 or 375 (`768-chat-dept.png`, `375-chat-dept-conversation.png`). The topic group name stays visible with the panel open. |
| A5 | New `ConfirmDialog` built on the app `Modal`. It is used for Thu hồi, Xóa thành viên, Rời nhóm, đổi chế độ nhóm and đóng chủ đề. Focus starts on "Hủy". Message actions moved to a shared `OverflowMenu` with the danger item last, after a separator. | Recall: the dialog quotes the message; Enter on the focused "Hủy" cancels and nothing is recalled (`1440-chat-message-menu.png`, `1440-chat-recall-confirm.png`). Rời nhóm: Escape closes only the confirm, the settings dialog stays open and the group stays in the list (`1440-chat-leave-confirm.png`). Xóa: "Hủy" keeps the member; "Xóa khỏi nhóm" removes the member (`1440-chat-remove-member-confirm.png`). A grep finds no `window.confirm` anywhere in `apps/crm/src/web`. |
| A6 | Composer drafts are saved in sessionStorage per conversation and per thread (`chat-draft:{id}:{root|main}`). Storage errors are ignored. | Typed in a group and in a DM, switched between them and reloaded: both drafts came back. After sending, the DM draft key was removed and the field was empty, while the other draft was untouched. Unit tests cover the store. |
| A7 | Short placeholders: "Nhập tin nhắn…", "Viết chủ đề mới…", "Trả lời chủ đề…", "Trả lời trong chuỗi…". Keyboard tips moved to a hint line shown only on hover+fine pointer. Topic mode never says "chuỗi". | Measured that each placeholder fits its field at 375 (`375-chat-topic-group.png`). This needed a short "Đăng" send label in narrow columns (see Deviations). |
| A8 | The Tất cả/Chuỗi tab lives in the URL (`?list=threads`), validated by `parseChatSearch`. | Chose Chuỗi, reloaded and it stayed selected; Back returned to Tất cả. Unit tests cover `chatLink` and `parseChatSearch`. |
| A9 | `PriorityBadge` hides "Bình thường". New `fmtDueRelative` shows "Quá N ngày" or "Quá hạn HH:mm", with the full due time in the tooltip. Used in the list and Kanban. | As director (u-bgd): 0 "Bình thường" in the list and Kanban; 15 "Quá N ngày" labels (`1440-tasks-list.png`, `1440-tasks-kanban.png`). Unit tests cover the format. |
| A10 | Teal is the single accent. `--focus` changed to teal. Blue fills were removed from the /tasks header and the Tạo việc dialog. | A scripted scan found no blue-dominant backgrounds on /tasks, the Kanban or the dialog. Grayscale screenshot: `1440-tasks-kanban-grayscale.png`. |
| A11 | On `(pointer: coarse)`: inputs at 16px; `.chip`, `.btn-sm`, icon buttons and the message "⋯" at 40px or taller. | The coarse media rules were applied unconditionally in the page and measured: inputs 16px, `.btn-sm` 40px, "⋯" 40px (`375-chat-dept-touch-sizes.png`). Device emulation does not switch `pointer: coarse`, so this check is indirect. |
| A12 | The DM header shows the name only. A labelled switch "Cho agent đọc hội thoại này" (role=switch, ON by default) sits under it with the one-line explanation. If toggling fails, a FormError shows. | At 1440 and 375 the header text is just "Bùi Quang Huy" and the switch is checked (`1440-chat-dm-header.png`, `375-chat-dm-header.png`). |
| A13 | Full-height chat through `.main:has(.chat-inbox)`. The footer notice row was removed. | Document scrollHeight equals the viewport height at 1440×900, 768×1024 and 375×812 (812). There is no empty band. |
| A14 | "QĐ13" is removed from the UI text. "Hoàn thành" stays enabled; an empty next-action title shows "Nhập việc cần làm tiếp theo", marks the field invalid and focuses it. | No QĐ13 on the page. Clicking with an empty title focused the input (aria-invalid=true) and showed the message (`1440-complete-task-missing-title.png`). |
| A15 | Toasts can carry a link. After a task is created, the toast "Đã tạo công việc" shows a "Mở việc" link and stays for 8s. | Created a task, clicked "Mở việc" in the toast and landed on `/tasks/81417777-…` (`1440-task-created-toast.png`). |
| Backend fix 5 | In the `last_message` subquery, `listConversations` skips thread-only replies: `AND (lm.thread_root_id IS NULL OR lm.also_in_main = 1)`. | New test: a thread-only reply does not change the preview, and a reply also sent to the group does. In the browser, the Phòng KD preview and time (12:54) match the main flow. |
| Backend fix 6 | `lastReadAt` (from `chat_member.last_read_at`, a nullable ISO string) is added to each conversation item and to the web type. Additive only. | New test: null before reading, then equal to the posted `at` after POST /read. |

## Files changed (apps/crm only)

- Worker and types: `src/worker/chat.ts`, `src/web/types.ts`.
- Web logic: `src/web/chat-links.ts` (list search param, draft helpers), `src/web/format.ts` (`fmtDueRelative`), `src/web/router.tsx` (`/chat` validateSearch).
- Shared components:
  - `components/ui.tsx`: `ConfirmDialog`, `OverflowMenu`, toast action, the Modal nested-close fix, and the neutral default for `SegmentedControl`.
  - `components/icons.tsx`: the `more` icon and a default 1em size.
- Chat:
  - `components/chat-message-item.tsx`, `components/chat-thread-panel.tsx`, `components/chat-composer.tsx`
  - `components/chat-topic-list.tsx`, `components/chat-group-settings.tsx`, `components/chat-task-cards.tsx`
  - `pages/chat.tsx`
- Tasks: `components/task-form-dialog.tsx`, `components/task-board.tsx`, `components/lead-actions.tsx`, `pages/tasks.tsx`.
- `window.confirm` removal outside chat: `components/class-online-program.tsx` (Xoá video) and `pages/learner-accounts.tsx` (Đặt lại mật khẩu).
- `src/web/styles.css` (LF endings kept).
- Tests: `test/chat-threads.test.ts`, `test/web-chat.test.ts`, `test/web-bugfixes.test.ts`.

README.md and `.claude/` also show changes in `git status`. Those changes were not made in this run, and those files were left alone.

## Deviations

1. **Two files outside chat and tasks were changed.** `class-online-program.tsx` and `learner-accounts.tsx` both used `window.confirm`. They now use `ConfirmDialog`, so the "no window.confirm" grep returns zero. The copy names the video or the learner. The video delete uses the danger tone; the password reset uses the primary tone.
2. **Modal fix.** React passes a nested dialog's `close`/`cancel` events up to the parent `Modal`. Its handlers now act only when `e.target === e.currentTarget`. Without this, cancelling a confirm inside "Cài đặt nhóm" also closed the settings dialog.
3. **`--focus` is now teal (#0d6b67).** This follows the single-accent decision; the focus ring keeps more than 3:1 contrast.
4. **The /tasks page title is unchanged.** No A-item covers it, so per supervisor decision 4 it is left for run 2.
5. **The group agent notice is now a bot icon with a tooltip.** It replaces the old footer notice row and sits at the end of the header meta line (role=img, with an aria-label holding the full notice text).
6. **The DM agent switch sits in its own row under the header.** It does not fit inside the header itself at 375.
7. **Short send label in narrow columns.** The topic composer's "Đăng chủ đề" button left the field about 125px wide at 375, which made the placeholder wrap. A new optional `sendShortLabel` shows "Đăng" when the conversation column is 560px or narrower (container query). The button's `aria-label` keeps the full "Đăng chủ đề", and the visible text is a prefix of it.
8. **Local test data.** The browser checks left a little data in the **local** dev database: a group "Nhóm thử xác nhận" (director, with Vũ Đức Long removed), an internal task "Việc thử kiểm tra thông báo", and a DM "Nháp tin riêng" from Lan to Huy. Nothing remote was touched.

## Unverified or partly verified

- **A11 on a real touch device.** Device emulation in agent-browser does not switch `(pointer: coarse)`, so the coarse rules were checked by injecting them unconditionally and measuring. Behaviour on an actual phone has not been checked.
- **The 40px floor.** The audit's acceptance check uses 40px for chips, `.btn-sm` and "⋯". The rules file asks for 44px touch targets. The composer send and attach buttons are 44px; the smaller controls are 40px, as the audit item specifies.
- **The hover-only composer hint.** It shows in desktop emulation at 375, because the pointer there is still fine and hover is available. On real touch devices it is hidden by `(hover: hover) and (pointer: fine)`.

Status: DONE_WITH_CONCERNS
Summary: All A1–A15 items and backend fixes 5 and 6 are implemented and checked in the browser at the required viewports, and the typecheck, test and build gates all exit 0.
Concerns/Blockers: Touch sizing was checked by forcing the coarse-pointer rules, not on a real device. Two non-chat files were changed to remove `window.confirm`. Some test data was left in the local dev database.
