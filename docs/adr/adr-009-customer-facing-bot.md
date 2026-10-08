# ADR-009: Bot trả lời khách hàng

Trạng thái: accepted
Ngày: 2026-10-08

## Bối cảnh

[ADR-004](adr-004-chat-actor-identity.md) mô tả bot nhân viên: nhân viên đã xác thực nhắn GoClaw trong Lark, CRM cấp credential theo từng người. Inbox đa kênh thêm một loại principal mới: GoClaw trả lời khách hàng lạ trên Zalo cá nhân và Fanpage. Khách không có tài khoản CRM, nội dung khách gửi là dữ liệu không tin cậy, nên bot này không được dùng quyền của nhân viên. Nguồn: [brainstorm](../../plans/reports/brainstorm-261008-1421-omnichannel-inbox-goclaw.md), [plan](../../plans/261008-1430-omnichannel-inbox-goclaw/plan.md).

## Quyết định

- Mỗi hội thoại có chế độ `ai`, `human` hoặc `paused`, lưu trong D1 nên bền qua khởi động lại. Chỉ ở `ai` bot mới trả lời; ở `human` và `paused` bot không gửi gì.
- Chuyển sang `human` khi nhân viên bấm Tiếp quản, khi số chung gửi tin từ điện thoại (`staff_phone`), hoặc khi agent trả một dòng marker `[HANDOFF: lý do]` (regex `^\[HANDOFF:\s*(.+?)\]\s*$`, đa dòng). Worker bỏ marker khỏi tin gửi khách, ghi lý do, chia hội thoại cho nhân viên và báo nhóm Lark.
- Công tắc riêng `customer_bot_switch` tắt bot khách hàng mà không ảnh hưởng bot nhân viên. Không dùng `agent_kill_switch` của bot nhân viên. `enabled = 1` nghĩa là tắt, cùng nghĩa với `agent_kill_switch`.
- Bot chỉ ghi vào `lead_intake` (lead chờ phân loại): thông tin agent trích từ hội thoại, gắn với hội thoại.
- `contact` và `lead` thật chỉ do nhân viên tạo, khi chọn pipeline `b2b` hoặc `learner` trên giao diện, bằng lệnh sẵn có `createLead` / `createLearnerLead`. Bot không bao giờ tự tạo `lead`, không ghi trực tiếp `contact` hay `lead`.
- Thông tin mới khác thông tin đã có trong CRM chỉ được dùng khi nhân viên xác nhận trên giao diện.
- Hợp đồng brainstorm ghi "ghi đè trường đã có đi qua `approval`". ADR này chọn nhân viên xác nhận ngay trong `lead_intake` thay cho bảng `approval`, vì bảng `approval` chỉ dành cho lead (`lead_id NOT NULL`) và lúc trích thông tin chưa có lead. Thay đổi này chấp nhận được vì bot không bao giờ ghi trực tiếp vào `contact` hay `lead`: mọi ghi vào dữ liệu chuẩn vẫn do một người đã xác thực thực hiện và có `audit_log`.

## Lịch sử tách đôi

- Lịch sử hội thoại có hai nơi: bảng `message` trong CRM là bản chuẩn và đầy đủ; phiên GoClaw (theo `X-GoClaw-User-Id` của hội thoại) chỉ thấy các lượt bot đã xử lý.
- Khi hội thoại ở `human` hoặc `paused`, tin của nhân viên (web hoặc điện thoại) và tin của khách không đi qua GoClaw. Worker nối các tin này vào `conversation.staff_context_pending` (dạng `Nhân viên: ...` / `Khách: ...`, giữ tối đa 1500 ký tự cuối).
- Khi trả lại `ai`, lượt GoClaw kế tiếp nhận text có tiền tố `[Nhân viên đã trao đổi: ...]` chứa `staff_context_pending`, rồi Worker xoá trường này. Bot nhờ đó biết nhân viên đã nói gì mà không cần đồng bộ toàn bộ lịch sử vào GoClaw.
- Trích CRM và tóm tắt nhóm gọi GoClaw kiểu stateless (`crm-extract:<uuid>`, `group-summary:<uuid>`), không dùng phiên của hội thoại.

## Phương án đã xét

- Dùng chung credential và kill switch với bot nhân viên (ADR-004): tắt một bot sẽ tắt cả hai, và bot khách hàng mang quyền của nhân viên. Loại.
- Bot tự tạo `contact` + `lead` ở pipeline `unclassified`: lan ra mọi truy vấn và báo cáo theo pipeline. Loại.
- Bot tạo lead `b2b` rồi đổi sang `learner`: phải viết chuyển trạng thái chéo pipeline đụng ba CHECK và làm sai số liệu hàng đợi b2b. Loại.
- Ghi đè qua bảng `approval`: không dùng được khi chưa có lead. Thay bằng xác nhận trong `lead_intake`.

## Hệ quả

- Dữ liệu chuẩn chỉ thay đổi khi nhân viên thao tác; nhân viên phải phân loại `lead_intake` thì mới có lead.
- Cần giao diện xác nhận trường khác biệt trong `lead_intake`.
- `staff_context_pending` bị cắt 1500 ký tự; trao đổi dài thì bot chỉ thấy phần cuối.
- Tắt bot khách hàng bằng `customer_bot_switch` không chặn Inbox, chia việc hay tóm tắt nhóm gửi Lark.
