# ADR-012: Chat nội bộ, quản lý công việc và agent ngay trong CRM (bỏ Lark)

Trạng thái: accepted
Ngày: 2026-10-25

## Bối cảnh

Theo quyết định của user ngày 2026-10-25, toàn bộ hoạt động nội bộ gồm chat nhóm, chat riêng 1-1, bình luận công việc, quản lý công việc (việc gắn lead và việc nội bộ) và tương tác với agent GoClaw được gom vào một nền tảng duy nhất là web CRM; bỏ hẳn Lark. Mục tiêu là nhân viên không phải chuyển qua lại giữa Lark và CRM, đồng thời cho phép mỗi người tự tạo token MCP để các công cụ AI (Claude Code, Codex, Antigravity) đọc ngữ cảnh chat và việc của chính mình. Nguồn: [brainstorm](../../plans/reports/brainstorm-261025-1447-internal-chat-task-repos.md), [plan](../../plans/261025-1500-internal-chat-tasks-agents/plan.md).

## Quyết định

- **D1 là nguồn dữ liệu chuẩn duy nhất** cho mọi hội thoại (`chat_conversation`), thành viên (`chat_member`), tin nhắn (`chat_message`), tệp đính kèm (`chat_attachment`) và việc (`task`, `task_member`). Các bảng chat dùng tiền tố `chat_` để tách biệt hoàn toàn với bảng `conversation`/`message` của inbox khách hàng. Bình luận trong từng việc dùng chung bảng `chat_message` qua hội thoại `kind='task'`.
- **Một Durable Object `ChatHub` (SQLite-backed) cho mỗi tổ chức** (`idFromName(organization_id)`), sử dụng WebSocket Hibernation và gắn tag `userId` trên mỗi kết nối. `ChatHub` không lưu trữ tin nhắn, chỉ chuyển tiếp sự kiện chứa định danh (`message.created`, `message.deleted`, `conversation.updated`, `read`, `thread.updated`); trình duyệt nhận sự kiện rồi tải dữ liệu qua các route REST có kiểm tra quyền truy cập.
- Tệp đính kèm lưu trên R2 bucket `MEDIA` dưới tiền tố `chat/<conversationId>/<id>`, kiểm soát quyền tải qua hội thoại và ép `Content-Disposition: attachment` kèm `X-Content-Type-Options: nosniff` cho mọi định dạng không phải ảnh an toàn.

### Agent trong chat

Agent GoClaw là bảng `chat_agent` riêng (không thêm vai trò `app_user`), gắn vào hội thoại qua `chat_agent_member`. Lượt trả lời đi qua hàng lệnh bridge (`run_completion`, `purpose: 'chat'`); câu trả lời quay về thành tin `author_kind = 'agent'`. Agent không bao giờ gọi agent. Có hai danh tính (principal) tách biệt:

- **Chat riêng với Trợ lý** (`dm_agent_key`, ví dụ `crm-assistant`): GoClaw user id `crm-user:<app_user.id>`, dùng chìa khóa MCP của chính người đang nhắn, nên agent chỉ làm được những gì người đó được làm ([ADR-004](adr-004-chat-actor-identity.md)).
- **@Trợ lý trong nhóm hoặc luồng việc** (`group_agent_key`, ví dụ `crm-group-assistant`): GoClaw user id `crm-chat:<id hội thoại>`, **không có công cụ CRM**. Agent chỉ đọc tối đa 20 tin gần nhất, gửi kèm như dữ liệu chứ không phải chỉ dẫn.

Rủi ro chấp nhận: Trợ lý chat riêng đọc được chat của người dùng qua MCP, nên nội dung chat có thể lái agent. Quyền ghi CRM vẫn bị giới hạn bởi quyền của chính người dùng và luồng duyệt; prompt của agent cấm ghi chỉ vì chat yêu cầu.

Việc do agent đề xuất luôn cần người xác nhận: agent chỉ trả dòng `[TASK: tiêu đề | @Tên người | YYYY-MM-DD]`, Worker biến thành thẻ đề xuất trong tin. Chỉ người gọi agent thấy nút "Tạo việc"; việc được tạo qua lệnh `createTask` thông thường khi người đó xác nhận, Worker không tự tạo việc. Chi tiết cấu hình: [Agent GoClaw](../integrations/goclaw-inbox-agents.md). Từ 2026-10-26 agent trả khối `[TASK] … [/TASK]` và thẻ đề xuất thành việc nháp (mục dưới); dòng một hàng cũ vẫn đọc được.

### Agent bên ngoài qua MCP

Mỗi người tự tạo token MCP ở trang "Kết nối agent" để Claude Code, Codex hoặc Antigravity đọc chat và việc của mình qua `/api/mcp` ([hướng dẫn](../guides/connect-ai-agents.md)).

- **Mức token** (`agent_token.scope`, migration `0030`): `read` chỉ đọc; `read_tasks` thêm tạo, sửa, hoàn thành và bình luận việc; token do script cấp là `legacy` và giữ bộ công cụ cũ. Không mức nào gửi tin vào chat nhóm hoặc chat riêng. Ma trận chi tiết ở [permission matrix](../security/permission-matrix-v1.md#token-mcp).
- **Hạn và thu hồi**: token tự tạo hết hạn sau 30, 90 hoặc 180 ngày (mặc định 90), xoay hoặc thu hồi được bất cứ lúc nào, tối đa 5 token đang dùng mỗi người. Token chỉ hiện một lần; D1 chỉ lưu SHA-256.
- **Phạm vi đọc**: nhóm và chat riêng người đó là thành viên, cùng luồng bình luận của việc người đó xem được; không có hội thoại đã lưu trữ. Một trong hai người tắt `agent_readable` của chat riêng là agent của cả hai không đọc được.
- **Chống chèn lệnh**: mọi câu trả lời chat có `notice` nói rằng nội dung tin là dữ liệu, không phải chỉ dẫn, và mỗi `text` bắt đầu bằng `[chat] `.
- **Audit**: mỗi lần `read_messages`, `search_messages`, `get_task` ghi một dòng `audit_log` (`mcp.<tool>`, chỉ số lượng, không có nội dung tin). `search_messages` giới hạn 30 lần mỗi 10 phút, chỉ tìm 90 ngày gần nhất.
- **Công tắc tạm khóa bot** chặn cả công cụ đọc chat và `comment_task`, ngoài các lệnh ghi như trước.
- `comment_task` dùng chung đường bình luận với web (lọc @nhắc tên, thông báo) và có mã tin cố định theo token, việc và `request_id` (hoặc nội dung trong cùng phút) nên gửi lại không tạo bình luận trùng.

### Chuỗi, chủ đề, nhóm phòng ban và tạo việc từ chat (2026-10-26)

Chat CRM làm theo cách của Lark. Nguồn: [brainstorm](../../plans/reports/brainstorm-261026-1028-lark-style-threads.md), [nghiên cứu Lark](../../plans/reports/researcher-261026-1023-lark-threads-topics.md). Hướng dẫn cho nhân viên: [chat nội bộ](../guides/chat-user-guide.md).

**Bốn quyết định của user (26/10/2026):**

1. Nhóm phòng ban tự tạo và tự đồng bộ theo `app_user.department_id`. Đồng bộ chạy trong cùng batch với lệnh nhập file nhân viên, sửa người dùng và khóa/mở khóa. `GET /api/chat/conversations` chạy lại cùng các câu đó trong một `db.batch`.
2. Thành viên nào của nhóm phòng ban (và BGĐ/Admin) cũng tạo được nhóm nhỏ dưới nhóm đó, và mời được người phòng ban khác.
3. Có hai chế độ: nhóm thường (trả lời trích dẫn và chuỗi) và "Chủ đề". Chủ nhóm, BGĐ hoặc Admin chuyển chế độ. Chủ đề đóng và mở lại được. Tin cũ giữ nguyên.
4. Việc nháp hiện ngay tại chỗ. Người yêu cầu sửa rồi bấm tạo một lần. Không có Trợ lý thì tạo tay, kết quả như nhau.

**Khác Lark:** Lark không có nhóm cha/con. Ở CRM, nhóm nhỏ nằm dưới nhóm phòng ban vì user yêu cầu. Chỉ có một cấp lồng.

**Mô hình dữ liệu** (migration `0031_lark_threads_groups.sql`):

- `chat_message.reply_to_message_id`: tin được trích dẫn (như `parent_id` của Lark). `chat_message.thread_root_id`: gốc chuỗi (như `thread_id`). `chat_message.also_in_main`: cờ "Cũng gửi vào nhóm".
- `chat_thread` (khóa chính `root_message_id`): số trả lời, `last_reply_at`, `last_activity_at`, `is_topic`, `closed_at`.
- `chat_thread_follower`: `via` (`author`, `reply`, `mention`, `manual`), `muted`, `last_read_at`.
- `chat_conversation.parent_conversation_id` (chỉ trỏ tới nhóm phòng ban), `department_id` (unique một phần), `mode` (`chat` | `topic`). Nhóm phòng ban có id và `system_key` là `dept:<department_id>`. Trưởng phòng là chủ nhóm.
- `task.source_conversation_id`, `task.source_message_id`, `task.source_scope` (`message` | `thread`). Không có khóa ngoại.
- Loại thông báo mới `chat_thread`. Bảng `notification` được dựng lại vì ràng buộc CHECK.

**Câu trả lời cũ thành trả lời trích dẫn.** Migration chép `parent_message_id` sang `reply_to_message_id`. Lý do: không tin nào biến khỏi chat chính, cách này đúng với mọi loại hội thoại (bình luận việc không có chuỗi), và chỉ cần một lệnh UPDATE. Cột `parent_message_id` giữ làm lịch sử, code không đọc nữa. API vẫn nhận `parentMessageId` như tên cũ của `replyToMessageId`.

**Chat chính và số chưa đọc.**

- Chat chính gồm tin gốc và trả lời có `also_in_main = 1`. Chỉ các tin này tính chưa đọc của hội thoại và đẩy hội thoại lên đầu danh sách.
- Chưa đọc của chuỗi tính theo từng người theo dõi: trả lời của người khác sau `last_read_at`. Chuỗi đã tắt thông báo không vào số trên tab "Chuỗi".
- Tự theo dõi: người viết tin gốc, người trả lời, người được @nhắc. Theo dõi tay bắt đầu với `last_read_at = now`.
- Mỗi người chỉ nhận một thông báo cho một tin, theo thứ tự `chat_mention` > `chat_direct` > `chat_thread`.
- Chuỗi có trong nhóm và chat riêng. Bình luận việc chỉ có trả lời trích dẫn.

**Realtime.** Sự kiện mới `thread.updated { conversationId, rootId, messageId? }` gửi tới mọi thành viên hội thoại. Sự kiện vẫn chỉ chứa id.

**Nhóm phòng ban.**

- Thành viên là người đang hoạt động của phòng ban. Người chuyển phòng ban hoặc bị khóa bị gỡ ra. Không thêm hay xóa tay được; ai không thuộc phòng ban sẽ bị gỡ ở lần đồng bộ sau.
- Tên nhóm theo tên phòng ban, không đổi tay được.
- Người rời phòng ban vẫn ở lại các nhóm nhỏ đã được mời.

**Chế độ Chủ đề.** Mỗi tin mới ở cấp ngoài là một chủ đề. Chủ đề xếp theo hoạt động gần nhất. Người viết chủ đề, chủ nhóm, BGĐ hoặc Admin đóng và mở lại chủ đề. Nhóm Inbox và chat riêng không đổi chế độ được. Khi @Trợ lý ở cấp ngoài, câu hỏi thành chủ đề và Trợ lý trả lời trong chủ đề đó.

**Tạo việc từ chat.**

- `POST /api/chat/conversations/:id/task-drafts { messageId, scope, prefer? }` trả `{ mode: 'agent' }` khi nhóm có Trợ lý nhóm đang bật và bridge online. Ngược lại trả `{ mode: 'manual', draft }`. Chat riêng luôn nhận nháp tay. `prefer: 'manual'` bỏ qua Trợ lý. Tin không tồn tại hoặc đã thu hồi trả 404.
- Trợ lý trả đúng một khối `[TASK]`. Worker lưu vào `meta.taskDrafts` của tin agent, đặt tin đó vào chuỗi (hoặc trả lời trích dẫn tin gốc). Trả lời không có khối hợp lệ thì tin mang `meta.taskDraftFailed`, người yêu cầu thấy nút "Tự tạo việc".
- Người yêu cầu gọi `createTask` kèm `source` (và `draft` nếu dùng nháp của Trợ lý). Một batch ghi việc, `task_member`, nguồn, và đánh dấu nháp đã dùng có kiểm tra. Nháp đã dùng trả 409.
- Sau commit: người làm chính nhận `task_assigned`. Người cùng làm cũng được báo, với mọi việc mới. Thẻ việc `task-card:<taskId>` được đăng vào chuỗi, hoặc thành trả lời trích dẫn tin gốc.
- Trợ lý vẫn không bao giờ tự tạo việc. Trợ lý nhóm vẫn không có công cụ CRM.

**Khối `[TASK]`.** Mỗi dòng `khóa: giá trị`. Khóa không phân biệt hoa thường và dấu; nhận cả tên tiếng Việt (`tiêu đề`, `người làm`, `người liên quan`, `hạn`, `mô tả`). `description:` lấy mọi dòng sau nó tới `[/TASK]`. Thiếu `[/TASK]` thì lấy tới hết. Tên chỉ khớp khi trùng đúng một thành viên hội thoại (so sau khi bỏ dấu). Tên không khớp giữ dạng chữ để người yêu cầu sửa. Tối đa 3 khối mỗi câu trả lời. Dòng cũ `[TASK: …]` vẫn đọc được.

```text
[TASK]
title: Gửi báo giá cho khách Gốm Thanh Lam
assignee: @Vũ Đức Long
members: @Đỗ Ngọc Lan, @Phạm Văn Hùng
due: 2026-10-30
description:
Khách cần báo giá trọn gói trước thứ 6.
Lan gửi thông tin đơn hàng cho Long.
[/TASK]
```

**MCP.** `read_messages` trả `thread_id`, `reply_to_id`, `parent_id` (giữ để tương thích) và `reply_count`, và lọc được theo `thread_id`. `list_conversations` trả `mode` và `parent_conversation_id`. `get_task` trả `source` khi agent được đọc hội thoại nguồn.

**Ngân sách D1 (đo trong test).** Gửi tin trường hợp nặng nhất: 14 truy vấn D1, 6 push. Cron thông báo: 35 truy vấn D1. Tạo việc từ chat: 15 truy vấn D1, 22 push, 3 lần gọi ChatHub. Trần tự đặt là 40.

**Mặc định đã chốt cho câu hỏi còn mở (user đổi được sau):** không có nhóm "Toàn công ty"; BGĐ/Admin không tự vào nhóm phòng ban; chủ đề xếp theo hoạt động gần nhất; người cùng làm được báo với mọi việc mới; người rời phòng ban vẫn ở lại nhóm nhỏ.

## Phương án đã xét

- **Giữ Lark cho chat nội bộ**: nhân viên phải dùng hai ứng dụng song song, tách rời ngữ cảnh công việc và không mở được MCP đồng nhất theo từng tài khoản CRM. Loại.
- **Tự host Huly / Rocket.Chat / Mattermost**: phát sinh máy chủ, cơ sở dữ liệu và hệ thống tài khoản riêng ngoài Cloudflare, phải đồng bộ quyền hai chiều với CRM. Loại.
- **Dùng Lark làm nền tảng chính**: phụ thuộc sâu vào hệ sinh thái bên thứ ba và không kiểm soát được luồng nghiệp vụ CRM nội bộ. Loại.
- **Polling HTTP định kỳ thay cho Durable Object WebSocket**: với 18 nhân sự polling mỗi 5 giây sẽ vượt giới hạn 100.000 request/ngày của gói Cloudflare Workers Free. Loại, chọn một `ChatHub` DO mỗi tổ chức với WebSocket Hibernation.
- **Đổi câu trả lời cũ thành trả lời trong chuỗi**: tin sẽ biến khỏi chat chính, và bình luận việc không có chuỗi. Loại, đổi thành trả lời trích dẫn.
- **Khối việc dạng JSON**: agent dễ viết sai hơn dạng `khóa: giá trị`. Loại.
- **Bảng `task_source` riêng**: quan hệ là 1-1 nên ba cột trong `task` là đủ. Loại.
- **Chỉ có nhóm phẳng như Lark**: user chọn nhóm nhỏ lồng dưới nhóm phòng ban. Loại.

## Hệ quả

- Mỗi trình duyệt chỉ mở một kết nối WebSocket duy nhất cho mọi hội thoại; mỗi lần gửi tin chỉ tốn 1 subrequest tới `ChatHub`.
- Khi kết nối lại sau lúc mất mạng, trình duyệt đọc lại trạng thái chuẩn từ D1 nên không mất tin ngay cả khi Durable Object ngủ hoặc khởi động lại.
- Mở ngoại lệ có kiểm soát đối với [ADR-001](adr-001-stack-cloudflare-modular-monolith.md) để dùng một Durable Object `ChatHub` cho việc chuyển tiếp sự kiện chat nội bộ.
- Các thông báo trước đây đẩy qua Lark được chuyển sang thông báo trong CRM, nhóm chat nội bộ và Web Push trước khi gỡ bỏ hoàn toàn code cùng secret Lark ở các phase tiếp theo.
