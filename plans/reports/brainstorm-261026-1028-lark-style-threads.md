# Brainstorm: chat CRM làm giống Lark (trả lời, chuỗi, chủ đề, nhóm phòng ban, tạo việc từ chat)

Ngày: 26/10/2026 · Người yêu cầu: user (dntu85) · Người soạn: planner (Opus) · Nghiên cứu: [researcher-261026-1023-lark-threads-topics.md](researcher-261026-1023-lark-threads-topics.md) · Plan: [261026-1028-lark-style-threads-task-from-chat](../261026-1028-lark-style-threads-task-from-chat/plan.md)

## Kết quả mong muốn

Chat nội bộ trong CRM dùng như Lark:
- Có hai cách trả lời. "Trả lời" là trích dẫn, câu trả lời nằm ngay trong chat chính. "Trả lời theo chuỗi" mở khung chuỗi riêng (bên phải trên máy tính, toàn màn hình trên điện thoại), nên chat chính không bị trôi.
- Công ty có nhóm phòng ban tự tạo và tự đồng bộ thành viên. Trong mỗi phòng ban có các nhóm nhỏ. Mọi nhóm đều chat được theo chuỗi, hoặc chuyển sang chế độ "Chủ đề".
- Từ một tin, hoặc từ cả một chuỗi/chủ đề, bấm "Tạo việc". Trợ lý soạn sẵn một việc nháp gồm tiêu đề, mô tả tóm tắt, người làm chính, người liên quan và hạn. Người bấm sửa rồi xác nhận, việc mới được tạo, có link quay về đoạn chat gốc. Khi Trợ lý offline thì vẫn tạo tay được.

Hiện tại câu trả lời bị thụt vào ngay dưới tin gốc trong chat chính. Kiểu này không phải trích dẫn, cũng không phải chuỗi thật. Đây là lỗi cần sửa.

## Ràng buộc

- Cloudflare Workers gói FREE: mỗi lần gọi (kể cả cron) tối đa 50 truy vấn D1 và 50 subrequest; 100k request/ngày; mẫu LIKE của D1 tối đa 50 byte. Plan tự đặt trần 40 truy vấn cho mỗi lần gửi tin và cho cron, có test đo.
- D1 `abm-crm-eval` là nguồn dữ liệu chuẩn. Durable Object `ChatHub` (một cho mỗi tổ chức) chỉ chuyển sự kiện chứa id.
- SQLite không bỏ được CHECK/NOT NULL nếu không dựng lại bảng. Ưu tiên `ADD COLUMN`; chỉ dựng lại bảng `notification` (để thêm loại `chat_thread`), làm theo mẫu 0025.
- Agent trong nhóm không có công cụ CRM và không bao giờ tự tạo việc.
- Giữ nguyên quy tắc `agent_readable` của MCP.
- Múi giờ Asia/Saigon. Chữ trên giao diện bằng tiếng Việt.
- Executor là Claude fullstack-developer (Agy hết quota đến khoảng 01/11/2026). Không gọi kongming. Opus chạy mọi thao tác remote.

## Không làm (non-goals)

- Chọn nhiều tin để tạo một việc, trích dẫn một phần chữ trong tin, chuyển tiếp chuỗi, nhãn/cờ cho chat, supergroup, sửa tin đã gửi.
- Nhóm nhỏ lồng nhiều cấp. Chỉ có một cấp: phòng ban → nhóm nhỏ.
- Nhóm toàn công ty tự đồng bộ (xem câu hỏi mở 2).
- Agent tự tạo việc, hoặc agent nhóm có công cụ CRM.
- Đổi `apps/zalo-bridge`.

## 4 quyết định của user (26/10/2026)

1. **Nhóm phòng ban tự tạo và tự đồng bộ** theo `app_user.department_id`. Vào phòng ban là vào nhóm, rời phòng ban hoặc bị khóa tài khoản là ra khỏi nhóm. Việc đồng bộ chạy cùng lúc với lệnh lưu người dùng (nhập file, sửa người dùng, khóa/mở khóa), và có thêm bước kiểm tra lại mỗi khi mở danh sách chat.
2. **Bất kỳ thành viên phòng ban nào** cũng tạo được nhóm nhỏ dưới nhóm phòng ban, và mời được đồng nghiệp ở cả phòng ban khác.
3. **Có cả hai chế độ**: nhóm thường (trả lời trích dẫn và chuỗi) và chế độ "Chủ đề". Chủ nhóm chuyển qua lại trong cài đặt nhóm. Chủ đề đóng và mở lại được. Tin cũ giữ nguyên.
4. **Việc nháp hiện ngay tại chỗ**, trong chuỗi hoặc dưới dạng trả lời cho tin gốc. Người yêu cầu sửa rồi bấm "Tạo việc" một lần. Việc có link nguồn, người liên quan được thêm vào việc, thẻ việc được đăng lại vào đúng chỗ, và người làm cùng người liên quan nhận thông báo. Không có Trợ lý thì vẫn tạo tay được.

**Khác Lark (theo yêu cầu của user)**: Lark không có nhóm cha/con, các nhóm đứng riêng lẻ. CRM lồng nhóm nhỏ dưới nhóm phòng ban vì user muốn danh sách chat đi theo sơ đồ tổ chức.

## Quyết định thiết kế đề xuất (planner)

- Câu trả lời cũ (`parent_message_id`) chuyển thành **trả lời trích dẫn**. Lý do: không tin nào bị ẩn khỏi chat chính, cách này đúng cho mọi loại hội thoại (kể cả bình luận việc, nơi không có chuỗi), và chỉ cần một lệnh UPDATE.
- Dữ liệu theo Lark Open API. `reply_to_message_id` là tin được trích dẫn (tương ứng `parent_id`). `thread_root_id` là gốc chuỗi (tương ứng `thread_id`). Bảng `chat_thread` lưu số trả lời, thời điểm hoạt động và trạng thái đóng. Bảng `chat_thread_follower` lưu người theo dõi, tắt báo và mốc đã đọc.
- Nguồn của việc lưu bằng ba cột thêm vào `task` (`source_conversation_id`, `source_message_id`, `source_scope`), không có khóa ngoại.
- Thẻ đề xuất việc dùng khối `[TASK] … [/TASK]` theo dạng `khóa: giá trị`. Vẫn đọc được dòng `[TASK: …]` kiểu cũ.

## Tiêu chí nghiệm thu (đánh số, kiểm được)

1. Bấm "Trả lời" thì gửi một tin trong chat chính, có khối trích dẫn (tên người gửi gốc và đoạn đầu tin). Trong nhóm, ô soạn tin có sẵn @tên người gửi gốc (xóa được). Bấm khối trích dẫn thì nhảy tới tin gốc và tô sáng, kể cả khi tin gốc chưa được tải. Tin gốc đã thu hồi thì hiện "Tin đã thu hồi".
2. Bấm "Trả lời theo chuỗi" thì mở khung chuỗi: bên phải khi màn hình rộng từ 861px, toàn màn hình trên điện thoại. Câu trả lời trong chuỗi không hiện ở chat chính. Dưới tin gốc có thẻ chuỗi gồm số trả lời, giờ trả lời cuối, chữ cái đầu tên của tối đa 3 người trả lời gần nhất, và nút "Xem chuỗi".
3. Tích "Cũng gửi vào nhóm" thì câu trả lời hiện ở cả chuỗi lẫn chat chính.
4. Người viết tin gốc, người trả lời và người được @nhắc trong chuỗi tự theo dõi chuỗi. Theo dõi, bỏ theo dõi và tắt báo đều dùng được. Người theo dõi (không tắt báo, không phải người gửi) nhận thông báo `chat_thread`. Người không theo dõi không nhận gì. Người được @nhắc nhận `chat_mention` thay cho `chat_thread`.
5. Số chưa đọc của chat chính chỉ đếm tin trong chat chính. Số chưa đọc của chuỗi tính riêng cho từng người theo dõi. Tab "Chuỗi" liệt kê các chuỗi mình theo dõi, chuỗi mới hoạt động lên đầu, kèm số chưa đọc. Huy hiệu Chat ở menu bằng chưa đọc chat chính cộng chưa đọc của các chuỗi đang theo dõi và không tắt báo.
6. Mỗi phòng ban có đúng một nhóm phòng ban. Thành viên nhóm là người đang hoạt động thuộc phòng ban đó, Trưởng phòng là chủ nhóm. Đổi phòng ban hoặc khóa tài khoản thì thành viên đổi ngay trong cùng lần lưu. Không ai thêm, bớt tay hay tự rời nhóm phòng ban được.
7. Thành viên phòng ban (và BGĐ/Admin) tạo được nhóm nhỏ dưới nhóm phòng ban, mời được người ở phòng ban khác. Người ngoài phòng ban thì không tạo được. Danh sách bên trái hiện Phòng ban → nhóm nhỏ, vẫn giữ nhóm thường, chat riêng và nhóm Inbox.
8. Chủ nhóm, BGĐ hoặc Admin chuyển được nhóm giữa "Trò chuyện" và "Chủ đề". Ở chế độ Chủ đề, mỗi tin mới gửi từ màn hình chính là một chủ đề. Màn hình chính liệt kê chủ đề theo thời gian hoạt động gần nhất, kèm số trả lời và 2 trả lời mới nhất. Người tạo chủ đề hoặc chủ nhóm đóng và mở lại được chủ đề. Chủ đề đã đóng thì không trả lời được (lỗi 422). Tin cũ trong nhóm vẫn còn.
9. "Tạo việc từ tin này" hoặc "Tạo việc từ chuỗi" khi Trợ lý đang online: Trợ lý đăng một việc nháp ngay tại chỗ, gồm tiêu đề, mô tả, người làm chính, người liên quan và hạn. Chỉ người yêu cầu sửa và tạo được, và chỉ tạo được một lần (lần thứ hai bị từ chối). Việc lưu link nguồn, thẻ việc được đăng lại vào chuỗi hoặc thành trả lời cho tin gốc, người làm và người liên quan nhận `task_assigned`. Khi không có Trợ lý hoặc Trợ lý offline, cùng thao tác đó mở hộp tạo việc điền sẵn từ nội dung tin và cho kết quả giống hệt.
10. Gọi @Trợ lý trong chuỗi thì Trợ lý trả lời ngay trong chuỗi, chỉ dựa trên nội dung chuỗi đó. Nếu câu trả lời có khối `[TASK]` thì khối đó thành việc nháp.
11. Trang chi tiết việc có dòng "Tạo từ chat". Người là thành viên hội thoại bấm vào thì mở đúng chuỗi hoặc đúng tin. Người không phải thành viên chỉ thấy chữ, không có link.
12. MCP `read_messages` trả `thread_id`, `reply_to_id`, `parent_id` (giữ để tương thích) và `reply_count`. Tham số `thread_id` trả về cả chuỗi. `search_messages` trả `thread_id`. `get_task` trả `source` khi agent đọc được hội thoại nguồn. Quy tắc `agent_readable` không đổi.
13. Test đo được: một lần gửi trả lời trong chuỗi, có tích "Cũng gửi vào nhóm", 3 @nhắc tên, gọi agent và bridge đang offline, dùng tối đa 40 truy vấn D1. Test ngân sách của cron vẫn tối đa 40.
14. Sau migration, mọi tin có `parent_message_id` đều có `reply_to_message_id` bằng giá trị đó. Số tin trước và sau migration bằng nhau.
15. `pnpm -r typecheck`, `pnpm -r test` và `pnpm --filter @abm/crm build` đều exit 0.

## Câu hỏi còn mở

1. Toàn bộ code của plan trước (bản đã deploy `62d61a57`) vẫn chưa commit. Opus có được commit nó làm mốc trước khi bắt đầu phase 01 không? Nếu không có mốc này thì khó lùi lại từng phase.
2. Có cần nhóm "Toàn công ty" tự đồng bộ như all-staff group của Lark không? Plan mặc định là không.
3. BGĐ và Admin không thuộc phòng ban nào. Họ có cần tự vào mọi nhóm phòng ban không? Plan mặc định là không, giống Lark.
4. Chủ đề xếp theo hoạt động gần nhất (plan đang chọn) hay theo thời điểm tạo?
5. Plan cho người cùng làm nhận thông báo `task_assigned` với **mọi** việc mới, không chỉ việc tạo từ chat. Lý do: hiện người cùng làm không được báo gì. Bạn có đồng ý không?
6. Người rời phòng ban vẫn ở lại các nhóm nhỏ mình được mời (chủ nhóm tự xóa nếu cần). Bạn có đồng ý không?
