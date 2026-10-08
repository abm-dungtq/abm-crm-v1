# Brainstorm: trình tự triển khai eval (1300 → inbox đợt A, 1457 song song)

Ngày: 2026-10-08. Nguồn: rà kho (báo cáo deploy, ghi chú tiến độ), quyết định của user, kongming kiểm tra (GO kèm 4 điều kiện).

## Outcome
- Plan `261004-1300-crm-admin-user-auth` phase 05 `completed`, có bằng chứng ghi lại.
- Inbox đợt A chạy trên eval: migration 0012–0017 đã áp, GoClaw có agent và API key cho sidecar, sidecar chạy, 2 số Zalo pilot `connected`, 6 kịch bản 10.7 "Đạt". Pilot 2 tuần (10.8) chạy sau đó.
- Plan `261004-1457-crm-bot-gateway` phase 05 phần còn lại chạy khi có 3 người Lark thật, song song, không chặn inbox.

## Quyết định của user (2026-10-08)
1. Xong 1300 trước. 1457 không còn chặn inbox; hai bên dùng agent GoClaw và công tắc khác nhau (`agent_kill_switch` khác `customer_bot_switch`).
2. Merge PR #1 rồi deploy từ `main`.
3. `gateway.rate_limit_rpm` = 120.
4. Gỡ grant `abm-crm-poc` khỏi `crm-sales-poc` (backup GoClaw trước), gộp vào cùng lần đồng ý của Task 10.4.

## Constraints
- Mỗi bước có cổng đồng ý riêng, hỏi ngay trước khi chạy: backup và migrate remote, đặt secret (user tự chạy), deploy, đổi cấu hình GoClaw (có backup), cài Scheduled Task, đăng nhập QR, bật tin định kỳ, khôi phục D1.
- Không in secret, token, mật khẩu, mã QR, cookie, account ID.

## Non-goals
- Đợt B (Messenger, chờ Meta App Review) và đợt C (tin định kỳ, chờ pilot đạt).

## Điều kiện bảo vệ (từ kongming)
1. **Không time-travel restore D1 khi đợt A đã chạy.** Task 5.7 bước 3 của 1457 chỉ ghi bookmark, không khôi phục thật; khôi phục sẽ cuốn ngược dữ liệu inbox trong khi sidecar còn giữ phiên Zalo và lease.
2. **Nhóm Lark riêng cho inbox.** User tạo nhóm "Inbox", thêm bot DungTQ_Agent làm thành viên, lấy `chat_id` làm `LARK_INBOX_CHAT_ID`; không dùng nhóm test của 1457.
3. **Không `wrangler rollback` sau đợt A khi sidecar còn chạy.** Dừng Scheduled Task "ABM Zalo Bridge" trước; bản Worker cũ không có `/api/bridge`.
4. **Diễn tập migration trên D1 tạm.** `0013` xoá và dựng lại `contact_point`. Trước 10.1: export eval, nạp vào D1 tạm (mẫu `abm-crm-rehearsal`), áp 0012–0017, `PRAGMA foreign_key_check` rỗng, xoá D1 tạm.

## Bổ sung cho phase 10 (cần ghi vào plan trước khi chạy)
- 10.1 thêm bước 0: diễn tập ở trên; báo cáo liệt kê đủ sáu migration.
- 10.2 thêm bước user: tạo nhóm Lark Inbox và thêm bot. `APP_URL` = URL eval, đặt ở `vars` trong `wrangler.jsonc` (không nhạy cảm, có version) thay cho `secret put`.
- 10.4: `rate_limit_rpm` 120, sửa ở cả system config DB và `D:\Goclaw\config.json` (lúc khởi động GoClaw đồng bộ từ file); kiểm lại sau khi khởi động lại. Gỡ grant `abm-crm-poc`. Key sidecar `operator.read` + `operator.write`, không gắn owner.
- 10.11 thêm `docs/engineering/environments.md` (`BRIDGE_SECRET`, `LARK_INBOX_CHAT_ID`, `APP_URL`).
- 1457 Task 5.7: đo CPU lọc theo route `/api/mcp` (cron inbox chạy mỗi phút làm nhiễu số liệu); bước 3 chỉ ghi bookmark.
- 1457 Task 5.1: dùng người đã liên kết sẵn (đợt đổi nhân sự thật ngày 10-05). Không nạp lại `demo-roster.csv`; verify "n = 11" của 1300 Task 5.6 đã cũ.

## Kiểm tra chỉ đọc trước lần đồng ý đầu tiên
`wrangler whoami`; `d1 migrations list abm-crm-eval --remote` (mong 0012–0017 chưa áp); `deployments list` (mong `be2f8e11`); `secret list` (chỉ so tên); số `app_user` đã liên kết theo vai trò; `outbox` theo trạng thái; `d1 time-travel info` (bookmark B0); GoClaw `/health`, danh sách agent, API key, `rate_limit_rpm` hiện tại, kênh native `zalo_personal`/`facebook` đang tắt.

## Trình tự
Merge PR #1 → kiểm tra chỉ đọc → đóng 1300 phase 05 (link check, chạy test, kiểm trình duyệt, xác nhận mật khẩu Admin đã lưu, trạng thái) → diễn tập D1 tạm → 10.1 → 10.2 → 10.3 → 10.4 → 10.5 → 10.6 → 10.7. 1457 Task 5.1/5.3/5.5/5.6 chạy khi đủ người, theo điều kiện 1 và 3.

## Trade-offs
- **Song song (đã chọn)**: dựa trên giả định hai luồng không ghi chung tài nguyên. Hỏng đầu tiên nếu ai đó time-travel restore hoặc rollback giữa pilot; các điều kiện 1 và 3 chặn việc này.
- **Tuần tự 1457 rồi inbox**: an toàn hơn về cách ly. Hỏng đầu tiên ở tiến độ, vì phụ thuộc 3 người Lark sẵn sàng.

## Câu hỏi còn mở
- `apps/crm/.admin-bootstrap.local` đã bị xoá mà không có ghi nhận. Mật khẩu Admin eval đã được lưu ở nơi riêng chưa? Theo `exports/abm-crm-eval-before-real-admin-password-20261004.sql`, mật khẩu Admin thật đã được đặt lại ngày 10-04.
- 3 người cho 1457 (Sale A, Sale B, Leader) là ai và khi nào sẵn sàng?
- Hai số Zalo nào dùng cho pilot, và ai giữ điện thoại để quét QR?
