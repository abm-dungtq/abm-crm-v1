# 2026-10-25 — Kế hoạch chat nội bộ, công việc và agent trong CRM

## Chuyện gì đã xảy ra
User hỏi repo GitHub nào có chat nội bộ và quản lý việc để gắn vào CRM. Vòng đầu tôi đề xuất giữ Lark cho chat và tự mở rộng bảng `task`. User từ chối: muốn mọi thứ trên một nền tảng là CRM, agent tham gia dễ, bỏ hẳn Lark, có chat nhóm, chat riêng, bình luận việc, và mở MCP theo từng tài khoản cho Claude Code, Codex, Antigravity.

## Quyết định
- Không gắn nguyên repo nào. Huly, Rocket.Chat, Mattermost cần máy chủ riêng và tài khoản riêng, trong khi CRM chạy Cloudflare gói free, không có VPS. Chỉ mượn mẫu `cloudflare/workers-chat-demo` (BSD-3) và `dnd-kit` (MIT).
- Một Durable Object `ChatHub` cho cả tổ chức, D1 là nơi lưu tin. Polling bị loại vì 18 người hỏi mỗi 5 giây đã vượt 100k request/ngày.
- Agent trong nhóm không có công cụ CRM; đề xuất việc bằng dòng `[TASK: ...]`, người gọi bấm mới tạo. Chat riêng với Trợ lý dùng quyền của chính người đó (khóa GoClaw `crm-user:<id>`). Không thêm role mới vì CHECK role buộc rebuild `app_user`.
- Token MCP tự tạo: `read` mặc định, `read_tasks` tùy chọn; hết hạn 90 ngày; chat riêng có công tắc `agent_readable`.

## Điều rút ra
- Kongming soát kế hoạch tìm ra giới hạn gói free dễ bỏ sót: 50 truy vấn D1 và 50 subrequest mỗi lần gọi, LIKE trên D1 tối đa 50 byte. Hai giới hạn này buộc gộp ghi và đổi tìm kiếm sang `instr`.
- Tải tệp đính kèm chat về cùng origin với CRM là lỗ XSS nếu trả `inline` cho HTML/SVG; chỉ ảnh mới được `inline`.

## Tiếp theo
Kế hoạch ở `plans/261025-1500-internal-chat-tasks-agents/`, chờ user duyệt để chạy phase 01. Câu hỏi mở: công tắc `agent_readable` cho chat riêng (đang làm theo đề xuất, mặc định bật).
