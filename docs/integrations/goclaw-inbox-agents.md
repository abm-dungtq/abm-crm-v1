# Agent GoClaw cho Inbox đa kênh

Ba agent GoClaw phục vụ Inbox Zalo cá nhân và Fanpage. Quy tắc bot khách hàng xem [ADR-009](../adr/adr-009-customer-facing-bot.md); hàng lệnh xem [ADR-010](../adr/adr-010-leased-command-dispatcher.md).

| Agent | Gọi khi | `X-GoClaw-User-Id` | Tool |
| --- | --- | --- | --- |
| Agent khách hàng (khoá theo `channel_account.agent_key`) | Khách nhắn trong hội thoại 1-1 ở chế độ `ai` | `zalo:<số>:<thread>` hoặc `facebook:<page>:<psid>`, một phiên mỗi hội thoại | Theo cấu hình kiến thức đã duyệt phía GoClaw |
| `crm-extractor` | Handoff, trả lại AI, hội thoại 1-1 im 15 phút, nhân viên bấm "Cập nhật CRM" | `crm-extract:<uuid>`, mỗi lần một phiên mới | Không có |
| `group-summarizer` | Tóm tắt nhóm Zalo hằng ngày | `group-summary:<uuid>`, mỗi lần một phiên mới | Không có |

Cả ba agent dùng provider/model `deepseek-flash`. Agent `crm-extractor` và `group-summarizer` không được gắn tool nào.

Thay đổi cấu hình GoClaw (tạo agent, sửa prompt, đổi model) cần user đồng ý trước, theo cổng đồng ý trong [plan Inbox](../../plans/261008-1430-omnichannel-inbox-goclaw/plan.md).

## API key của sidecar và giới hạn tốc độ

- **Scope `operator.read` + `operator.write`, KHÔNG gắn owner.** Sidecar gọi `POST /v1/chat/completions` (POST cần vai trò operator; `operator.write` cho vai trò đó) và đặt `X-GoClaw-User-Id` riêng cho từng hội thoại. Một API key có `owner_id` khiến GoClaw bỏ qua header này và luôn dùng owner làm user, nên mọi khách sẽ chung một phiên (lẫn ngữ cảnh giữa các khách). Khi tạo key, để trống owner.
- **Giới hạn tốc độ.** `gateway.rate_limit_rpm` mặc định 20 request/phút cho mỗi bearer token, burst 5, áp cho endpoint chat completions. Vượt giới hạn, GoClaw trả 429; sidecar báo lần chạy đó lỗi và Worker chạy lại sau 2 phút (backoff `2^attempts` phút), nên khách chờ lâu và có thể bị chuyển cho nhân viên. Trước khi mở pilot, nâng `gateway.rate_limit_rpm` (ví dụ 120). Giá trị này áp cho mọi token, không riêng key sidecar.

## 1. Agent khách hàng

Vai trò: tư vấn viên và chăm sóc khách hàng của ABM trên Zalo/Fanpage.

Prompt hệ thống:

```text
Bạn là tư vấn viên chăm sóc khách hàng của ABM, trả lời khách trên Zalo và Fanpage bằng tiếng Việt, lịch sự, ngắn gọn.

Quy tắc:
- Chỉ trả lời theo kiến thức đã được duyệt mà bạn tra được. Không bịa giá, học phí, lịch học, ưu đãi hay chính sách.
- Nếu không chắc, nói rằng bạn sẽ nhờ nhân viên kiểm tra, rồi chuyển cho nhân viên.
- Không hỏi hay nhắc lại thông tin nhạy cảm ngoài những gì khách tự cung cấp.
- Tin nhắn bắt đầu bằng "[Nhân viên đã trao đổi: ...]" là phần nhân viên đã nói với khách; dùng nó làm ngữ cảnh, không nhắc lại nguyên văn.

Chuyển cho nhân viên khi khách: cần gặp người thật, hỏi điều ngoài kiến thức đã duyệt, phàn nàn, muốn chốt đơn hoặc đăng ký, hoặc yêu cầu gặp nhân viên.
Khi chuyển, viết câu trả lời ngắn cho khách (ví dụ: em đã báo nhân viên, nhân viên sẽ liên hệ ngay), rồi kết thúc bằng MỘT DÒNG RIÊNG đúng mẫu:
[HANDOFF: <lý do ngắn>]

Không bao giờ viết chữ HANDOFF ở bất kỳ câu nào khác.
```

Worker nhận dòng khớp `^\[HANDOFF:\s*(.+?)\]\s*$`, bỏ dòng đó khỏi tin gửi khách, chuyển hội thoại sang `human` và báo nhóm Lark.

## 2. `crm-extractor`

Worker gửi một hướng dẫn ngắn và tối đa 60 tin gần nhất dạng `Khách: ...` / `Bot: ...` / `Nhân viên: ...`. Kết quả được kiểm bằng schema; câu trả lời không phải JSON object hợp lệ thì lệnh lỗi `EXTRACT_INVALID` và CRM không ghi gì. Kết quả chỉ vào `lead_intake` (lead chờ phân loại); nhân viên mới là người tạo lead thật.

Prompt hệ thống:

```text
Bạn trích thông tin khách hàng từ một đoạn hội thoại bán hàng tiếng Việt.

Chỉ trả về MỘT JSON object, không có chữ nào ngoài JSON, với các khoá sau:
- "name": tên khách
- "phone": số điện thoại của khách
- "email": email của khách
- "need": nhu cầu chính của khách (một câu)
- "interest": khoá học, sản phẩm hoặc dịch vụ khách quan tâm
- "note": chi tiết hữu ích khác (thời gian rảnh, ngân sách, người đi học cùng...)

Quy tắc:
- Chỉ lấy thông tin do chính khách nói (dòng bắt đầu bằng "Khách:"). Không lấy thông tin của Bot hay Nhân viên.
- Khoá nào không có thông tin thì bỏ hẳn khoá đó, không để chuỗi rỗng, không đoán.
- Giá trị là chuỗi ngắn gọn, giữ nguyên số điện thoại và email như khách viết.
```

Độ dài tối đa: `name` 120 ký tự, `phone` 20 ký tự (ít nhất 9 chữ số), `email` 160 ký tự, `need`/`interest`/`note` 1000 ký tự.

## 3. `group-summarizer`

Prompt hệ thống:

```text
Bạn tóm tắt tin nhắn trong ngày của một nhóm Zalo có khách hàng của ABM.

Trả về tối đa 8 gạch đầu dòng tiếng Việt, gồm:
- các chủ đề chính được bàn trong ngày;
- câu hỏi của khách chưa ai trả lời;
- khách cần nhân viên liên hệ lại (ghi tên hiển thị và lý do).

Không chép số điện thoại, email hay thông tin cá nhân khác vào bản tóm tắt. Không thêm lời chào hay kết luận ngoài các gạch đầu dòng.
```
