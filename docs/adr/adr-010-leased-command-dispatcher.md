# ADR-010: Dispatcher lệnh có lease trong D1

Trạng thái: accepted
Ngày: 2026-10-08
Cập nhật [ADR-001](adr-001-stack-cloudflare-modular-monolith.md): "Queues + transactional outbox cho side effects" thành "Queues hoặc lệnh lease D1".

## Bối cảnh

ADR-001 chọn Cloudflare Queues và transactional outbox cho side effects. Bảng `outbox` đã có nhưng chưa có dispatcher; `wrangler.jsonc` chưa có queue. Queues cần gói Workers Paid. Inbox đa kênh cần gửi tin Zalo/Messenger, gọi GoClaw, gửi Lark với retry và chống trùng, và phần lớn lệnh do sidecar ([ADR-008](adr-008-zalo-bridge-sidecar.md)) thực thi bằng cách kéo về, nên Queues không phục vụ trực tiếp được. Lưu lượng dưới 10 số Zalo và một Fanpage. User chốt dùng lệnh lease trong D1, không dùng Queues (2026-10-08). Nguồn: [brainstorm](../../plans/reports/brainstorm-261008-1421-omnichannel-inbox-goclaw.md), [plan](../../plans/261008-1430-omnichannel-inbox-goclaw/plan.md).

## Quyết định

- Bảng `channel_command` với `status` (`pending`/`claimed`/`done`/`failed`), `attempts`, `claimed_at`, `lease_expires_at`, `next_run_at`, `dedupe_key` UNIQUE, cùng `kind`, `target`, `payload_json`, `result_json`. Ghi lệnh cùng batch với thay đổi nghiệp vụ tạo ra nó; `dedupe_key` chống tạo trùng.
- Lệnh `target='bridge'` (gửi Zalo, gọi GoClaw, đăng nhập/đăng xuất Zalo) do sidecar long-poll và claim, lease 300 giây (lớn hơn timeout GoClaw 180 giây). Kết quả chỉ được áp khi `UPDATE ... WHERE id = ? AND status = 'claimed' AND attempts = ?` đổi đúng 1 dòng; kết quả của lease đã hết hạn bị bỏ qua.
- Lệnh `target='worker'` (gửi Messenger, gửi Lark) do Worker xử lý ngay bằng `waitUntil`; Cron Trigger chạy mỗi phút thử lại lệnh đến hạn và lệnh có lease hết hạn.
- Tối đa 5 lần thử. Lần lỗi thứ n hẹn `next_run_at` sau 2^attempts phút; quá 5 lần thì `failed`.
- Không cần gói Workers Paid. Queues vẫn là lựa chọn hợp lệ cho side effect khác khi có nhu cầu.

## Phương án đã xét

- Cloudflare Queues: giảm code tự viết nhưng cần Workers Paid, chưa có hạ tầng, và sidecar vẫn phải kéo lệnh qua HTTP. Loại cho inbox.
- Durable Objects để tuần tự hoá theo hội thoại: ADR-001 chỉ cho phép DO cho lịch tài nguyên MVP3. Loại.
- Bảng lệnh riêng cho inbox cạnh `outbox`: hai đường retry cho cùng một việc. Loại; `channel_command` là dispatcher dùng chung.

## Hệ quả

- Đội tự viết và test claim, lease, backoff, chống trùng; đây là việc ADR-001 vốn cần cho outbox.
- Độ trễ retry của lệnh `worker` tối thiểu 1 phút theo nhịp Cron.
- D1 chịu tải polling của sidecar; đủ cho quy mô hiện tại, phải xem lại khi lưu lượng vượt khả năng polling/lease của D1.
- Lệnh có thể chạy hơn một lần khi lease hết hạn giữa chừng; bên thực thi phải idempotent theo `messageId` / `dedupe_key`.
