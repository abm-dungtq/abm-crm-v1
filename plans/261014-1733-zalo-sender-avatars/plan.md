# Tên và ảnh đại diện người chat Zalo cá nhân, Zalo OA và thành viên nhóm Zalo

Status: in progress · Owner: Opus (giám sát) · Executor: Grok 4.7 qua Paseo (Gemini hết hạn mức đến khoảng 19:45)

## Mục tiêu
- Inbox hiển thị ảnh đại diện thật của khách ở 3 chỗ: danh sách hội thoại, đầu khung chat, thẻ "Khách trong CRM".
- Nguồn ảnh: Zalo cá nhân, Zalo OA, và thành viên nhóm Zalo (trong danh sách thành viên và cạnh tin nhắn nhóm).
- Tên Zalo OA không còn kẹt ở "Khách Zalo OA" khi lần tra hồ sơ đầu tiên lỗi.
- Ảnh hỏng hoặc hết hạn thì quay về chữ cái đầu, không bao giờ hiện ảnh vỡ.

## Ràng buộc
- Chỉ dùng đường dẫn ảnh `https` của Zalo; không chép ảnh về R2 (quyết định của owner 14/10).
- Không chặn việc nhận tin khi tra hồ sơ lỗi. Lệnh tra hồ sơ có giới hạn thời gian 5 giây.
- Hợp đồng bridge → Worker tương thích ngược: Worker mới nhận được bridge cũ và ngược lại.
- Thứ tự triển khai: sao lưu D1 → migration 0022 → Worker + UI → bridge trên VPS.

## Ngoài phạm vi
- Ảnh đại diện trong trang Khách hàng / Lead, và kênh Facebook.

## Phase
| # | Việc | Người làm | Trạng thái |
|---|------|-----------|------------|
| 1 | Migration 0022, Worker (ingest, OA profile, cron bù ảnh), API, bridge, UI, test | Grok | xong (báo cáo `plans/reports/grok-261014-zalo-sender-avatars.md`) |
| 2 | Soát code, chạy test, chụp màn hình bản chạy thử | Opus | xong: CRM 530 test, bridge 102 test; ảnh hiện đúng, ảnh hỏng quay về chữ cái |
| 3 | Triển khai eval + bridge, kiểm tra thật | Opus | xong 14/10 18:20 (chi tiết dưới) |

## Triển khai 14/10
- Sao lưu: bookmark `000000a8-00000008-00005104-d0b90b6c41024f9318a64b75ed6ad4d3`, file `exports/abm-crm-eval-before-0022-20261014.sql`.
- Áp 0022, deploy Worker `8b264eb4`, sau đó `108f22bc` (thêm log mã lỗi tra hồ sơ OA, chỉ tên trường, không giá trị).
- Bridge chạy trên máy Windows của owner, không phải VPS. Khởi động lại bằng `pnpm -F @abm/zalo-bridge start` sau khi nạp biến từ `apps/zalo-bridge/.env` vào môi trường; thiếu bước nạp thì bridge thoát vì thiếu `CRM_BASE_URL`.
- Kết quả: thành viên nhóm 29/29 có ảnh.
- Zalo OA: `user/detail` trả `-212` ("App has not registered this api") cho mọi khách, dù owner xác nhận quyền đã bật. Theo cách của app chatbot cũ, khi gặp `-212` Worker lấy tên + ảnh từ lịch sử hội thoại v2 `oa/conversation`. Deploy `1bd5e188` (14/10 20:55), bookmark trước khi đặt lại `000000aa-00000368-00005104-c193a40096e295ec800686ba1e8c02ba`. Đặt `avatar_checked_at = NULL` cho 47 hội thoại OA chưa có ảnh; 10 hội thoại đầu có ảnh ngay.
- Bridge tự khởi động: Task Scheduler "ABM Zalo Bridge" chạy `%LOCALAPPDATA%\abm-zalo-bridge\start-bridge.ps1` khi đăng nhập Windows và mỗi 5 phút. Script bỏ qua nếu bridge đang chạy. Log ở `%LOCALAPPDATA%\abm-zalo-bridge\zalo-bridge.log`.

Chi tiết giao việc: `%TEMP%\grok-crm\task-zalo-avatars.md`.

## Tiêu chí nghiệm thu
1. Tin Zalo cá nhân 1-1 mới → `conversation.avatar_url` có ảnh, UI hiện ảnh.
2. Tin nhóm Zalo → `zalo_group_member.avatar_url` có ảnh, danh sách thành viên và tin nhóm hiện ảnh người gửi.
3. Tin Zalo OA → tên + ảnh lấy từ `user/detail`; tên "Khách Zalo OA" được tra lại ở tin sau.
4. Cron bù ảnh cho hội thoại OA cũ, mỗi lần chạy tối đa 10 hội thoại.
5. Ảnh lỗi → chữ cái đầu. `img` dùng `referrerPolicy="no-referrer"`.
6. `pnpm -F @abm/crm typecheck/test/build` và `pnpm -F @abm/zalo-bridge typecheck/test` đều đạt.
