---
phase: 03
title: "Liên kết Lark theo email"
status: completed
dependsOn: [02]
---

# Phase 03 — Liên kết Lark theo email

## Goal

Admin bấm "Liên kết Lark": CRM hỏi Lark `open_id` theo email của từng người đang hoạt động, rồi lưu `lark_open_id` và `lark_link_status` (`linked`, `unmatched` hoặc `error`). Bot GoClaw sau này dùng `open_id` này để nhận ra người nhắn.

## Bối cảnh cần biết

- Shell: dùng PowerShell.
- App Lark phải là **cùng app** mà GoClaw dùng (bot DungTQ_Agent), vì `open_id` khác nhau giữa các app. App ID và App Secret nằm ở `D:\Goclaw\data\lark-app.local.txt`. **Không mở, không in file này.** User tự đặt secret bằng `wrangler secret put` ở phase 05.
- Domain Lark quốc tế: `https://open.larksuite.com`.
- API (đối chiếu tài liệu Lark trước khi viết, vì có thể đã đổi):
  - Lấy token: `POST /open-apis/auth/v3/tenant_access_token/internal`, body `{ app_id, app_secret }`, trả `tenant_access_token`, `expire`.
  - Tra ID: `POST /open-apis/contact/v3/users/batch_get_id?user_id_type=open_id`, header `Authorization: Bearer <tenant token>`, body `{ emails: [...] }` (tối đa 50 email mỗi lần), trả `data.user_list[]` gồm `email` và `user_id` (rỗng khi không tìm thấy).
- Quyền app cần có (user bật ở phase 05): tra ID người dùng theo email (`contact:user.id:readonly`) và phạm vi dữ liệu danh bạ gồm toàn công ty. Báo cáo kênh Lark ghi nhận hiện app thiếu phạm vi danh bạ (`no dept authority`).

## Files

| Path | Action |
|---|---|
| `apps/crm/src/worker/lark.ts` | create |
| `apps/crm/src/worker/admin-routes.ts` | modify |
| `apps/crm/src/worker/env.ts` | modify (`LARK_APP_ID?`, `LARK_APP_SECRET?`) |
| `apps/crm/test/lark-link.test.ts` | create |

## Tasks

### Task 3.1 — Client Lark `lark.ts`
- Goal: đổi danh sách email thành map email → open_id.
- Target: `apps/crm/src/worker/lark.ts`, export `lookupOpenIds(env, emails): Promise<Map<string, string | null>>` và class `LarkError`.
- Steps:
  1. Thiếu `LARK_APP_ID` hoặc `LARK_APP_SECRET` → ném `LarkError('Chưa cấu hình app Lark')`.
  2. Lấy tenant token (không cache giữa các request; số lần gọi ít). Luôn gọi `fetch(...)` toàn cục tại thời điểm chạy, không lưu tham chiếu `const f = fetch` ở cấp module, để test thay được bằng `vi.spyOn(globalThis, 'fetch')`.
  3. Chia email thành lô 50, gọi `batch_get_id` từng lô. HTTP khác 200 hoặc `code !== 0` → ném `LarkError` với message có `code` và `msg` của Lark, **không** kèm token hay secret.
  4. Map chuẩn hoá email về chữ thường; `user_id` rỗng → `null`.
- Verify: no verification needed (Task 3.3).

### Task 3.2 — Endpoint liên kết
- Goal: `POST /api/admin/lark/link` body `{ userIds?: string[] }`.
- Target: `admin-routes.ts`.
- Steps:
  1. Chỉ Admin. Không có `userIds` → mọi user `status='active'` của tổ chức có `lark_link_status IN ('unlinked','unmatched','error')`. Có `userIds` → chỉ những người đó (dùng để thử lại từng người).
  2. Gọi `lookupOpenIds`. `LarkError` → mọi người trong lô thành `error`, response 200 kèm `message` lỗi.
  3. Kết quả: có open_id → `linked`; `null` → `unmatched`. Một open_id đã gắn cho user khác → `error` với lý do "open_id đã gắn cho người khác".
  4. Ghi bằng `GuardedTx` (`command='linkLark'`), cập nhật `lark_open_id`, `lark_link_status`, `lark_checked_at`; audit chỉ chứa trạng thái trước/sau và open_id.
  5. Response `{ linked, unmatched, error, message? }` (đếm số người).
- Verify: no verification needed (Task 3.3).

### Task 3.3 — Test
- Goal: kiểm ba nhánh mà không gọi Lark thật.
- Target: `apps/crm/test/lark-link.test.ts`.
- Steps:
  1. Thay `globalThis.fetch` bằng `vi.spyOn(globalThis, 'fetch')`, trả response Lark giả theo URL; khôi phục trong `afterEach`. Truyền `LARK_APP_ID`/`LARK_APP_SECRET` giả vào env của `app.fetch`.
  2. Test: email `lan@demo.abm.example` trả `ou_test_lan` → `linked`; các email khác trả rỗng → `unmatched`.
  3. Test: endpoint token trả `code: 99991663` → mọi người `error`, response có message chứa `99991663` và không chứa giá trị secret giả.
  4. Test: thiếu secret → `error` với message "Chưa cấu hình app Lark".
  5. Test: Sale gọi → 403.
  6. Test: đổi email qua `PATCH /api/admin/users/:id` → `lark_link_status = 'unlinked'`, `lark_open_id` NULL.
- Verify: `pnpm -F @abm/crm test` exits 0, output không chứa `failed`; `pnpm -F @abm/crm typecheck` exits 0.

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

## Rollback

Xóa `lark.ts`, test mới; `git checkout` các file đã sửa.
