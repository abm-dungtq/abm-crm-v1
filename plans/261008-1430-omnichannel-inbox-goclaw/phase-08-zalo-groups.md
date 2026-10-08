---
phase: 8
title: "Nhóm Zalo: tóm tắt và tin định kỳ"
status: pending
priority: P2
effort: "2d"
dependencies: [4, 6]
---

# Phase 08: Nhóm Zalo — tóm tắt hằng ngày và tin định kỳ

## Goal

Trang Nhóm Zalo cho xem và gửi tin nhóm; tóm tắt nhóm hằng ngày lúc 21:00 giờ Việt Nam gửi vào Lark; lịch tin định kỳ vào nhóm có khách, chỉ chạy khi đã duyệt và qua mọi lớp kiểm soát chống khoá tài khoản.

## Quy tắc (executor không được đổi)

1. Bot **không** trả lời trong nhóm (đã chặn ở phase 03). Nhóm chỉ có: nhân viên gửi tay, tin định kỳ, tóm tắt.
2. Tóm tắt: cron `0 14 * * *` (21:00 giờ Việt Nam). Với mỗi nhóm `summary_enabled = 1` có ít nhất 1 tin `in` từ 00:00 giờ Việt Nam hôm nay, tạo `run_completion` `payload = { agentKey: 'group-summarizer', userId: 'group-summary:' + crypto.randomUUID(), conversationId, purpose: 'group_summary', text }`, `dedupe_key = 'summary:' + conversationId + ':' + <ngày yyyy-mm-dd>`; `text` = tối đa 300 tin trong ngày. Kết quả → lệnh `send_lark`: `Tóm tắt nhóm <tên nhóm> (<tên tài khoản>) ngày <dd/mm>:\n<nội dung>`.
3. Lịch: `weekdays_mask` (bit 0 = Thứ Hai … bit 6 = Chủ nhật), `time_of_day` `HH:MM` giờ Việt Nam (UTC+7, không đổi giờ mùa). `next_run_at` = lần gần nhất khớp lịch + độ lệch ngẫu nhiên 0–10 phút.
4. Vòng đời: `draft` → (gửi duyệt) `pending_approval` → (role `leader`/`head`/`director`/`admin` duyệt, không phải người tạo) `active` ↔ `paused`. Sửa `template_text` hoặc lịch của lịch `active` → quay về `pending_approval`. Người tạo: mọi role xem được Inbox.
5. Cron mỗi phút với lịch `active` có `next_run_at <= now`, kiểm theo thứ tự. Điều kiện 1–4 sai → **không tạo lệnh nào**, ghi `last_skip_reason` (`feature_off`, `bot_switch_on`, `account_unavailable`, `group_opted_out`) và tính `next_run_at` lần kế tiếp theo lịch. Điều kiện 5–6 sai → dời `next_run_at` như mô tả và ghi `last_skip_reason` (`quiet_hours`, `daily_cap`):
   1. `inbox_setting.scheduled_sends_enabled = 1` (công tắc tính năng, mặc định 0, chỉ bật ở phase 10 sau pilot).
   2. `customer_bot_switch.enabled = 0`.
   3. Tài khoản `status = 'connected'` và `send_paused = 0`.
   4. Nhóm `scheduled_opt_out = 0`.
   5. Không trong giờ yên lặng của tài khoản (`quiet_start`–`quiet_end`, mặc định 21:00–08:00); nếu đang yên lặng thì dời tới `quiet_end` + lệch ngẫu nhiên.
   6. `accountSendsToday(...) < daily_send_cap`; nếu đủ cap thì dời sang ngày hợp lệ kế tiếp. Trước khi dùng, sửa `accountSendsToday` trong `dispatcher.ts` để đếm `status IN ('pending','claimed','done') AND COALESCE(claimed_at, created_at) >= ?` (lệnh đang chờ khi sidecar tắt cũng tính vào cap) và thêm test cho trường hợp đó.
   Qua hết → lệnh `send_zalo` (`threadKind = 'group'`, `dedupe_key = 'schedule:' + id + ':' + <ngày>`), cập nhật `last_run_at`, tính `next_run_at` mới.
6. Sự kiện `account_status = 'error'` từ sidecar → `send_paused = 1` và lệnh `send_lark` cảnh báo `Tài khoản <tên> lỗi kết nối, đã tạm dừng gửi`. Bật lại gửi là thao tác tay của admin.

## Files to Create / Modify

- Create: `apps/crm/migrations/0016_group_controls.sql` (`ALTER TABLE inbox_setting ADD COLUMN scheduled_sends_enabled INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_sends_enabled IN (0,1));` và `ALTER TABLE group_schedule ADD COLUMN last_skip_reason TEXT;`)
- Create: `apps/crm/src/worker/inbox/group-schedules.ts` (`computeNextRun`, `saveSchedule`, `submitSchedule`, `approveSchedule`, `pauseSchedule`, `runDueSchedules`)
- Create: `apps/crm/src/worker/inbox/group-summaries.ts` (`enqueueDailyGroupSummaries`, `applyGroupSummaryResult`)
- Modify: `apps/crm/src/worker/inbox/dispatcher.ts` (`accountSendsToday` theo quy tắc 5.6) và `apps/crm/test/inbox-dispatcher.test.ts`
- Create: `apps/crm/src/web/pages/zalo-groups.tsx`
- Create: `apps/crm/test/inbox-groups.test.ts`
- Modify: `apps/crm/src/worker/inbox/scheduled.ts` (mỗi phút gọi `runDueSchedules`; `0 14 * * *` gọi `enqueueDailyGroupSummaries`)
- Modify: `apps/crm/src/worker/inbox/bridge-routes.ts` (kết quả `purpose='group_summary'`)
- Modify: `apps/crm/src/worker/inbox/ingest.ts` (quy tắc 6)
- Modify: `apps/crm/src/worker/inbox/inbox-routes.ts` (`GET /inbox/groups`, `PATCH /inbox/groups/:id` cho `summary_enabled`/`scheduled_opt_out`, CRUD + `submit`/`approve`/`pause` cho `/inbox/group-schedules`; `PUT /inbox/settings` nhận thêm `scheduledSendsEnabled` chỉ cho `admin`)
- Modify: `apps/crm/src/web/router.tsx`, `apps/crm/src/web/components/layout.tsx` (mục "Nhóm Zalo"), `apps/crm/src/web/api.ts`

## Tasks

### Task 8.1 — Migration

- Verify: `cd apps/crm && npx wrangler d1 migrations apply abm-crm-eval --local` exit 0 và in `0016_group_controls.sql`.

### Task 8.2 — Lịch và chạy lịch

- Target files: `group-schedules.ts`, `scheduled.ts`.
- Steps: hiện thực quy tắc 3–5. `computeNextRun(mask, timeOfDay, from, random)` nhận hàm `random` để test được; trả ISO UTC.
- Verify: Task 8.5.

### Task 8.3 — Tóm tắt

- Target files: `group-summaries.ts`, `scheduled.ts`, `bridge-routes.ts`.
- Steps: hiện thực quy tắc 2.
- Verify: Task 8.5.

### Task 8.4 — Cảnh báo lỗi tài khoản

- Target files: `ingest.ts`.
- Steps: hiện thực quy tắc 6; dedupe lệnh Lark theo `'account-error:' + accountId + ':' + <giờ>`.
- Verify: Task 8.5.

### Task 8.5 — Test

- Target files: `apps/crm/test/inbox-groups.test.ts`.
- Steps:
  1. `computeNextRun` mask chỉ Thứ Hai, `09:00`, từ Chủ nhật 10:00 giờ VN, `random = () => 0` → Thứ Hai 02:00 UTC.
  2. Lịch `draft` không chạy; người tạo tự duyệt → 403; leader duyệt → `active`.
  3. `scheduled_sends_enabled = 0` → không có lệnh gửi, `last_skip_reason = 'feature_off'`, `next_run_at` sang lần kế tiếp.
  4. Bật tính năng, đủ điều kiện → một lệnh `send_zalo` nhóm; chạy lại cùng phút → không thêm.
  5. Cap = 1 và đã có một lệnh gửi hôm nay → không gửi, `next_run_at` sang ngày sau.
  6. Giờ yên lặng → `next_run_at` dời tới `quiet_end`.
  7. `scheduled_opt_out = 1` → không gửi.
  8. Sửa nội dung lịch `active` → `pending_approval`.
  9. Cron `0 14 * * *` với một nhóm có tin hôm nay → một lệnh `group_summary`; nhóm không có tin → không có lệnh. Kết quả → lệnh `send_lark` chứa tên nhóm.
  10. Sự kiện `account_status: error` → `send_paused = 1` và một lệnh Lark.
- Verify: `pnpm -F @abm/crm test -- inbox-groups` exit 0.

### Task 8.6 — UI

- Target files: `apps/crm/src/web/pages/zalo-groups.tsx` và các file web khác ở mục Files.
- Steps: danh sách nhóm theo tài khoản; mở nhóm dùng lại `inbox-thread.tsx`; công tắc "Tóm tắt hằng ngày", "Không nhận tin định kỳ"; bảng lịch với trạng thái, nút gửi duyệt/duyệt/tạm dừng; banner đỏ khi `scheduled_sends_enabled = 0` ghi "Tin định kỳ đang tắt toàn hệ thống (chờ kết quả pilot)".
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 8.7 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `typecheck`, `build`; commit `feat(crm): add zalo group summaries and guarded scheduled messages`.
- Verify: ba lệnh exit 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
