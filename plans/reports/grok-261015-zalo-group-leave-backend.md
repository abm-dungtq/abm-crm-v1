# Phase B: rời nhóm Zalo (Worker + bridge)

Plan: `plans/261015-1300-zalo-group-leave/plan.md`. Pha này chỉ Worker, D1 migration, contracts và zalo-bridge. Không sửa `apps/crm/src/web/**` (`ZaloGroup` vẫn nằm ở `apps/crm/src/web/types.ts`). Không chạy `wrangler`, không apply migration remote, không đụng VPS / GoClaw / D1 remote, không bật server, không restart bridge, không commit.

## Hợp đồng đã dựng

`POST /api/inbox/groups/:id/leave` (route Hono `/groups/:id/leave`).

- Chỉ `MANAGER_ROLES` (trưởng nhóm, trưởng phòng, giám đốc, quản trị). Sale bị `403` `FORBIDDEN`, message `Chỉ trưởng nhóm, trưởng phòng, giám đốc hoặc quản trị được rời nhóm`. Kiểm tra vai trò trước khi tìm nhóm, nên sale không dò được nhóm tổ chức khác.
- Nhóm không thuộc tổ chức của người gọi, hoặc không phải nhóm: `404`.
- `left_at` đã có: `409` `CONFLICT`, message `Nhóm đã rời`.
- `leave_requested_at` đã có và nhóm chưa rời: trả lại đúng timestamp đó, không tạo lệnh mới, không ghi audit lần hai.
- Lần đầu: ghi `leave_requested_at`, xếp lệnh bridge `leave_zalo_group`. Payload đúng `{ threadId }`. `channelAccountId` là tài khoản của nhóm. Dedupe key `leave:<conversationId>:<leaveRequestedAt>`.
- Audit `inbox.leaveGroup`, entity `conversation`. `after_json` có `leaveRequestedAt` và `requestedByName` (tên hiển thị, rỗng thì `không rõ`). Tên không nằm trong payload gửi bridge.
- Thành công: `{ ok: true, data: { id, leaveRequestedAt } }`.

Kết quả `POST /api/bridge/commands/:id/result`:

- Thành công, và claim vẫn sở hữu lệnh: `left_at = now`, xóa `leave_requested_at`, tắt `bot_reply_enabled` và `summary_enabled`, `scheduled_opt_out = 1`, lịch `active` của nhóm chuyển `paused` và `next_run_at` null. Không xóa `group_agent_key` hay `bot_paused_until`.
- Hủy lệnh còn `pending` hoặc `claimed` sẽ gửi vào nhóm: `send_zalo`, `send_messenger`, `send_zalo_oa`, và `run_completion` purpose `reply`. Mã `LEFT_GROUP`. Tin `pending` gắn `messageId` chuyển `failed`. `send_lark` và `run_completion` purpose `group_summary` / `extract` giữ nguyên.
- Ghi một tin hệ thống `Đã rời nhóm (do <tên>)`, `sender_kind = system`, `status = sent`. Tên lấy từ audit mới nhất.
- Thất bại cuối: `leave_zalo_group` không retry (cùng nhóm với login/logout). Lần báo lỗi đầu tiên xóa `leave_requested_at` và ghi `Rời nhóm không thành công: <mã>`. Nhóm chưa bị đánh dấu đã rời. Staff bấm lại thì tạo lệnh mới vì dedupe key có timestamp.

Chặn gửi vào nhóm đã rời:

- `staffSend` trả `409` `CONFLICT` `Nhóm đã rời` khi nhóm có `left_at`. Không tạo tin và không xếp `send_zalo`.
- `scheduleGroupReply` / `groupBotMayReply` bỏ qua khi `left_at` còn.
- `runDueSchedules` và `enqueueDailyGroupSummaries` thêm `AND c.left_at IS NULL`. Không thêm `SkipReason` mới.
- Poll lệnh bridge: `send_zalo` đã claim mà hội thoại có `left_at` bị `dropBotSend` với `LEFT_GROUP`, không trả về cho bridge.

Vào lại nhóm: một tin nhóm mới được lưu (không phải echo, không phải `msgId` trùng) khi hội thoại đang có `left_at` thì xóa `left_at` và `leave_requested_at`. Không bật lại bot, tóm tắt hay lịch. Chính tin đó không xếp trả lời bot. Tin sau đó theo cài đặt hiện tại.

Danh sách nhóm: `GROUP_SELECT` / `presentGroup` thêm `leftAt` và `leaveRequestedAt` (TEXT, có thể null). Thứ tự `ORDER BY a.display_name, c.display_name, c.id` giữ nguyên.

Bridge:

- Runner nhận `leave_zalo_group`, zod `{ threadId: string }`. Thiếu payload hoặc thiếu `channelAccountId`: `INVALID_PAYLOAD`.
- `AccountManager.leaveGroup` ném `ACCOUNT_NOT_CONNECTED` khi không có session.
- `ZcaSession.leaveGroup` gọi `api.leaveGroup(threadId, true)`. Promise resolve là thành công, kể cả `memberError`. Lỗi throw đi theo `errorCode` như lệnh khác.

Migration `0023_zalo_group_leave.sql`: thêm `conversation.left_at` và `conversation.leave_requested_at`, rồi dựng lại `channel_command` để CHECK kind có `leave_zalo_group` (SQLite không sửa CHECK tại chỗ; không bảng nào tham chiếu `channel_command`). `COMMAND_KINDS` trong `@abm/contracts` có thêm kind này để bridge nhận lệnh khi poll. Migration chỉ nằm trong repo. Chưa apply remote.

## File

- `apps/crm/migrations/0023_zalo_group_leave.sql`
- `apps/crm/src/worker/inbox/group-leave.ts` (mới)
- `apps/crm/src/worker/inbox/inbox-routes.ts`
- `apps/crm/src/worker/inbox/bridge-routes.ts`
- `apps/crm/src/worker/inbox/conversation-flow.ts`
- `apps/crm/src/worker/inbox/group-schedules.ts`
- `apps/crm/src/worker/inbox/group-summaries.ts`
- `apps/crm/src/worker/inbox/ingest.ts`
- `packages/contracts/src/index.ts`
- `apps/zalo-bridge/src/command-runner.ts`
- `apps/zalo-bridge/src/zalo-client.ts`
- `apps/zalo-bridge/src/account-manager.ts`
- `apps/crm/test/inbox-group-leave.test.ts` (mới)
- `apps/zalo-bridge/test/command-runner.test.ts`
- `apps/zalo-bridge/test/zalo-group-signals.test.ts`
- `apps/zalo-bridge/test/account-manager.test.ts`

## Test

Worker (`inbox-group-leave.test.ts`, 8 test): sale `403` và không ghi timestamp; leader tạo một lệnh, bấm lại không tạo lệnh thứ hai; trưởng phòng, giám đốc và quản trị được phép; nhóm tổ chức khác và hội thoại direct là `404`; đã rời là `409`; kết quả thành công đặt `left_at`, tắt bot và tóm tắt, tạm dừng lịch, hủy send đang chờ với `LEFT_GROUP`, giữ Lark và tóm tắt, ghi đúng câu hệ thống; kết quả lỗi xóa request và cho bấm lại; staff gửi vào nhóm đã rời là `409`; poll bridge không trả send của nhóm đã rời; lịch và tóm tắt bỏ qua nhóm đã rời; tin mới xóa trạng thái rời, không xếp bot cho chính tin đó, `msgId` trùng và echo không xóa; danh sách trả `leftAt` / `leaveRequestedAt`.

Bridge: runner gọi `accounts.leaveGroup(accountId, threadId)` và báo ok; payload rỗng hoặc không có account là `INVALID_PAYLOAD`; `CodedError('ACCOUNT_NOT_CONNECTED')` được báo đúng mã; `ZcaSession.leaveGroup` gọi `api.leaveGroup(id, true)`; `AccountManager` ủy quyền cho session và ném `ACCOUNT_NOT_CONNECTED` khi đã logout.

## Verify

Chạy tại `D:\TQD\CRM`, 2026-10-15. Cả bốn lệnh exit 0. `tsc` web cũng exit 0 trong lệnh CRM; không có lỗi web cần ghi nhận, và không sửa file web.

- `pnpm -F @abm/crm typecheck` — exit 0
- `pnpm -F @abm/crm test` — exit 0, 563 passed, 2 skipped
- `pnpm -F @abm/zalo-bridge typecheck` — exit 0
- `pnpm -F @abm/zalo-bridge test` — exit 0, 114 passed

```
Status: DONE
Summary: Worker và bridge đã cho quản lý rời nhóm Zalo, ghi Đã rời, chặn gửi vào nhóm đó, và xóa trạng thái rời khi có tin mới. Bốn lệnh verify đều exit 0.
```
