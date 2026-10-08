---
phase: 6
title: "Chia việc, SLA, cron"
status: pending
priority: P1
effort: "1.5d"
dependencies: [3]
---

# Phase 06: Chia việc, SLA, cron

## Goal

Hội thoại được chia thủ công hoặc tự động lần lượt cho nhân viên đang trực; handoff tự chia; tên nhân viên hiện trên luồng; nhắc Lark khi quá hạn chưa trả lời; Cron Trigger mỗi phút xử lý lệnh `worker` và các việc định kỳ.

## Quy tắc chia (executor không được đổi)

1. Chế độ chia là cấu hình tổ chức `inbox_assign_mode` (`manual` | `round_robin`), lưu ở bảng mới `inbox_setting` (một dòng, `id = 1`), mặc định `manual`.
2. `round_robin`: chọn người trong `inbox_roster` có `on_duty = 1`, `app_user.status = 'active'`, role thuộc (`sale`, `leader`); sắp theo `last_assigned_at` tăng dần (NULL trước), lấy người đầu; cập nhật `last_assigned_at = now`. Không có ai trực → để chưa giao và Lark ghi "chưa có người trực".
3. Handoff: nếu hội thoại đã có người được giao thì giữ; nếu chưa và chế độ `round_robin` thì chia theo quy tắc 2; nếu `manual` thì để chưa giao.
4. Giao thủ công: role `leader`, `head`, `director`, `admin` giao cho bất kỳ nhân viên đang hoạt động; `sale` chỉ tự nhận hội thoại chưa giao.
5. Mỗi lần giao ghi `audit_log` (người giao, người nhận, hội thoại) và tạo lệnh `send_lark` vào nhóm: `Giao <tên KH> cho <tên NV> – <APP_URL>/inbox/<id>`; nếu người nhận có `lark_open_id` thì thêm một lệnh nhắn riêng.
6. SLA: khi hội thoại chuyển `human` hoặc có tin khách mới ở `human`, đặt `sla_due_at = now + inbox_sla_minutes` (mặc định 15, lưu ở `inbox_setting`). Nhân viên gửi tin (web hoặc điện thoại) → `sla_due_at = NULL`. Cron thấy `sla_due_at < now` → tạo `send_lark` nhắc (dedupe theo hội thoại + `sla_due_at`) và đặt `sla_due_at = now + inbox_sla_minutes`.

## Dọn tin gửi bị kẹt

Cron mỗi phút cũng gọi `sweepStuckOutgoing(db, now)` (đặt trong `conversation-flow.ts`): tin `out` `status = 'pending'` tạo trước `now - 15 phút` mà không có `channel_command` nào có `json_extract(payload_json,'$.messageId')` bằng id tin ở trạng thái `pending`/`claimed` → đặt `status = 'failed'`. Thêm một test trong `inbox-scheduled.test.ts` cho trường hợp này.

## Files to Create / Modify

- Create: `apps/crm/migrations/0014_inbox_settings.sql` (`inbox_setting`: `id`, `assign_mode`, `sla_minutes`, `updated_by_user_id`, `updated_at`; chèn dòng mặc định)
- Create: `apps/crm/src/worker/inbox/assignment.ts` (`assignConversation`, `pickRoundRobin`, `autoAssignOnHandoff`)
- Create: `apps/crm/src/worker/inbox/scheduled.ts` (`runScheduled(env, cron)`)
- Create: `apps/crm/test/inbox-assignment.test.ts`, `apps/crm/test/inbox-scheduled.test.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts` (thêm `inbox_setting`, `inbox_roster` vào danh sách xoá; sau đó `INSERT OR IGNORE INTO inbox_setting (id, assign_mode, sla_minutes) VALUES (1, 'manual', 15)`)
- Modify: `apps/crm/src/worker/inbox/conversation-flow.ts` (`handoff` gọi `autoAssignOnHandoff`; đặt/xoá `sla_due_at` theo quy tắc 6)
- Modify: `apps/crm/src/worker/inbox/ingest.ts` (tin `staff_phone` xoá `sla_due_at`; tin khách ở `human` đặt `sla_due_at`)
- Modify: `apps/crm/src/worker/inbox/inbox-routes.ts` (`POST /inbox/conversations/:id/assign`, `GET/PUT /inbox/settings`, `GET/PUT /inbox/roster`)
- Modify: `apps/crm/src/worker/index.ts` (đổi `export default app` thành `export default { fetch: app.fetch, scheduled: (event, env, ctx) => ctx.waitUntil(runScheduled(env, event.cron)) }`)
- Modify: `apps/crm/wrangler.jsonc` (thêm `"triggers": { "crons": ["* * * * *", "0 14 * * *"] }`, chú thích: 14:00 UTC = 21:00 giờ Việt Nam cho tóm tắt nhóm ở phase 08)
- Modify: `apps/crm/src/web/pages/inbox.tsx` (chọn người giao ở cột phải, nút "Nhận"; trang con cài đặt chia việc + danh sách trực cho `leader`/`admin`)

## Tasks

### Task 6.1 — Migration cài đặt

- Steps: viết `0014_inbox_settings.sql` với CHECK `assign_mode IN ('manual','round_robin')`, `sla_minutes BETWEEN 1 AND 1440`; chèn `(1, 'manual', 15)`.
- Verify: `cd apps/crm && npx wrangler d1 migrations apply abm-crm-eval --local` exit 0 và in `0014_inbox_settings.sql`.

### Task 6.2 — Module chia việc

- Target files: `apps/crm/src/worker/inbox/assignment.ts`.
- Steps: hiện thực quy tắc 1–5. `assignConversation(db, actor, conversationId, userId)` kiểm quyền theo quy tắc 4, ghi audit, tạo lệnh Lark. `pickRoundRobin` cập nhật bằng `UPDATE inbox_roster SET last_assigned_at = ? WHERE user_id = ? AND last_assigned_at IS ?` (tham số cuối là giá trị vừa đọc); nếu `meta.changes = 0` thì chọn lại, tối đa 3 lần, để hai lần chọn đồng thời không lấy trùng người.
- Verify: Task 6.5.

### Task 6.3 — Nối vào luồng

- Target files: `conversation-flow.ts`, `ingest.ts`.
- Steps: áp quy tắc 3 trong `handoff`; áp quy tắc 6 ở các chỗ đổi chế độ, tin khách, tin nhân viên.
- Verify: Task 6.5.

### Task 6.4 — Cron

- Target files: `apps/crm/src/worker/inbox/scheduled.ts`, `apps/crm/src/worker/index.ts`, `apps/crm/wrangler.jsonc`.
- Steps:
  1. `runScheduled(env, cron)`: nếu `cron === '* * * * *'` thì gọi `processWorkerCommands(env)` rồi `checkSla(env.DB, now)`. Cron `0 14 * * *` chưa làm gì ở phase này; phase 08 thêm nhánh của nó.
  2. Thay dòng cuối `export default app;` bằng đúng đoạn sau (Hono `app.fetch` là hàm đã gắn sẵn nên các test đang gọi `default.fetch(req, env)` vẫn chạy). **Không sửa file test nào.**

     ```ts
     export default {
       fetch: app.fetch,
       scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runScheduled(env, event.cron)),
     };
     ```
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và toàn bộ `pnpm -F @abm/crm test` vẫn exit 0 sau khi đổi export.

### Task 6.5 — Test

- Target files: `apps/crm/test/inbox-assignment.test.ts`, `apps/crm/test/inbox-scheduled.test.ts`.
- Steps:
  1. Ba người trực, chia 4 lần → thứ tự A, B, C, A.
  2. Người `on_duty = 0` hoặc `status != 'active'` không được chọn.
  3. Handoff khi `manual` → chưa giao; khi `round_robin` → có người, có lệnh Lark chứa tên người.
  4. `sale` giao cho người khác → 403; `sale` tự nhận hội thoại chưa giao → 200.
  5. Hội thoại `human` quá `sla_due_at` → `runScheduled(env, '* * * * *')` tạo một lệnh nhắc; chạy lại ngay → không tạo thêm.
  6. Nhân viên gửi tin → `sla_due_at` NULL.
- Verify: `pnpm -F @abm/crm test -- inbox-assignment inbox-scheduled` exit 0.

### Task 6.6 — UI chia việc

- Target files: `apps/crm/src/web/pages/inbox.tsx`, `apps/crm/src/web/api.ts`.
- Steps: cột phải có ô chọn nhân viên (chỉ hiện với role được giao) và nút "Nhận" cho `sale` khi chưa giao; tên người được giao hiện trên đầu khung chat và ở mỗi dòng danh sách; trang cài đặt nhỏ (đổi `assign_mode`, `sla_minutes`, bật/tắt trực từng người).
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 6.7 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `typecheck`, `build`; commit `feat(crm): add inbox assignment, round robin and sla reminders`.
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
