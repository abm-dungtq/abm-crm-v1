# GoClaw: kết nối kênh Lark

Ngày: 2026-10-04. Người yêu cầu: user (admin GoClaw).

## Đã làm

- Backup DB GoClaw trước thay đổi: `D:\Goclaw\backups\goclaw-db-before-lark-20261004-094832.dump` (pg_dump custom format).
- App ID và App Secret lưu tại `D:\Goclaw\data\lark-app.local.txt` (ngoài repo). Secret đã lộ trong lịch sử chat, nên cần reset rồi cập nhật lại kênh.
- Tạo channel instance `abm-lark` (id `01a104d0-9917-7a78-806f-8a281a0b4dd4`), loại `feishu`, domain `lark` (open.larksuite.com), kết nối websocket, gắn agent `tqd`. DM và nhóm để `open` (tenant không có người ngoài); trong nhóm bot chỉ trả lời khi được @mention.
- Log GoClaw: `lark ws: connected`.
- Kiểm qua Lark API: lấy token được; bot `DungTQ_Agent` đang hoạt động; thấy 5 nhóm: ABM | TEAM GV - KD - SUPPORT - TRAO ĐỔI CHUNG; ABM | R&D - KỸ THUẬT - TOOLS - WEB; ABM | TRAO ĐỔI CHUNG; ABM | BÁO CÁO NGÀY; ABM | KHAI THÁC ỨNG DỤNG ANTIGRAVITY.

## Quyền admin (user xác nhận 2026-10-04)

User xác nhận admin duy nhất là người đang chat với GoClaw trên Lark (open_id `ou_0b7b5bd8a58294b0d9bcac85ea8c6a8a`); các thành viên khác không có quyền admin.

- `config.json`: `gateway.owner_ids` = `system`, `ou_0b7b5bd8a58294b0d9bcac85ea8c6a8a` (backup `D:\Goclaw\backups\config-before-lark-owner-*.json`). Gateway không bật config watcher, nên có hiệu lực sau khi khởi động lại GoClaw.
- Writer (`file_writer`) ở 5 nhóm `group:abm-lark:<chat_id>` chỉ gồm admin; DB `agent_config_permissions` không có dòng wildcard `*`. Người khác vẫn chat được nhưng không `/reset`, `/addwriter` hay sửa file agent trong nhóm.
- Quản trị dashboard/API chỉ bằng Gateway Token, do user giữ.
- `start-goclaw.ps1` đặt `GOCLAW_OWNER_IDS` (ghi đè config.json), nên đã sửa thành `system,ou_0b7b5bd8a58294b0d9bcac85ea8c6a8a` (backup `D:\Goclaw\backups\start-goclaw-before-lark-owner-*.ps1`). Khởi động lại 10:03 ngày 2026-10-04, ngắt 6,6 giây; sau đó `lark ws: connected`, `telegram bot connected`, health 200.

## Chưa được

- Đọc thành viên nhóm: Lark từ chối vì app thiếu một trong các scope `im:chat:readonly`, `im:chat.members:read`.
- Đọc danh bạ/phòng ban: `no dept authority` (phạm vi dữ liệu danh bạ của app chưa gồm toàn công ty).
- Hermes: trên máy này gateway Hermes chỉ kết nối Telegram, không có cấu hình Lark để gỡ.

## Rollback

Xóa kênh: `DELETE /v1/channels/instances/01a104d0-9917-7a78-806f-8a281a0b4dd4` bằng admin token, hoặc tắt `enabled`. Khôi phục DB khi cần: `pg_restore` từ file backup trên.
