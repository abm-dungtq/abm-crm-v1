# Brainstorm: Long chăm sóc học viên trong nhóm Zalo

Ngày 2026-10-13. Có một agent Opus soát (`--advice`), kết luận GO kèm ba chỉnh sửa. Bản này đã gộp các chỉnh sửa đó. User đã chọn bốn quyết định ở mục "Quyết định của user".

## Bằng chứng

- `apps/crm/src/worker/inbox/conversation-flow.ts:76-80` (quy tắc 1): bot chỉ trả lời khi hội thoại là `direct` và đang ở chế độ `ai`. Với nhóm, CRM chỉ lưu tin và tóm tắt mỗi ngày (`group-summaries.ts`).
- `apps/crm/src/worker/inbox/ingest.ts:81-126`: khi chính nick gõ tay một tin (`fromSelf`, không phải tin hệ thống), cả hội thoại chuyển sang `human`. Trong nhóm, chỉ cần chủ nick gõ một câu là bot im với mọi học viên.
- Mỗi hội thoại là một phiên GoClaw, nên một nhóm dùng chung một phiên. Tin gửi GoClaw hiện chưa có tên người gửi.
- HANDOFF hiện tại chuyển cả hội thoại sang `human`. Áp vào nhóm thì việc chăm sóc cả nhóm dừng lại.
- zca-js 2.2.0: tin nhóm có `data.mentions` và `data.quote` (`ownerId` là người viết tin được trả lời). `sendMessage` gửi được `quote` và `mentions`. Bridge hiện bỏ cả hai trường này khi nhận và chỉ gửi văn bản thuần.
- Agent `sale-tu-van` chứa giá, cọc và số tài khoản MB (bộ v8). Bộ này không có lịch học, link tài liệu hay link Zoom.
- Trên D1 eval đang có một nhóm Zalo, mới 1 tin.

## Quyết định của user

1. **Khi nào trả lời.** Long bắt buộc trả lời khi học viên @mention nick bot, trả lời vào tin do Long gửi, hoặc gọi "Long ơi".
   - Ngày 13/10 user xác nhận nick này chỉ dùng để chạy chatbot; chủ dùng nick khác.
   - Vì vậy @mention nick là tín hiệu chính và an toàn.
   - Nick riêng của chủ được đưa vào danh sách người ABM.
2. **Agent.** Tạo agent riêng `cham-soc-hoc-vien`, không có giá, cọc hay số tài khoản. Câu hỏi về học phí thì mời học viên nhắn riêng với nick.
3. **Kiến thức.** Em soạn nháp từ bộ v8 (khoá học, công cụ, thực hành) và dữ liệu khoá học trong CRM, user duyệt trước khi nạp.
4. **Người ABM trong nhóm.** Em lấy danh sách thành viên nhóm từ Zalo, user đánh dấu ai là người ABM.

## Hợp đồng

**Kết quả.** Trong nhóm học viên đã bật bot, học viên @mention nick bot, gọi "Long ơi" hoặc trả lời vào tin của Long thì nhận câu trả lời ngay trong nhóm, có trích tin hỏi và gọi đúng tên. Câu Long không trả lời được thì báo anh qua Lark, nhóm vẫn được chăm sóc tiếp.

**Ràng buộc.**
- Nick là nick cá nhân, nên tránh để Zalo đánh dấu là máy:
  - mỗi câu hỏi chỉ trả lời một lần;
  - chờ 3–8 giây trước khi gửi;
  - không giới hạn số tin trong nhóm (user quyết định ngày 13/10);
  - không tag hàng loạt, không lặp lại tin giống hệt.
- Không bao giờ nói "chuyển nhân viên".
- Agent nhóm không được biết dữ liệu học phí hay số tài khoản.
- Người ABM được đánh dấu và chính nick không bao giờ là người được trả lời.
- Nếu ai đó gõ tay từ chính nick bot trong nhóm, Long im ở nhóm đó 30 phút và không chuyển nhóm sang `human`.
- Bất kỳ câu trả lời nào của người ABM được đánh dấu cũng làm Long nhường câu hỏi đó.
- Một nhóm vẫn là một phiên GoClaw. Mỗi tin có tiền tố tên người gửi; lịch sử phiên được cắt gọn.
- Code do Grok viết qua Paseo, Opus soát. Grok không commit, deploy hay đụng D1 remote. Sao lưu D1 trước khi chạy migration.

**Ngoài phạm vi.**
- Tự trả lời khi không được gọi tên.
- Gắn nhóm với lớp hoặc khoá trong module học viên.
- Bật cho nhiều nhóm cùng lúc.
- Đổi hành vi chat 1-1 với `sale-tu-van`.

**Tiêu chí nghiệm thu.**
- Tin @mention nick bot, tin "Long ơi …" hoặc tin trả lời vào tin của Long nhận đúng một câu trả lời trong nhóm. Câu trả lời trích tin hỏi và gọi đúng tên.
- Tin không gọi Long, tin của người ABM và tin của chính nick không tạo lượt chạy GoClaw.
- Gõ tay từ nick bot trong nhóm: nhóm vẫn ở `ai`, Long im 30 phút rồi tự trả lời lại.
- Câu cần người thật: Lark có thông báo kèm tên nhóm, người hỏi và nội dung; nhóm vẫn ở `ai`.
- Hỏi học phí hay số tài khoản trong nhóm: Long mời nhắn riêng, không nêu con số.
- CRM có công tắc bật/tắt bot và chọn agent cho từng nhóm, mặc định tắt.
- CRM có màn đánh dấu người ABM từ danh sách thành viên nhóm.
- Test và typecheck của CRM và bridge đều qua.
- Chạy thử một tuần trên một nhóm thí điểm: không trả lời nhầm người, không nêu học phí, không có cảnh báo từ Zalo.

## Đánh đổi

- **@mention, gọi tên hoặc trả lời tin mới trả lời** (đã chọn). Giả định học viên biết tag Long. Hỏng đầu tiên khi học viên hỏi trống không và không ai trả lời. Xử lý: tin chào nhóm và tin ghim hướng dẫn cách gọi Long.
- **Tự trả lời mọi câu.** Phụ thuộc vào việc LLM biết lúc nào nên im. Hỏng đầu tiên khi bot trả lời nhầm hoặc làm ồn nhóm đông, và mỗi tin tốn một lượt GoClaw. Hoãn lại.
- **Agent riêng** (đã chọn). Không thể lộ dữ liệu bán hàng. Đổi lại phải soạn và giữ thêm một bộ kiến thức.

## Lát cắt đầu tiên

1. **Bridge.**
   - Chuyển `mentions`, `quote.ownerId` và tên người gửi lên Worker.
   - Gửi kèm `quote` khi trả lời.
   - Thêm lệnh lấy danh sách thành viên nhóm.
2. **Worker và D1.**
   - Thêm cờ bật bot cho từng nhóm, agent của nhóm, danh sách người ABM của nhóm và mốc tạm im.
   - Thêm luật kích hoạt cho nhóm và độ trễ trước khi gửi.
   - Thêm HANDOFF theo từng câu hỏi: chỉ báo Lark, không đổi chế độ nhóm.
   - Khi có người gõ tay từ nick bot trong nhóm: tạm im 30 phút.
3. **Agent `cham-soc-hoc-vien`.** Bộ kiến thức nháp, user duyệt rồi mới nạp. Kèm phần vận hành nhóm: xưng hô, câu hỏi học phí, nhường người ABM, dòng HANDOFF.
4. **Giao diện CRM.** Công tắc và chọn agent cho từng nhóm; màn đánh dấu người ABM.
5. **Thí điểm.** Bật cho một nhóm, gửi tin chào kèm hướng dẫn gọi Long, theo dõi một tuần.

## Nhóm báo Lark

Ngày 13/10/2026, `LARK_INBOX_CHAT_ID` của Worker eval đã trỏ tới nhóm Lark "Test chatbot Goclaw". Bot DungTQ_Agent đã gửi thử một tin vào nhóm này thành công.
