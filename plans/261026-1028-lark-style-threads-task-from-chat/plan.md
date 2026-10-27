---
title: "Chat CRM kiểu Lark: trả lời trích dẫn, chuỗi, chủ đề, nhóm phòng ban, tạo việc từ chat"
description: "Hai kiểu trả lời (trích dẫn và theo chuỗi) có khung chuỗi riêng, người theo dõi và tab Chuỗi; nhóm phòng ban tự đồng bộ có nhóm nhỏ; chế độ Chủ đề; Trợ lý soạn việc nháp từ một tin hoặc một chuỗi, người bấm xác nhận mới tạo."
status: in-progress
priority: P2
effort: 10d
branch: main
tags: [feature, backend, frontend, database, realtime, mcp, chat]
blockedBy: []
blocks: []
created: 2026-10-26
---

# Chat CRM kiểu Lark: chuỗi, chủ đề, nhóm phòng ban, tạo việc từ chat

Status: in-progress (đã deploy 27/10, chờ user kiểm live) · Owner: Opus (giao việc, soát, chạy mọi thao tác remote) · Executor: Claude `fullstack-developer`, mỗi phase một lần chạy (Agy hết quota đến khoảng 01/11/2026) · Không gọi kongming: gặp lỗi thì dừng và báo BLOCKED cho Opus.

Hợp đồng gốc: [brainstorm-261026-1028-lark-style-threads.md](../reports/brainstorm-261026-1028-lark-style-threads.md) · Nghiên cứu Lark: [researcher-261026-1023-lark-threads-topics.md](../reports/researcher-261026-1023-lark-threads-topics.md) · Plan trước (đã deploy bản `62d61a57`): [261025-1500-internal-chat-tasks-agents](../261025-1500-internal-chat-tasks-agents/plan.md)

## Mục tiêu
- **Trả lời** là trả lời trích dẫn và nằm ngay trong chat chính. **Trả lời theo chuỗi** mở khung chuỗi riêng, nên chat chính không bị trôi. Dưới tin gốc có thẻ chuỗi. Khi trả lời trong chuỗi có ô "Cũng gửi vào nhóm". Người theo dõi chuỗi nhận thông báo và có số chưa đọc riêng. Có thêm tab "Chuỗi".
- **Nhóm phòng ban** tự tạo và tự đồng bộ thành viên theo phòng ban. Dưới mỗi nhóm phòng ban có **nhóm nhỏ**, thành viên nào của phòng ban cũng tạo được. Vẫn giữ nhóm thường, chat riêng và nhóm Inbox.
- **Chế độ Chủ đề**: chủ nhóm bật trong cài đặt nhóm. Khi bật, mỗi tin mới là một chủ đề. Chủ đề đóng và mở lại được.
- **Tạo việc từ chat**: từ một tin hoặc cả một chuỗi, Trợ lý soạn **một** việc nháp ngay tại chỗ. Người yêu cầu sửa rồi bấm "Tạo việc" một lần. Việc có link "Tạo từ chat", thẻ việc được đăng lại vào đúng chỗ. Khi Trợ lý offline thì vẫn tạo tay được.
- **MCP** hiểu chuỗi: `read_messages` trả thêm id chuỗi và lọc được theo chuỗi.

## Quyết định đã chốt (không đổi khi làm)
User chốt ngày 26/10/2026:
1. Nhóm phòng ban **tự tạo, tự đồng bộ** theo `app_user.department_id`. Việc đồng bộ chạy trong cùng lần lưu của lệnh nhập file, sửa người dùng và khóa/mở khóa. Ngoài ra có bước kiểm tra lại mỗi lần gọi `GET /api/chat/conversations` (một `db.batch`).
2. **Thành viên nào của phòng ban** (và BGĐ/Admin) cũng tạo được nhóm nhỏ dưới nhóm phòng ban, và mời được người ở phòng ban khác.
3. **Có cả hai chế độ**: nhóm thường (trả lời trích dẫn và chuỗi) và chế độ "Chủ đề". Chủ nhóm, BGĐ hoặc Admin chuyển chế độ. Chủ đề đóng và mở lại được. Tin cũ giữ nguyên.
4. **Việc nháp hiện tại chỗ**. Người yêu cầu sửa rồi bấm tạo một lần. Server tạo việc qua `createTask`, thêm `task_member`, lưu nguồn, đăng thẻ việc vào chuỗi (hoặc trả lời trích dẫn tin gốc), và gửi thông báo. Agent không tự tạo việc. Agent nhóm vẫn không có công cụ CRM. Không có Trợ lý thì tạo tay, kết quả như nhau.

**Khác Lark**: Lark không có nhóm cha/con, mọi nhóm đứng riêng lẻ. Ở CRM, nhóm nhỏ nằm dưới nhóm phòng ban vì user yêu cầu. Chỉ có một cấp lồng.

Planner chốt (có lý do, xem từng phase):
- Dữ liệu theo Lark Open API. `chat_message.reply_to_message_id` là tin được trích dẫn (tương ứng `parent_id` của Lark). `chat_message.thread_root_id` là gốc chuỗi (tương ứng `thread_id`). `also_in_main` là cờ "Cũng gửi vào nhóm". Bảng `chat_thread` có khóa chính là `root_message_id`, lưu số trả lời, `last_activity_at`, `closed_at` và `is_topic`. Bảng `chat_thread_follower` có `via`, `muted` và `last_read_at`.
- `chat_conversation` thêm ba cột: `parent_conversation_id` (chỉ trỏ tới nhóm phòng ban), `department_id` (unique một phần; nhóm phòng ban có id `dept:<department_id>` và `system_key 'dept:<department_id>'`) và `mode ('chat'|'topic')`.
- **Câu trả lời cũ (`parent_message_id`) đổi thành trả lời trích dẫn**: `reply_to_message_id = parent_message_id`. Lý do: không tin nào biến khỏi chat chính, cách này đúng với mọi loại hội thoại (bình luận việc không có chuỗi), và chỉ cần một lệnh UPDATE. Cột `parent_message_id` giữ lại làm lịch sử, code không đọc nữa.
- Chỉ chat chính tính chưa đọc của hội thoại: tin gốc, hoặc tin có `also_in_main = 1`. Trả lời chỉ trong chuỗi thì không làm hội thoại nhảy lên đầu danh sách. Chưa đọc của chuỗi tính theo từng người theo dõi.
- Chuỗi có trong nhóm và chat riêng. Bình luận việc (`kind='task'`) chỉ có trả lời trích dẫn.
- Thêm loại thông báo `chat_thread`. Cần dựng lại bảng `notification` vì CHECK; bảng không có khóa ngoại trỏ vào, làm theo mẫu 0025.
- Nguồn của việc lưu ở ba cột thêm vào `task` (`source_conversation_id`, `source_message_id`, `source_scope 'message'|'thread'`), không có khóa ngoại. Lý do: quan hệ 1-1 nên không cần join, và test reset xóa bảng chat trước bảng task.
- Thẻ đề xuất việc dùng khối `[TASK] … [/TASK]` viết theo dạng `khóa: giá trị`, mô tả được nhiều dòng. Dạng này bền hơn JSON vì agent ít khi viết sai, và Worker vẫn đọc được dòng `[TASK: …]` kiểu cũ. Tên người được khớp theo tên hiển thị đã bỏ dấu, chỉ trong thành viên hội thoại. Tên trùng nhau hoặc không khớp thì để nguyên dạng chữ cho người yêu cầu sửa.
- Thông báo khi tạo việc: người làm chính nhận như hiện nay. Người cùng làm nhận `task_assigned` với **mọi** việc mới (hiện họ không được báo gì). Xem câu hỏi mở 5.
- Sự kiện realtime vẫn chỉ chứa id. Sự kiện mới: `thread.updated { conversationId, rootId, messageId? }`, gửi tới mọi thành viên hội thoại.

## Phase
| # | Phase | Executor | Phụ thuộc | Trạng thái |
|---|-------|----------|-----------|------------|
| 01 | [Mô hình dữ liệu và trả lời trích dẫn (backend)](phase-01-data-model-quote-reply.md) | Claude | mốc commit (câu hỏi 1) | done |
| 02 | [Chuỗi: người theo dõi, chưa đọc, thông báo, realtime (backend)](phase-02-threads-backend.md) | Claude | 01 | done |
| 03 | [Nhóm phòng ban, nhóm nhỏ, chế độ Chủ đề (backend)](phase-03-department-groups-topics-backend.md) | Claude | 02 | done |
| 04 | [Tạo việc từ chat: nguồn, tạo tay, thẻ việc, thông báo (backend)](phase-04-task-from-chat-backend.md) | Claude | 03 | done |
| 05 | [Trợ lý soạn việc nháp, @Trợ lý trong chuỗi, MCP hiểu chuỗi](phase-05-agent-drafts-mcp-threads.md) | Claude | 04 | done |
| 06 | [Web: trích dẫn, khung chuỗi, thẻ chuỗi, tab Chuỗi](phase-06-web-quote-threads.md) | Claude | 02 (chạy song song với 03–05 được) | done |
| 07 | [Web: cây Phòng ban → nhóm nhỏ, cài đặt nhóm, chế độ Chủ đề](phase-07-web-groups-topics.md) | Claude | 03, 06 | done |
| 08 | [Web: tạo việc từ chat, thẻ nháp, thẻ việc, link "Tạo từ chat"](phase-08-web-task-from-chat.md) | Claude | 05, 07 | done |
| 09 | [Tài liệu: ADR-012, hướng dẫn chat tiếng Việt, prompt GoClaw](phase-09-docs.md) | Claude | 05, 08 | done |
| 10 | [Phát hành: sao lưu, migration remote, deploy, kiểm tra live](phase-10-release.md) | Opus | 01–09 | in-progress (chờ user: 10.5, 10.6) |

Thứ tự chạy: 01 → 02 → 03 → 04 → 05. Phase 06 được chạy song song với 03–05 vì chỉ sửa file trong `src/web/**` và `test/web-chat.test.ts`, không đụng file worker nào. Sau đó chạy 07 → 08 → 09 → 10. Các phase backend chạy nối tiếp vì cùng sửa `chat.ts`, `chat-routes.ts` và `chat-agents.ts`.

Migration: chỉ có `0031_lark_threads_groups.sql` (phase 01, gồm mọi cột và bảng mới). Các phase sau không thêm migration.

## Luồng dữ liệu
- **Gửi tin** `POST /api/chat/conversations/:id/messages { id, body, replyToMessageId?, threadRootId?, alsoSendToMain?, attachmentIds? }`. Server kiểm tra quyền và tin gốc/tin được trích dẫn, ghi tin vào `chat_message`, rồi chạy một batch: cập nhật hội thoại (nếu tin thuộc chat chính), cập nhật `chat_thread` và tăng số đếm, ghi người theo dõi và mốc đã đọc của người gửi. Tiếp theo gửi sự kiện ChatHub (`message.created` và/hoặc `thread.updated`), gửi thông báo (`chat_mention` > `chat_direct` > `chat_thread`, mỗi người chỉ nhận một loại), và xếp lượt agent nếu có @Trợ lý.
- **Đọc** `GET /messages` trả chat chính kèm khối trích dẫn và tóm tắt chuỗi. `GET /threads/:rootId` trả tin gốc và các trả lời. `GET /threads` là tab Chuỗi. `GET /conversations/:id/topics` là danh sách chủ đề. `GET /messages/:id/context` dùng để nhảy tới tin cũ.
- **Nhóm phòng ban**: các lệnh lưu `app_user` chạy thêm câu SQL đồng bộ trong cùng `GuardedTx`. `GET /conversations` chạy lại cùng các câu đó trong một `db.batch`.
- **Tạo việc từ chat**: `POST /conversations/:id/task-drafts` trả `{mode:'agent'}` (đã xếp lượt GoClaw) hoặc `{mode:'manual', draft}`. Trợ lý trả lời có khối `[TASK]`, Worker lưu thành `meta.taskDrafts` của tin agent. Người yêu cầu gọi `POST /api/commands/createTask` kèm `source` (và `draft` nếu có). Một batch ghi việc, `task_member`, đánh dấu nháp đã dùng (có assert để chỉ tạo được một lần) và outbox. Sau commit, `notifyCommitted` gửi `task_assigned` cho người làm và người cùng làm, rồi đăng thẻ việc `task-card:<taskId>` vào chuỗi hoặc thành trả lời trích dẫn.

## Tiêu chí nghiệm thu
Xem 15 tiêu chí đánh số trong [brainstorm](../reports/brainstorm-261026-1028-lark-style-threads.md#tiêu-chí-nghiệm-thu-đánh-số-kiểm-được). Mỗi phase ghi rõ mình chứng minh tiêu chí nào. Phase 10 kiểm tra live toàn bộ.

## Ma trận test
| Lớp | Nội dung | File |
|-----|----------|------|
| Unit (pure) | Bộ đọc khối `[TASK]`, khớp tên, tạo nháp tay, dựng cây danh sách chat, tạo link sâu | `test/chat-task-markers.test.ts`, `test/web-chat.test.ts` |
| Tích hợp (Worker + D1 thật) | Trả lời trích dẫn, ngữ cảnh tin, chuỗi, người theo dõi, chưa đọc, thông báo, đóng chủ đề, đồng bộ phòng ban, nhóm nhỏ, chế độ, tạo việc từ chat, chỉ tạo một lần, agent trong chuỗi, MCP | `test/chat.test.ts`, `test/chat-threads.test.ts`, `test/chat-groups.test.ts`, `test/chat-task-from-chat.test.ts`, `test/chat-agents.test.ts`, `test/mcp-chat-tools.test.ts`, `test/admin-users.test.ts` |
| Ngân sách | ≤40 truy vấn D1 mỗi lần gửi tin (trường hợp nặng nhất) và cron ≤40 | `test/chat-threads.test.ts`, `test/notifications.test.ts` |
| E2E (live, phase 10) | Hai tài khoản trên hai thiết bị, điện thoại và máy tính | báo cáo deploy |

## Rủi ro
| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|--------|----------------------|------------|
| Dựng lại bảng `notification` làm mất thông báo | Thấp × Trung bình | Dùng bảng backup trong migration, đếm số dòng trước và sau. Phase 10 sao lưu D1 và lấy bookmark Time Travel |
| Gửi tin vượt 50 truy vấn D1 | Trung bình × Cao | Gộp ghi vào một `db.batch`. Test đo ≤40 ở trường hợp nặng nhất |
| Lệnh đồng bộ phòng ban xóa nhầm thành viên | Thấp × Cao | Viết SQL theo tập hợp, chỉ áp vào hội thoại có `department_id`. Test cho đổi phòng ban, khóa, mở khóa |
| Tạo việc hai lần từ cùng một nháp | Trung bình × Thấp | `tx.assert` kiểm tra nháp chưa dùng, nằm cùng batch với lệnh ghi việc. Có thêm Idempotency-Key |
| Thẻ việc lộ tiêu đề việc cho thành viên nhóm không xem được việc | Trung bình × Thấp | Thẻ chỉ có tiêu đề, người làm và hạn, vốn lấy từ chính nội dung nhóm đó. Link mở việc vẫn kiểm tra quyền |
| Agent ghi sai khối `[TASK]` | Trung bình × Thấp | Bộ đọc chịu lỗi. Tên không khớp để nguyên chữ. Người yêu cầu luôn sửa được trước khi tạo |
| Web lệch API giữa các phase | Thấp × Thấp | Không deploy giữa chừng. Server nhận `parentMessageId` như tên cũ của `replyToMessageId` |
| Code của plan trước chưa commit nên khó lùi | Cao × Trung bình | Câu hỏi mở 1: commit làm mốc trước phase 01 (cần user đồng ý) |

## Tương thích ngược và cách lùi
- Migration 0031 chỉ thêm cột và bảng, và đổi dữ liệu theo một chiều (`reply_to_message_id` được chép từ `parent_message_id`, giá trị gốc vẫn giữ). Worker cũ `62d61a57` vẫn chạy được trên schema mới: nó bỏ qua cột mới, còn bảng `notification` dựng lại có đủ cột cũ. Khi lùi về Worker cũ, câu trả lời trong chuỗi tạo sau khi phát hành sẽ hiện như tin thường, chấp nhận được.
- API: `parentMessageId` vẫn được nhận và hiểu là `replyToMessageId`. MCP `parent_id` vẫn còn và mang nghĩa như Lark: tin được trả lời, hoặc gốc chuỗi.
- Lùi từng phase trước khi phát hành: bỏ phần thay đổi của phase đó (`git diff` so với mốc). Lùi sau khi phát hành: `npx wrangler rollback` về bản trước. Bookmark Time Travel chỉ dùng khi user đồng ý (xem phase 10).

## Quy tắc cho executor (lặp lại trong từng phase)
- Không `git commit`, không deploy, không `wrangler --remote`, không chạy dev server nền.
- Chỉ sửa file được liệt kê trong phase. Làm việc ở `D:\TQD\CRM`, shell PowerShell, có `pnpm`.
- Gói FREE: mỗi request hoặc lần chạy cron tối đa 50 truy vấn D1 (một `db.batch` tính là 1) và 50 subrequest. Plan tự đặt trần 40. Không gọi `.run()` trong vòng lặp từng dòng.
- Bước Verify không đạt thì làm theo Failure Protocol của phase: DỪNG, báo BLOCKED cho Opus kèm lệnh và output đầy đủ. Không gọi kongming. Không tự sửa vòng quanh lỗi.
- Không ghi mã plan, số phase hay mã audit vào comment, tên test hay tên migration.

## Ảnh hưởng tới tài liệu
Cập nhật ADR-012 (chuỗi, chủ đề, nhóm phòng ban, tạo việc từ chat). Thêm hướng dẫn tiếng Việt mới `docs/guides/chat-user-guide.md`. Sửa `docs/integrations/goclaw-inbox-agents.md` (prompt và khối `[TASK]`) và `docs/README.md`. Làm ở phase 09.

## Câu hỏi còn mở
1. ~~Commit code plan trước làm mốc~~: đã xong, code plan trước nằm trong commit `dfe6e20` và đã push.

Advisor chốt mặc định cho câu 2–6 (user có thể đổi sau): không có nhóm toàn công ty; BGĐ/Admin không tự vào nhóm phòng ban; chủ đề xếp theo hoạt động gần nhất; người cùng làm được báo với mọi việc mới; người rời phòng ban vẫn ở lại nhóm nhỏ.

2. Có cần nhóm "Toàn công ty" tự đồng bộ không? Plan mặc định là không.
3. BGĐ và Admin có tự vào mọi nhóm phòng ban không? Plan mặc định là không, giống Lark.
4. Chủ đề xếp theo hoạt động gần nhất (đang chọn) hay theo thời điểm tạo?
5. Người cùng làm nhận thông báo với mọi việc mới, không chỉ việc tạo từ chat. Bạn có đồng ý không?
6. Người rời phòng ban vẫn ở lại các nhóm nhỏ được mời. Bạn có đồng ý không?
