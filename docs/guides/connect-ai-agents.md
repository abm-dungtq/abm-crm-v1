# Kết nối Claude Code, Codex, Antigravity với CRM

Mỗi người tự tạo token MCP để agent AI trên máy mình đọc chat và việc của chính mình trong CRM. Agent chỉ làm được những gì bạn được làm, và không bao giờ gửi được tin vào chat nhóm hay chat riêng.

## Tạo token

1. Bấm ảnh đại diện ở góc phải, chọn **Kết nối agent** (trang `/settings/agents`).
2. Ở **Tạo token**, đặt tên gợi nhớ (ví dụ "Claude Code trên laptop"), chọn quyền và hạn dùng (30, 90 hoặc 180 ngày; mặc định 90).
   - **Chỉ đọc**: đọc hội thoại, tìm tin, xem việc và lead trong phạm vi của bạn.
   - **Đọc + quản lý việc của tôi**: thêm tạo việc, sửa việc, hoàn thành việc và bình luận trong luồng việc.
3. Bấm **Tạo token**. Token chỉ hiện **một lần**: chép ngay cấu hình cho agent của bạn. Đóng hộp là không xem lại được.

Mỗi người có tối đa 5 token đang dùng; token đã hết hạn không tính.

## Dán cấu hình vào agent

Trang tạo token điền sẵn địa chỉ và token vào ba mẫu dưới đây. `<URL>` là địa chỉ MCP của CRM (dạng `https://.../api/mcp`), `<TOKEN>` là token vừa tạo.

- **Claude Code**: chạy trong terminal
  `claude mcp add --transport http abm-crm <URL> --header "Authorization: Bearer <TOKEN>"`
- **Codex**: thêm vào `~/.codex/config.toml`

  ```toml
  [mcp_servers.abm-crm]
  url = "<URL>"
  bearer_token_env_var = "ABM_CRM_TOKEN"
  ```

  rồi trên Windows chạy `setx ABM_CRM_TOKEN "<TOKEN>"` và mở lại terminal.
- **Antigravity**: thêm vào `mcp_config.json`

  ```json
  { "mcpServers": { "abm-crm": { "serverUrl": "<URL>", "headers": { "Authorization": "Bearer <TOKEN>" } } } }
  ```

## Agent làm được và không làm được gì

| Công cụ | Chỉ đọc | Đọc + quản lý việc |
| --- | --- | --- |
| `list_conversations`, `read_messages`, `search_messages` | có | có |
| `my_tasks`, `get_task`, `whoami`, `search_leads`, `get_lead`, `dashboard_summary` | có | có |
| `create_task`, `update_task`, `complete_task`, `comment_task` | không | có |
| Gửi tin vào chat nhóm hoặc chat riêng | không | không |
| Tạo hoặc sửa lead, đổi stage, giao lead | không | không |

- Agent chỉ thấy hội thoại bạn tham gia và luồng bình luận của việc bạn xem được. Mỗi lần đọc hoặc tìm tin đều được ghi nhật ký (chỉ ghi số tin, không ghi nội dung).
- Tìm tin chỉ trong 90 ngày gần nhất, tối đa 30 lần mỗi 10 phút.
- Khi Admin bật công tắc tạm khóa bot, agent không đọc được chat và không ghi được gì.
- Nội dung tin nhắn được gửi tới nhà cung cấp AI của agent bạn dùng. Không chia sẻ token cho người khác.

## Thu hồi hoặc xoay token

Trên trang **Kết nối agent**, ở bảng **Token của tôi**:

- **Xoay token**: tạo token mới cùng tên, cùng quyền, cùng thời hạn; token cũ ngừng chạy ngay. Dùng khi nghi lộ token hoặc mất cấu hình.
- **Thu hồi**: token ngừng chạy ngay, agent nhận lỗi 401.

Token hết hạn cũng bị từ chối; tạo token mới khi cần. Khi Admin khóa tài khoản, mọi token của bạn ngừng chạy. Khóa tạm 15 phút do nhập sai mật khẩu không chặn token.

## Tắt cho agent đọc một chat riêng

Mở chat riêng đó trong mục **Chat**, tắt công tắc **Cho agent đọc hội thoại này**. Chỉ cần một trong hai người tắt là agent của cả hai người không đọc được hội thoại đó nữa (kể cả khi tìm tin).
