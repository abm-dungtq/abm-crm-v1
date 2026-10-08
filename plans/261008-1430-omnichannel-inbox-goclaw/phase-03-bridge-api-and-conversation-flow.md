---
phase: 3
title: "API sidecar và luồng hội thoại trong Worker"
status: completed
priority: P1
effort: "2d"
dependencies: [2]
---

# Phase 03: API sidecar và luồng hội thoại trong Worker

## Goal

Worker nhận sự kiện từ sidecar có HMAC, lưu tin không trùng, quyết định chế độ, tạo lệnh gọi GoClaw và gửi tin, xử lý marker handoff, cho nhân viên gửi tin và đổi chế độ, gửi thông báo Lark vào nhóm.

## Quy tắc nghiệp vụ (executor không được đổi)

1. Bot chỉ được trả lời khi cả bốn điều kiện đúng: `customer_bot_switch.enabled = 0`, `channel_account.bot_enabled = 1`, `conversation.kind = 'direct'`, `conversation.mode = 'ai'`. Bot **không** trả lời trong nhóm.
2. Tin khách mới ở chế độ `ai`: chạy `UPDATE channel_command SET payload_json = ?, next_run_at = ? WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending' AND json_extract(payload_json,'$.purpose') = 'reply'`; nếu đổi 1 dòng thì đã nối text vào `payload.text` (xuống dòng) và đặt lại `next_run_at = now + 8 giây`; nếu chưa có thì tạo lệnh mới với `next_run_at = now + 8 giây`, `dedupe_key = 'completion:' + message.id`.
3. `payload` của `run_completion`: `{ agentKey, userId, text, conversationId, purpose: 'reply' }`. Nếu `staff_context_pending` khác rỗng thì `text = '[Nhân viên đã trao đổi: ' + staff_context_pending + ']\n' + text` và xoá `staff_context_pending`.
4. Sự kiện `fromSelf` **không chèn dòng mới** khi là echo của tin hệ thống đã gửi. Là echo khi: (a) có `commandId` → tìm `message` theo `channel_command.payload.messageId`, gán `external_msg_id` nếu còn trống, `status='sent'`; hoặc (b) không có `commandId` nhưng trong cùng hội thoại có tin `out` `status IN ('pending','sent')` tạo trong 120 giây gần nhất mà `body` chứa nguyên văn `text` của sự kiện (đoạn cắt 2000 ký tự cũng khớp) → coi là echo của tin đó. Không phải echo → tin `sender_kind='staff_phone'`, chuyển `mode='human'`, cập nhật `last_staff_reply_at`, nối text vào `staff_context_pending` (giữ tối đa 1500 ký tự cuối). Giữ nguyên `assignee_user_id`.
4b. Khi hội thoại đang `human` hoặc `paused`: tin `staff_web` và tin khách cũng được nối vào `staff_context_pending` dạng `Nhân viên: ...` / `Khách: ...` (giữ tối đa 1500 ký tự cuối), để khi Trả lại AI bot biết đã trao đổi gì.
5. Kết quả `run_completion` `purpose='reply'`: tìm dòng marker `^\[HANDOFF:\s*(.+?)\]\s*$` (cờ `m`), bỏ dòng đó khỏi text. Nếu hội thoại không còn `mode='ai'` thì lưu text thành tin `sender_kind='system'` có tiền tố `[Bot trả lời bị huỷ vì đã chuyển người] ` và không gửi. Ngược lại, nếu text còn nội dung thì tạo tin `out` `sender_kind='bot'` `status='pending'` và lệnh `send_zalo` (hoặc `send_messenger` nếu `channel='facebook'`). Nếu có marker thì gọi `handoff(db, env, conversationId, reason)`.
6. `handoff`: `mode='human'`, `handoff_reason`, tạo lệnh `send_lark` `target='worker'` với text `Handoff: <display_name> (<tên tài khoản>) – <lý do> – <APP_URL>/inbox/<id>`. Phase 06 bổ sung chia người vào hàm này.
7. Nhân viên gửi tin từ web: tạo tin `out` `sender_kind='staff_web'` `sent_by_user_id`, lệnh gửi tương ứng; nếu `mode='ai'` thì chuyển `human` và nếu chưa có người được giao thì giao cho chính nhân viên đó.
8. Quyền: xem Inbox cho role `sale`, `leader`, `head`, `director`, `admin`. Quản lý tài khoản kênh chỉ `admin`.

## Files to Create / Modify

- Create: `apps/crm/src/worker/inbox/bridge-auth.ts` (middleware HMAC)
- Create: `apps/crm/src/worker/inbox/bridge-routes.ts` (`/events`, `/commands`, `/commands/:id/result`)
- Create: `apps/crm/src/worker/inbox/ingest.ts` (xử lý sự kiện)
- Create: `apps/crm/src/worker/inbox/conversation-flow.ts` (quy tắc 1–7: `scheduleCompletion`, `applyCompletionResult`, `handoff`, `staffSend`, `setMode`)
- Create: `apps/crm/src/worker/inbox/worker-commands.ts` (`processWorkerCommands(env)`: xử lý `send_lark`; phase 09 thêm `send_messenger`)
- Create: `apps/crm/src/worker/inbox/inbox-routes.ts` (API cho web)
- Create: `apps/crm/test/inbox-bridge.test.ts`, `apps/crm/test/inbox-flow.test.ts`
- Modify: `apps/crm/src/worker/lark.ts` (thêm `sendToChat(env, chatId, text)` dùng `receive_id_type=chat_id`)
- Modify: `apps/crm/src/worker/index.ts` (mount `/bridge` trước `originGuard`; mount `/inbox` sau `requireActor`)
- Modify: `apps/crm/src/worker/env.ts` (thêm `APP_URL` optional nếu chưa có)

## Tasks

### Task 3.1 — Middleware HMAC

- Target files: `apps/crm/src/worker/inbox/bridge-auth.ts`.
- Steps:
  1. Đọc `X-Bridge-Timestamp` và `X-Bridge-Signature`. Thiếu, hoặc `|now - timestamp| > 300` giây, hoặc thiếu `BRIDGE_SECRET` → 401 `UNAUTHENTICATED`.
  2. Tính HMAC-SHA256 bằng `crypto.subtle` trên `timestamp + '.' + rawBody`; so sánh hằng thời gian (so từng byte, không dừng sớm).
  3. Đặt body đã đọc vào context để route không đọc lại stream.
- Verify: Task 3.7.

### Task 3.2 — Route sidecar

- Target files: `apps/crm/src/worker/inbox/bridge-routes.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. `POST /events`: parse `{ events }` bằng `bridgeEventSchema`; sai → 422; gọi `ingestEvents`; trả `{ ok: true, data: { accepted } }`.
  2. `GET /commands?wait=20`: lặp tối đa `wait` giây (giới hạn 25), mỗi 1 giây gọi `claimCommands(db, 'bridge', 20)`; có lệnh thì trả ngay; hết giờ trả mảng rỗng. Trước khi trả lệnh `send_zalo`/`send_messenger`, nếu tài khoản `send_paused = 1` thì `failCommand` với lỗi `ACCOUNT_PAUSED` và không trả lệnh đó.
  3. `POST /commands/:id/result`: parse `bridgeCommandResultSchema`; `ok` → `completeCommand(db, id, body.attempts, ...)`; trả `false` thì trả 200 `{ ignored: true }` và **không** xử lý gì thêm; trả `true` thì gọi xử lý theo `kind` (`run_completion` → `applyCompletionResult`; `send_zalo` → tìm tin theo `payload.messageId`, cập nhật `status='sent'`, `external_msg_id`); không `ok` → `failCommand(db, id, body.attempts, ...)`; khi lệnh gửi chuyển `failed` thì tin `status='failed'`.
  4. Trong `index.ts`, ngay sau dòng `app.route('/mcp', mcpRoutes);`, thêm `app.route('/bridge', bridgeRoutes);` với chú thích một dòng giống dòng của `/mcp`.
- Verify: Task 3.7.

### Task 3.3 — Ingest

- Target files: `apps/crm/src/worker/inbox/ingest.ts`.
- Steps:
  1. `message`: tìm `channel_account` theo (`channel='zalo'`, `external_id = accountExternalId`); không thấy → bỏ qua và đếm `rejected`. Upsert `conversation` theo (`channel_account_id`, `threadId`) với `kind`, `display_name`.
  2. Nếu `fromSelf`: áp quy tắc 4 trước; là echo thì dừng (không chèn). Ngược lại chèn `message` bằng `INSERT ... ON CONFLICT(conversation_id, external_msg_id) DO NOTHING`; `meta.changes = 0` (trùng) → dừng xử lý sự kiện này.
  3. Với tin `staff_phone` áp phần còn lại của quy tắc 4; với tin khách: `direction='in'`, `sender_kind='customer'`, cập nhật `last_inbound_at`, `last_message_at`; gọi `scheduleCompletion` nếu quy tắc 1 đúng.
  4. `account_status`: tìm theo `accountId`; cập nhật `status`, `last_seen_at`; `connected` thì ghi `external_id = accountExternalId` và xoá `qr_image`.
  5. `qr`: lưu `qr_image`, `qr_expires_at`, `status='qr_pending'`.
  6. `group_list`: upsert `conversation` `kind='group'` cho từng nhóm.
- Verify: Task 3.7.

### Task 3.4 — Luồng hội thoại

- Target files: `apps/crm/src/worker/inbox/conversation-flow.ts`.
- Steps: hiện thực đúng quy tắc 1–7 thành các hàm export `scheduleCompletion`, `applyCompletionResult`, `handoff`, `staffSend`, `setMode`. Ghi `audit_log` cho `setMode`, `handoff`, `staffSend` theo cách các lệnh hiện có ghi audit (đọc `apps/crm/src/worker/commands.ts` để làm theo).
- Verify: Task 3.8.

### Task 3.5 — Lark vào nhóm và xử lý lệnh worker

- Target files: `apps/crm/src/worker/lark.ts`, `apps/crm/src/worker/inbox/worker-commands.ts`.
- Steps:
  1. Thêm `sendToChat(env, chatId, text)` bên cạnh `sendText`, cùng cách lấy token.
  2. `processWorkerCommands(env)`: `claimCommands(db, 'worker', 20)`; với `send_lark` gọi `sendToChat(env, env.LARK_INBOX_CHAT_ID, payload.text)`; thành công → `completeCommand`, lỗi → `failCommand`. Thiếu `LARK_INBOX_CHAT_ID` → `failCommand` lỗi `LARK_NOT_CONFIGURED`.
  3. Sau khi tạo lệnh `target='worker'` trong request, gọi `background(c, processWorkerCommands(c.env))`.
- Verify: Task 3.8 (mock `fetch` như `approval-notify.test.ts`).

### Task 3.6 — API cho web

- Target files: `apps/crm/src/worker/inbox/inbox-routes.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. `GET /inbox/conversations?mode=&assignee=&account=&kind=&q=&before=`: 50 dòng, sắp `last_message_at DESC`, kèm tên tài khoản, tên người được giao, tin cuối.
  2. `GET /inbox/conversations/:id` và `GET /inbox/conversations/:id/messages?after=<created_at>` (tối đa 200).
  3. `POST /inbox/conversations/:id/messages` `{ text }` (1–2000 ký tự) → `staffSend`.
  4. `POST /inbox/conversations/:id/mode` `{ mode }` → `setMode`; `human` khi chưa có người được giao thì giao cho người bấm.
  5. `GET /inbox/accounts`; admin: `POST /inbox/accounts` `{ displayName, agentKey }` (`channel='zalo'`), `PATCH /inbox/accounts/:id` (`botEnabled`, `sendPaused`, `dailySendCap`, `quietStart`, `quietEnd`, `agentKey`), `POST /inbox/accounts/:id/connect` (tạo lệnh `zalo_login`, `dedupe_key='login:'+id+':'+phút hiện tại`), `POST /inbox/accounts/:id/disconnect` (lệnh `zalo_logout`).
  6. Admin: `GET/PUT /inbox/customer-bot-switch`.
  7. Role không hợp lệ → 403 theo thông điệp `forbidden` sẵn có. Mount trong `index.ts` sau `app.route('/admin', adminRoutes);`: `app.route('/inbox', inboxRoutes);`.
- Verify: Task 3.8.

### Task 3.7 — Test sidecar API

- Target files: `apps/crm/test/inbox-bridge.test.ts`.
- Steps: test:
  1. Chữ ký sai → 401; timestamp lệch 301 giây → 401; đúng → 200.
  2. Gửi cùng sự kiện `message` hai lần → chỉ một dòng `message`.
  2b. Kết quả lệnh với `attempts` cũ → 200 `{ ignored: true }`, không tạo tin.
  2c. `account_status: connected` với `accountExternalId` → `channel_account.external_id` được ghi; tin sau đó với `accountExternalId` đó được nhận.
  3. Long-poll `wait=1` không có lệnh → mảng rỗng.
  4. Lệnh `send_zalo` của tài khoản `send_paused=1` không được trả về.
- Verify: `pnpm -F @abm/crm test -- inbox-bridge` exit 0.

### Task 3.8 — Test luồng

- Target files: `apps/crm/test/inbox-flow.test.ts`.
- Steps: test từng quy tắc:
  1. Tin khách ở `ai` → một `run_completion` với `next_run_at` sau 8 giây; tin thứ hai trước khi claim → vẫn một lệnh, text nối.
  2. `customer_bot_switch.enabled=1` → không có lệnh; nhóm → không có lệnh.
  3. `fromSelf` không `commandId`, text lạ → `mode='human'`, `sender_kind='staff_phone'`, `staff_context_pending` có text.
  3b. Bot vừa có tin `out` "Xin chào" (60 giây trước); sự kiện `fromSelf` không `commandId` text "Xin chào" → không thêm tin, `mode` vẫn `ai`.
  3c. `fromSelf` có `commandId` → không thêm tin, tin `out` có `external_msg_id`.
  4. Kết quả có marker → marker không có trong tin gửi, `mode='human'`, có lệnh `send_lark`.
  5. Kết quả đến khi `mode='human'` → không có lệnh `send_zalo`, có tin `system`.
  6. Trả lại `ai` rồi tin khách mới → `payload.text` bắt đầu bằng `[Nhân viên đã trao đổi:`.
  7. `staffSend` ở `ai` → `human`, người gửi thành người được giao.
  8. Role `teacher` gọi `GET /inbox/conversations` → 403.
- Verify: `pnpm -F @abm/crm test -- inbox-flow` exit 0.

### Task 3.9 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`; commit `feat(crm): add inbox bridge api and conversation flow`.
- Verify: cả hai exit 0.

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
