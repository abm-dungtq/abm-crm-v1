---
phase: 5
title: "Giao diện Inbox và tài khoản kênh"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 05: Giao diện Inbox và tài khoản kênh

## Goal

Nhân viên có trang Inbox ba cột (danh sách hội thoại, khung chat, bảng điều khiển) cập nhật bằng polling; admin có trang Tài khoản kênh để thêm số Zalo, quét QR, bật/tắt bot và gửi.

## Bố cục (khớp mockup trong brief HTML của GoClaw)

- Cột trái: lọc theo tài khoản, chế độ, "Của tôi"/"Chưa giao"/"Tất cả"; mỗi dòng hiện tên khách, nhãn kênh (`Zalo · <tên tài khoản>` hoặc `Fanpage`), chế độ, tên người được giao, giờ tin cuối.
- Cột giữa: tin nhắn; bong bóng khách bên trái; bot, nhân viên web, nhân viên điện thoại bên phải với nhãn `Bot`, `<tên nhân viên>`, `Điện thoại`; tin `system` ở giữa màu nhạt; tin `failed` có chữ "Gửi lỗi".
- Cột phải: người được giao, chế độ (badge), lý do handoff, nút **Tiếp quản**, **Trả lại AI**, **Tạm dừng**; phase 06 thêm chọn người giao; phase 07 thêm thẻ lead chờ phân loại.
- Ô soạn tin: tối đa 2000 ký tự, Enter gửi, Shift+Enter xuống dòng.
- Polling: danh sách 5 giây; hội thoại đang mở 3 giây với `after=<created_at cuối>`; dừng khi tab ẩn (`document.visibilityState`).

## Files to Create / Modify

- Create: `apps/crm/src/web/pages/inbox.tsx`
- Create: `apps/crm/src/web/pages/channel-accounts.tsx`
- Create: `apps/crm/src/web/components/inbox-thread.tsx`
- Modify: `apps/crm/src/web/router.tsx` (route `/inbox`, `/inbox/$conversationId`, `/channel-accounts`)
- Modify: `apps/crm/src/web/components/layout.tsx` (mục nav "Inbox" cho `sale`, `leader`, `head`, `director`, `admin`; "Tài khoản kênh" cho `admin`)
- Modify: `apps/crm/src/web/api.ts` (hàm gọi API inbox)
- Modify: `apps/crm/src/web/types.ts` (kiểu dữ liệu inbox)
- Modify: `apps/crm/src/web/styles.css` (lớp cho ba cột và bong bóng, dùng biến màu sẵn có)

## Tasks

### Task 5.1 — Đọc mẫu UI

- Target files: `apps/crm/src/web/pages/approvals.tsx`, `apps/crm/src/web/pages/lead-detail.tsx`, `apps/crm/src/web/components/ui.tsx`, `apps/crm/src/web/api.ts`.
- Steps: ghi lại cách dùng TanStack Query (`useQuery`, `refetchInterval`), cách gọi lệnh, thành phần UI dùng chung, biến màu CSS.
- Verify: no verification needed.

### Task 5.2 — API client và kiểu

- Target files: `apps/crm/src/web/api.ts`, `apps/crm/src/web/types.ts`.
- Steps: thêm hàm cho mọi route của Task 3.6 (`listConversations`, `getConversation`, `listMessages`, `sendMessage`, `setMode`, `listAccounts`, `createAccount`, `updateAccount`, `connectAccount`, `disconnectAccount`, `getCustomerBotSwitch`, `setCustomerBotSwitch`) theo đúng cách các hàm hiện có xử lý `{ ok, data, error }`.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 5.3 — Trang Inbox

- Target files: `apps/crm/src/web/pages/inbox.tsx`, `apps/crm/src/web/components/inbox-thread.tsx`, `apps/crm/src/web/router.tsx`, `apps/crm/src/web/styles.css`.
- Steps: dựng bố cục ở trên; dưới 900px chuyển thành một cột (danh sách → bấm vào mở chat, có nút quay lại). Nút và ô nhập có `aria-label`. Gửi tin xong thì làm mới danh sách tin ngay.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 5.4 — Trang Tài khoản kênh

- Target files: `apps/crm/src/web/pages/channel-accounts.tsx`.
- Steps:
  1. Bảng tài khoản: tên, kênh, trạng thái (badge), lần thấy cuối, agent GoClaw, bot bật/tắt, gửi tạm dừng, giới hạn/ngày, giờ yên lặng.
  2. Form thêm số Zalo (tên hiển thị, `agentKey`).
  3. Nút "Kết nối" gọi `connectAccount`, sau đó poll 2 giây; khi `status='qr_pending'` hiện ảnh `qr_image` và đồng hồ hết hạn; khi `connected` thì ẩn QR.
  4. Công tắc "Tắt bot khách hàng toàn hệ thống" (`customer_bot_switch`) có hộp xác nhận.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 5.5 — Nav

- Target files: `apps/crm/src/web/components/layout.tsx`.
- Steps: thêm hai mục vào mảng `nav` với `roles` như trên.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 5.6 — Kiểm tra trên trình duyệt (local)

- Steps:
  1. `pnpm -F @abm/crm db:migrate:local`, `pnpm -F @abm/crm db:seed:local`.
  2. Chèn dữ liệu thử bằng `wrangler d1 execute abm-crm-eval --local --command "<INSERT channel_account, conversation, message>"` (dùng giá trị giả, không dùng số thật).
  3. Chạy `pnpm -F @abm/crm dev:api` và `pnpm -F @abm/crm dev`; mở `/inbox` bằng user demo role `sale`; gửi một tin; bấm Tiếp quản và Trả lại AI.
  4. Dừng cả hai tiến trình dev khi xong.
- Success criteria: danh sách hiện hội thoại thử; gửi tin tạo lệnh `send_zalo` trong D1 local; chế độ đổi đúng.
- Verify: `npx wrangler d1 execute abm-crm-eval --local --command "SELECT kind, status FROM channel_command WHERE kind = 'send_zalo' ORDER BY created_at DESC LIMIT 1"` in `send_zalo` và `pending`.

### Task 5.7 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`, `pnpm -F @abm/crm build`; commit `feat(crm): add inbox and channel account pages`.
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
