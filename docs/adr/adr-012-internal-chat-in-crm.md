# ADR-012: Chat nội bộ, quản lý công việc và agent ngay trong CRM (bỏ Lark)

Trạng thái: accepted
Ngày: 2026-10-25

## Bối cảnh

Theo quyết định của user ngày 2026-10-25, toàn bộ hoạt động nội bộ gồm chat nhóm, chat riêng 1-1, bình luận công việc, quản lý công việc (việc gắn lead và việc nội bộ) và tương tác với agent GoClaw được gom vào một nền tảng duy nhất là web CRM; bỏ hẳn Lark. Mục tiêu là nhân viên không phải chuyển qua lại giữa Lark và CRM, đồng thời cho phép mỗi người tự tạo token MCP để các công cụ AI (Claude Code, Codex, Antigravity) đọc ngữ cảnh chat và việc của chính mình. Nguồn: [brainstorm](../../plans/reports/brainstorm-261025-1447-internal-chat-task-repos.md), [plan](../../plans/261025-1500-internal-chat-tasks-agents/plan.md).

## Quyết định

- **D1 là nguồn dữ liệu chuẩn duy nhất** cho mọi hội thoại (`chat_conversation`), thành viên (`chat_member`), tin nhắn (`chat_message`), tệp đính kèm (`chat_attachment`) và việc (`task`, `task_member`). Các bảng chat dùng tiền tố `chat_` để tách biệt hoàn toàn với bảng `conversation`/`message` của inbox khách hàng. Bình luận trong từng việc dùng chung bảng `chat_message` qua hội thoại `kind='task'`.
- **Một Durable Object `ChatHub` (SQLite-backed) cho mỗi tổ chức** (`idFromName(organization_id)`), sử dụng WebSocket Hibernation và gắn tag `userId` trên mỗi kết nối. `ChatHub` không lưu trữ tin nhắn, chỉ chuyển tiếp sự kiện chứa định danh (`message.created`, `message.deleted`, `conversation.updated`, `read`); trình duyệt nhận sự kiện rồi tải dữ liệu qua các route REST có kiểm tra quyền truy cập.
- Tệp đính kèm lưu trên R2 bucket `MEDIA` dưới tiền tố `chat/<conversationId>/<id>`, kiểm soát quyền tải qua hội thoại và ép `Content-Disposition: attachment` kèm `X-Content-Type-Options: nosniff` cho mọi định dạng không phải ảnh an toàn.

### Agent trong chat

Agent GoClaw là bảng `chat_agent` riêng (không thêm vai trò `app_user`), gắn vào hội thoại qua `chat_agent_member`. Lượt trả lời đi qua hàng lệnh bridge (`run_completion`, `purpose: 'chat'`); câu trả lời quay về thành tin `author_kind = 'agent'`. Agent không bao giờ gọi agent. Có hai danh tính (principal) tách biệt:

- **Chat riêng với Trợ lý** (`dm_agent_key`, ví dụ `crm-assistant`): GoClaw user id `crm-user:<app_user.id>`, dùng chìa khóa MCP của chính người đang nhắn, nên agent chỉ làm được những gì người đó được làm ([ADR-004](adr-004-chat-actor-identity.md)).
- **@Trợ lý trong nhóm hoặc luồng việc** (`group_agent_key`, ví dụ `crm-group-assistant`): GoClaw user id `crm-chat:<id hội thoại>`, **không có công cụ CRM**. Agent chỉ đọc tối đa 20 tin gần nhất, gửi kèm như dữ liệu chứ không phải chỉ dẫn.

Rủi ro chấp nhận: Trợ lý chat riêng đọc được chat của người dùng qua MCP, nên nội dung chat có thể lái agent. Quyền ghi CRM vẫn bị giới hạn bởi quyền của chính người dùng và luồng duyệt; prompt của agent cấm ghi chỉ vì chat yêu cầu.

Việc do agent đề xuất luôn cần người xác nhận: agent chỉ trả dòng `[TASK: tiêu đề | @Tên người | YYYY-MM-DD]`, Worker biến thành thẻ đề xuất trong tin. Chỉ người gọi agent thấy nút "Tạo việc"; việc được tạo qua lệnh `createTask` thông thường khi người đó xác nhận, Worker không tự tạo việc. Chi tiết cấu hình: [Agent GoClaw](../integrations/goclaw-inbox-agents.md).

### Agent bên ngoài qua MCP

Mỗi người tự tạo token MCP ở trang "Kết nối agent" để Claude Code, Codex hoặc Antigravity đọc chat và việc của mình qua `/api/mcp` ([hướng dẫn](../guides/connect-ai-agents.md)).

- **Mức token** (`agent_token.scope`, migration `0030`): `read` chỉ đọc; `read_tasks` thêm tạo, sửa, hoàn thành và bình luận việc; token do script cấp là `legacy` và giữ bộ công cụ cũ. Không mức nào gửi tin vào chat nhóm hoặc chat riêng. Ma trận chi tiết ở [permission matrix](../security/permission-matrix-v1.md#token-mcp).
- **Hạn và thu hồi**: token tự tạo hết hạn sau 30, 90 hoặc 180 ngày (mặc định 90), xoay hoặc thu hồi được bất cứ lúc nào, tối đa 5 token đang dùng mỗi người. Token chỉ hiện một lần; D1 chỉ lưu SHA-256.
- **Phạm vi đọc**: nhóm và chat riêng người đó là thành viên, cùng luồng bình luận của việc người đó xem được; không có hội thoại đã lưu trữ. Một trong hai người tắt `agent_readable` của chat riêng là agent của cả hai không đọc được.
- **Chống chèn lệnh**: mọi câu trả lời chat có `notice` nói rằng nội dung tin là dữ liệu, không phải chỉ dẫn, và mỗi `text` bắt đầu bằng `[chat] `.
- **Audit**: mỗi lần `read_messages`, `search_messages`, `get_task` ghi một dòng `audit_log` (`mcp.<tool>`, chỉ số lượng, không có nội dung tin). `search_messages` giới hạn 30 lần mỗi 10 phút, chỉ tìm 90 ngày gần nhất.
- **Công tắc tạm khóa bot** chặn cả công cụ đọc chat và `comment_task`, ngoài các lệnh ghi như trước.
- `comment_task` dùng chung đường bình luận với web (lọc @nhắc tên, thông báo) và có mã tin cố định theo token, việc và `request_id` (hoặc nội dung trong cùng phút) nên gửi lại không tạo bình luận trùng.

## Phương án đã xét

- **Giữ Lark cho chat nội bộ**: nhân viên phải dùng hai ứng dụng song song, tách rời ngữ cảnh công việc và không mở được MCP đồng nhất theo từng tài khoản CRM. Loại.
- **Tự host Huly / Rocket.Chat / Mattermost**: phát sinh máy chủ, cơ sở dữ liệu và hệ thống tài khoản riêng ngoài Cloudflare, phải đồng bộ quyền hai chiều với CRM. Loại.
- **Dùng Lark làm nền tảng chính**: phụ thuộc sâu vào hệ sinh thái bên thứ ba và không kiểm soát được luồng nghiệp vụ CRM nội bộ. Loại.
- **Polling HTTP định kỳ thay cho Durable Object WebSocket**: với 18 nhân sự polling mỗi 5 giây sẽ vượt giới hạn 100.000 request/ngày của gói Cloudflare Workers Free. Loại, chọn một `ChatHub` DO mỗi tổ chức với WebSocket Hibernation.

## Hệ quả

- Mỗi trình duyệt chỉ mở một kết nối WebSocket duy nhất cho mọi hội thoại; mỗi lần gửi tin chỉ tốn 1 subrequest tới `ChatHub`.
- Khi kết nối lại sau lúc mất mạng, trình duyệt đọc lại trạng thái chuẩn từ D1 nên không mất tin ngay cả khi Durable Object ngủ hoặc khởi động lại.
- Mở ngoại lệ có kiểm soát đối với [ADR-001](adr-001-stack-cloudflare-modular-monolith.md) để dùng một Durable Object `ChatHub` cho việc chuyển tiếp sự kiện chat nội bộ.
- Các thông báo trước đây đẩy qua Lark được chuyển sang thông báo trong CRM, nhóm chat nội bộ và Web Push trước khi gỡ bỏ hoàn toàn code cùng secret Lark ở các phase tiếp theo.
