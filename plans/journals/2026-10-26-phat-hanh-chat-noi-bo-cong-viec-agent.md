# 2026-10-26 — Phát hành chat nội bộ, công việc và agent trong CRM

## Chuyện gì đã xảy ra
User giao "cook toàn bộ plan" và để advisor Opus chốt thay. Phase 01–06 làm trong khoảng 4 giờ: Agy làm 01–04a, rồi hết quota giữa 04b ("Individual quota reached", khoảng 158 giờ mới mở lại). Advisor duyệt chuyển sang Claude subagent cho 04b–06, giữ nguyên luật và cổng kiểm. Khoảng 02:00 ngày 26/10, Opus sao lưu D1 (có bookmark Time Travel), chạy migration 0025–0030 lên remote, đặt khóa VAPID, rồi deploy. Opus cũng sao lưu GoClaw và tạo hai agent chat.

## Quyết định
- `VAPID_SUBJECT` để làm secret chứ không làm var, để email Admin không nằm trong repo.
- Token `lms-publish` bị `/api/mcp` từ chối. Token tự tạo không gọi được API publish LMS.
- Script cấp key GoClaw chỉ thu hồi token `goclaw` của chính người đó. Bản cũ thu hồi mọi token, nên khi cấp lại sẽ làm hỏng token tự tạo và token LMS.
- Trợ lý chat riêng được đọc chat của người dùng. Prompt cấm ghi CRM chỉ vì nội dung chat yêu cầu. Rủi ro này đã ghi trong ADR-012.

## Điều rút ra
- Mỗi vòng review đều bắt được lỗi thật. Chế độ "fake sink" đã lọt vào ba đường chạy production, làm mất thông báo đẩy. Cron có thể vượt giới hạn 50 truy vấn D1. Script cấp token có thể thu hồi nhầm token của người dùng.
- Đo số truy vấn D1 bằng test (đếm `prepare` và `batch`) đáng tin hơn ước lượng.
- Không có tài khoản test để đăng nhập thì phần kiểm có phiên đăng nhập không tự làm được. Lần sau nên tạo sẵn một tài khoản `[TEST]` trước khi phát hành.

## Tiếp theo
User tự kiểm 7.4 (hai máy, push, iPhone), cấp key `crm-user`, thử Trợ lý, thử MCP từ Claude Code, xem thông báo trong nhóm Inbox, rồi xóa secret Lark. Commit chia hai phần (LMS trước, rồi đợt này) khi user yêu cầu.
