# Brainstorm: chat nội bộ + quản lý công việc cho CRM

Ngày: 2026-10-25. Chế độ: --advice --auto. Kongming soát: GO, có 2 chỉnh sửa bằng chứng (đã ghi bên dưới).

## Hợp đồng

- **Kết quả mong muốn:** nhân viên ABM trao đổi nội bộ và quản lý công việc gắn với CRM, không phải nhập cùng một việc ở hai nơi.
- **Ràng buộc:** Cloudflare gói miễn phí, không có VPS; chat nội bộ lấy Lark làm nguồn (`docs/decisions/business-decisions-v1.md:129`); công việc lấy CRM làm nguồn (`:123`); giữ quy tắc lead đang mở phải luôn có việc tiếp theo (`apps/crm/migrations/0001_init.sql`, cột `next_action_task_id`).
- **Không làm:** tự host một app chat hoặc app quản lý dự án thứ hai; dựng một công cụ quản lý dự án đầy đủ vượt PRD §19.2.
- **Tiêu chí hoàn thành:** tạo được việc nội bộ không gắn lead; xem dạng Kanban và "Việc của tôi"; có bình luận; Lark nhận thông báo giao việc/đến hạn kèm link mở việc trong CRM; test chứng minh lead đang mở vẫn bắt buộc có việc tiếp theo.

## Repo đã kiểm (số liệu GitHub ngày 2026-10-25)

| Repo | Sao | Giấy phép | Ghi chú |
| --- | --- | --- | --- |
| hcengineering/platform (Huly) | 28k | EPL-2.0 | Chat + task chung một app, cần máy chủ lớn |
| RocketChat/Rocket.Chat | 46k | tùy chỉnh | Chat, cần MongoDB |
| mattermost/mattermost | 39k | tùy chỉnh | Chat, cần PostgreSQL |
| zulip/zulip | 26k | Apache-2.0 | Chat theo chủ đề |
| makeplane/plane | 61k | AGPL-3.0 | Quản lý dự án; chỉ học ý tưởng, không chép mã |
| go-vikunja/vikunja | 5.8k | AGPL-3.0 | Danh sách việc/Kanban |
| kanboard/kanboard | 9.9k | MIT | Kanban, mã được phép chép |
| wekan/wekan | 21k | MIT | Kanban, mã được phép chép |
| cloudflare/workers-chat-demo | 1.1k | BSD-3 | Mẫu chat bằng Durable Objects |

## Phương án

1. **Tự host Huly cạnh CRM.** Dựa vào giả định có máy chủ ổn định. Hỏng trước tiên vì không có VPS, phải quản lý hai hệ tài khoản, và việc nằm ngoài CRM nên không giữ được quy tắc việc tiếp theo.
2. **Mattermost/Rocket.Chat + Plane/Vikunja.** Như trên nhưng tới hai hệ thống thêm. Loại.
3. **Lark Task API.** Miễn phí và có sẵn. Hỏng vì CRM là nguồn công việc; Lark không ép được quy tắc việc tiếp theo. Chỉ dùng Lark để nhận thông báo.
4. **Đề xuất: Lark để chat, CRM tự mở rộng bảng `task`.** Lấy ý tưởng giao diện và mô hình dữ liệu từ Plane/Huly, chỉ chép mã từ repo MIT (Kanboard, Wekan).

## Phương án tốt hơn

Có. Phương án 4 tốt hơn việc tích hợp nguyên repo. Lý do: nó dùng lại Lark mà nhân viên đã mở hằng ngày, không tốn máy chủ, và giữ dữ liệu việc trong D1 nơi các quy tắc CRM đang chạy. Cái giá phải trả là tự viết Kanban và bình luận thay vì có sẵn.

## Rủi ro cần canh

- Khi cho `lead_id` được để trống, phải thêm CHECK và test để lead đang mở vẫn bắt buộc có việc tiếp theo.
- Phạm vi phình thành công cụ quản lý dự án; chỉ làm các trường trong PRD §19.2.
- Nếu sau này cần chat ngay trong web CRM: Durable Objects có trên gói miễn phí (bản SQLite), nhưng ADR-001 đang giới hạn DO, nên phải sửa ADR trước.

## Câu hỏi còn mở

- User chấp nhận phương án 4, hay vẫn muốn có chat ngay trong web CRM?

## Cập nhật 14:55 — user chọn gom về một nền tảng

User từ chối phương án 4: muốn chat nội bộ, công việc và agent đều nằm trong CRM. Quyết định này thay dòng "Chat nội bộ: Lark là nguồn" (`docs/decisions/business-decisions-v1.md:129`) và cần sửa ADR-001 (cho phép Durable Objects ngoài MVP3). Kongming soát: GO, theo thứ tự giai đoạn dưới đây.

### Hướng chốt

1. **Công việc trước:** mở rộng bảng `task` (việc nội bộ không gắn lead, loại việc, ưu tiên, việc con), mỗi việc có luồng bình luận riêng; sau đó mới làm Kanban (dnd-kit, MIT). Giữ CHECK và test cho quy tắc lead đang mở phải có việc tiếp theo.
2. **Kênh chat:** bảng `channel`, `channel_member`, `chat_message` trong D1 (D1 là bản chuẩn), luồng trả lời theo chủ đề như Zulip. Realtime bằng một Durable Object cho mỗi kênh, dùng WebSocket Hibernation theo mẫu cloudflare/workers-chat-demo (BSD-3). DO không lưu tin; mở lại trang thì tải lịch sử từ D1. Viết bản sửa ADR-001 ngay đầu giai đoạn này.
3. **Agent là thành viên kênh:** gọi `@agent` sẽ xếp một lượt GoClaw qua hàng lệnh D1 và bridge sẵn có (ADR-010), phiên theo kênh/luồng. Mỗi agent có tài khoản bot riêng và token riêng, không dùng quyền của người gọi; mọi lệnh ghi lưu `requested_by` là người gọi; việc đụng tiền, chủ lead hoặc stage phải người xác nhận. Thêm công cụ MCP `create_task`, `update_task`, `post_message`. Hiện trạng thái agent theo lần bridge nhận lệnh gần nhất; hết hạn lease thì báo "agent đang offline".
4. **Thông báo:** Web Push cho PWA; thông báo duyệt gửi song song qua Lark cho tới khi Web Push chạy ổn trên iPhone, rồi mới hạ Lark xuống vai trò phụ.

### Vì sao không dùng polling

18 người hỏi máy chủ mỗi 5 giây trong 10 giờ là khoảng 130 000 request/ngày, vượt giới hạn 100 000 của gói miễn phí. Durable Objects có trên gói miễn phí (bản SQLite), tin nhắn WebSocket ở chế độ ngủ chỉ tính 1/20 request.

### Phương án đã loại

- Tự host Huly, Rocket.Chat hoặc Mattermost làm nền tảng chung: cần máy chủ, thêm một hệ tài khoản, dữ liệu CRM nằm ngoài.
- Lấy Lark làm nền tảng chung: có nhân viên không dùng Lark, không ép được quy tắc việc tiếp theo.

### Rủi ro

- Làm hai sản phẩm cùng lúc; giữ đúng thứ tự giai đoạn.
- Số lần ghi D1 (tin nhắn, đánh dấu đã đọc); gộp và giãn nhịp đánh dấu đã đọc.
- Agent phụ thuộc máy Windows chạy GoClaw; nếu máy hay tắt trong giờ làm, giai đoạn 3 nên chờ VPS.
- Web Push trên iPhone yêu cầu cài PWA vào màn hình chính.

## Cập nhật 15:00 — user trả lời

1. Bỏ hẳn Lark.
2. Cần chat nhóm, chat riêng 1-1 và bình luận trong việc.
3. Mở MCP cho từng tài khoản để agent ngoài (Claude Code, Codex, Antigravity) tự đọc chat của người dùng và việc người dùng cần làm.

Kongming soát: GO, kèm các điều chỉnh sau.

### MCP cho từng tài khoản

- Trang tự phục vụ "Kết nối agent": người dùng tự tạo token (hiện một lần, có nhãn, hết hạn mặc định 90 ngày), xem lần dùng gần nhất, thu hồi, xoay token; có sẵn đoạn cấu hình chép cho Claude Code, Codex, Antigravity. Admin vẫn có nút tắt toàn bộ (`admin-routes.ts:79`).
- Giữ cổng hiện có (`mcp-routes.ts`: Bearer lưu hash, chặn request có Origin). Thêm cột `scope` và `expires_at` vào `agent_token`.
- Hai mức quyền: `read` (mặc định) và `read+tasks` (tạo, hoàn thành, bình luận việc của mình). Token đọc chat không được gửi tin và không được sửa lead.
- Công cụ đọc: `list_conversations` (kênh và chat riêng mình là thành viên), `read_messages` (phân trang theo con trỏ), `search_messages` (giới hạn tần suất), `my_tasks`, `get_task` kèm bình luận.
- Nội dung tin nhắn trả về có nhãn "nội dung chat, không tin cậy" và lời nhắc không làm theo lệnh trong tin, để giảm rủi ro chèn lệnh.
- Mỗi lần đọc chat ghi audit kèm mã hội thoại.
- Riêng tư chat 1-1: thông báo chung "chat có thể được agent của thành viên đọc", và mỗi hội thoại có công tắc `agent_readable` (mặc định bật) để người còn lại tắt.

### Bỏ Lark — danh sách cần chuyển

- Thông báo duyệt (`approval-notify.ts`, `lark.ts`) sang thông báo trong CRM và Web Push.
- Lệnh `send_lark` trong hàng lệnh (`inbox/conversation-flow.ts`, bridge `command-runner.ts`) và thông báo chuyển người của inbox sang kênh CRM.
- Ô nhóm Lark ở `inbox-settings.tsx`, biến môi trường Lark ở `env.ts`, phần khớp email Lark ở `admin-users.tsx`, test `lark-link` và `approval-notify`.
- Bot nhân viên GoClaw trên Lark chuyển thành agent trong kênh CRM.
- Giữ cột `lark_open_id` (cho phép trống), không xóa cột trong migration; chỉ xóa mã Lark sau khi chuyển xong.

### Thứ tự giai đoạn

1. Công việc: mở rộng `task` và bình luận việc.
2. Chat: kênh nhóm, chat riêng, Durable Object theo hội thoại; sửa ADR-001 và dòng chat nội bộ trong business-decisions.
3. Thông báo trong CRM và Web Push; chuyển thông báo duyệt.
4. Chuyển thông báo inbox và bot nhân viên GoClaw vào kênh CRM.
5. Xóa Lark.
6. Trang "Kết nối agent" và công cụ đọc MCP; sau đó mức `read+tasks`.

### Câu hỏi còn mở

- Người còn lại trong chat 1-1 có được tắt quyền agent đọc hội thoại đó không (đề xuất: có, mặc định bật)?
