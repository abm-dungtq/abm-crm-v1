---
title: "Chat nội bộ, quản lý công việc và agent trong CRM (bỏ Lark)"
description: "Gom chat nhóm, chat riêng, bình luận việc, quản lý công việc và agent vào web CRM; thông báo bằng Web Push; bỏ Lark; mở MCP theo từng tài khoản cho Claude Code, Codex, Antigravity đọc chat và việc."
status: in_progress
priority: P2
effort: 12d
branch: main
tags: [feature, backend, frontend, database, realtime, mcp]
blockedBy: []
blocks: []
created: 2026-10-25
---

# Chat nội bộ, công việc và agent trong CRM

Status: in_progress · Owner: Opus (giám sát, chạy mọi việc remote) · Executor: Agy `gemini-4-argon-high` (phase 01–04a); Claude fullstack-developer for 04b–06 because Agy ran out of quota on 2026-10-26 · Chế độ: `--advice` (mỗi phase có Failure Protocol)

## Mục tiêu
Nhân viên làm mọi việc nội bộ trên một nền tảng là web CRM:
- Chat nhóm, chat riêng 1-1, và bình luận trong từng việc. Tin hiện ngay nhờ WebSocket.
- Quản lý việc gồm việc gắn lead và việc nội bộ, có ưu tiên, việc con, người cùng làm, danh sách và Kanban.
- Thông báo hiện trong CRM và đẩy lên điện thoại/máy tính bằng Web Push.
- Agent GoClaw tham gia: chat riêng với "Trợ lý" (dùng quyền của chính người đó, như bot Lark hiện nay); gọi `@Trợ lý` trong nhóm để hỏi đáp và đề xuất tạo việc, người bấm xác nhận.
- Mỗi người tự tạo token MCP để Claude Code, Codex, Antigravity đọc chat và việc của mình.
- Bỏ hẳn Lark.

Hợp đồng gốc: `plans/reports/brainstorm-261025-1447-internal-chat-task-repos.md` (phần "Cập nhật 14:55" và "Cập nhật 15:00").

## Quyết định đã chốt (không đổi khi làm)
- D1 là bản chuẩn của mọi tin nhắn, việc, thông báo. Durable Object chỉ chuyển tiếp sự kiện, không lưu tin.
- **Một Durable Object `ChatHub` cho cả tổ chức** (`idFromName(organization_id)`), mỗi người một WebSocket, gắn tag `userId`, dùng WebSocket Hibernation. Lý do: 18 người, mỗi tin chỉ cần 1 request tới DO, mỗi trình duyệt chỉ cần 1 socket cho mọi hội thoại. (Khác gợi ý "một DO mỗi kênh" của vòng soát trước; kongming soát lại ở phase 02.)
- Bảng chat có tiền tố `chat_` để không đụng bảng `conversation`/`message` của inbox khách hàng.
- Bình luận việc là một hội thoại `kind='task'`, dùng chung bảng tin nhắn với chat.
- Tin nhắn không đi qua `runCommand`/audit (tránh chép nội dung chat vào audit). Việc (`task`) đi qua command như hiện nay.
- Quy tắc lead đang mở luôn có việc tiếp theo giữ nguyên: việc `kind='crm'` bắt buộc `lead_id` và `due_at`; trạng thái `in_progress` chỉ cho việc `kind='internal'`, nên mọi code lead hiện có (`status = 'open'`) không phải sửa.
- Agent trong nhóm **không có công cụ CRM**; chỉ trả lời từ nội dung hội thoại và đề xuất việc qua dòng marker `[TASK: ...]`; Worker hiện thẻ đề xuất, người gọi bấm "Tạo việc" mới tạo.
- Chat riêng với Trợ lý: GoClaw user id `crm-user:<app_user.id>`, credential MCP là token của chính người đó (ADR-004).
- Token MCP tự tạo có `scope` `read` (mặc định) hoặc `read_tasks`; token cũ (`goclaw`, `lms-publish`) là `legacy`, giữ hành vi hiện tại. Hết hạn mặc định 90 ngày. Không token nào gửi tin vào chat nhóm hoặc chat riêng; token tự tạo không sửa lead; mức `read_tasks` chỉ ghi bình luận trong luồng việc.
- Chat riêng có công tắc `agent_readable` (mặc định bật); một trong hai người tắt thì công cụ MCP không trả hội thoại đó.
- Thông báo: bảng `notification` + Web Push (thư viện `@block65/webcrypto-web-push`, MIT). Không retry push; thông báo trong CRM vẫn còn.
- Không xóa cột `lark_*` trong DB; chỉ xóa code và secret sau khi chuyển xong.
- Không dùng app_user role mới (CHECK role cần rebuild bảng). Agent là bảng `chat_agent` riêng.

## Phase
| # | Phase | Executor | Phụ thuộc | Trạng thái |
|---|-------|----------|-----------|------------|
| 01 | [Công việc: task engine, bình luận việc, Kanban](phase-01-task-engine.md) | Agy | — | completed |
| 02 | [Chat: nhóm, riêng, realtime ChatHub, tệp đính kèm, ADR](phase-02-chat-realtime.md) | Agy | 01 | completed |
| 03 | [Thông báo trong CRM và Web Push](phase-03-notifications-web-push.md) | Agy | 02 | completed |
| 04 | [Thông báo inbox và agent GoClaw vào chat CRM](phase-04-inbox-notices-chat-agents.md) | Agy | 03 | completed |
| 05 | [Xóa Lark](phase-05-remove-lark.md) | Agy | 04 | completed |
| 06 | [Kết nối agent: token MCP tự tạo và công cụ đọc chat/việc](phase-06-mcp-self-service.md) | Agy | 02 (chạy sau 05) | completed |
| 07 | [Phát hành: sao lưu, migration remote, secret, deploy, cấu hình GoClaw](phase-07-release.md) | Opus | 01–06 | in_progress (deploy xong 26/10, chờ user 7.4–7.8) |

Các phase chạy tuần tự 01 → 07: hầu hết cùng sửa `packages/contracts/src/index.ts`, `apps/crm/src/worker/index.ts`, `apps/crm/test/helpers/reset-db.ts` và thêm migration nối tiếp, nên không chạy song song.

Migration dự kiến: `0025_task_engine.sql` (01, gồm cả bảng chat lõi vì bình luận việc dùng chung bảng tin nhắn), `0026_chat_attachments.sql` (02), `0027_notifications.sql` (03), `0028_chat_agents.sql` (04), `0029_remove_lark_commands.sql` (05), `0030_agent_token_scope.sql` (06).

## Tiêu chí nghiệm thu
1. Tạo việc nội bộ không gắn lead, có ưu tiên, hạn (tùy chọn), người cùng làm, việc con; kéo thả giữa cột Cần làm / Đang làm / Xong trên Kanban.
2. Kéo việc gắn lead sang Xong thì bắt nhập việc tiếp theo như hiện nay; test chứng minh lead đang mở vẫn luôn có việc tiếp theo.
3. Bình luận trong việc, chat nhóm, chat riêng: tin của người A hiện bên B trong 2 giây mà không tải lại trang; tải lại trang thấy đủ lịch sử từ D1.
4. Được @nhắc tên hoặc nhận tin riêng thì có thông báo trong CRM và Web Push trên thiết bị đã bật.
5. Yêu cầu duyệt, giao việc, việc sắp đến hạn, mọi thông báo inbox trước đây gửi Lark nay đến bằng thông báo CRM hoặc nhóm "Inbox" trong chat CRM.
6. Chat riêng với Trợ lý trả lời bằng quyền của người đó; `@Trợ lý` trong nhóm trả lời và đề xuất việc, chỉ tạo khi người gọi bấm. Máy GoClaw tắt thì hiện "Trợ lý đang offline".
7. Không còn code gọi Lark (`grep -ri "larksuite\|lark.ts\|send_lark" apps/crm/src packages` không có kết quả); secret Lark đã xóa trên Worker.
8. Người dùng tự tạo token, chép cấu hình vào Claude Code/Codex/Antigravity, gọi `list_conversations`, `read_messages`, `search_messages`, `my_tasks`, `get_task` thành công; token `read` gọi công cụ ghi bị từ chối; token hết hạn/thu hồi bị 401; hội thoại tắt `agent_readable` không trả về.
9. `pnpm -r typecheck` và `pnpm -r test` exit 0.

## Quy tắc cho executor (lặp lại trong từng phase)
- Không `git commit`, không deploy, không `wrangler --remote`, không chạy dev server nền.
- Chỉ sửa file được liệt kê trong phase. Làm từ `D:\TQD\CRM`, shell PowerShell, có `pnpm`.
- Gặp bước Verify không đạt: làm theo Failure Protocol trong phase, không tự sửa vòng quanh.

## Rủi ro
- Rebuild bảng `task` (SQLite không bỏ được NOT NULL): làm theo mẫu `0006_learner_foundation.sql` (`PRAGMA defer_foreign_keys = ON`, bảng backup, drop, tạo lại, chép lại). Phase 07 sao lưu D1 trước.
- Giới hạn gói free: 100k request Worker/ngày, 100k request DO/ngày, 100k ghi D1/ngày. Không polling dày; đánh dấu đã đọc giãn 2 giây.
- Web Push trên iPhone chỉ chạy khi cài CRM ra màn hình chính (iOS 16.4+).
- Agent phụ thuộc máy Windows chạy GoClaw và bridge.
- Bỏ Lark làm mất bot Lark ngay khi phase 07 tắt; chỉ xóa secret sau khi kiểm thông báo CRM chạy.

## Câu hỏi còn mở
- Đã giải quyết 2026-10-25 22:30: advisor Opus (thay user theo ủy quyền) chốt công tắc `agent_readable` cho chat riêng — có, mặc định bật, một trong hai người tắt được.
