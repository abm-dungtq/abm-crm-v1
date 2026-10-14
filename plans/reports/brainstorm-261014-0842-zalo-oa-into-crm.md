# Brainstorm: đưa chatbot Zalo OA từ Webapp-Chatbot vào CRM

Ngày: 14/10/2026. Chế độ: `--advice`; Opus giám sát, không dùng kongming. Trạng thái: chờ user duyệt.

## Bằng chứng đã kiểm

- **Repo nguồn.**
  - Đường dẫn `/Volumes/1/Webapp-Chatbot` không có trên máy Windows này.
  - Repo GitHub `abm-dungtq/webapp-chatbot` (private, commit cuối `d7c9819` ngày 03/10) được clone vào thư mục tạm để đọc, không chạy.
- **Domain.**
  - `chatbot.abmedu.vn` trỏ A record thẳng về VPS `180.93.50.84` (Caddy → Bun `:8787`). DNS của `abmedu.vn` nằm ở inet.vn.
  - Domain này **không** đi qua Cloudflare tunnel.
  - `/` trả 200. `POST /webhooks/zalo` với body rỗng trả 400, tức app cũ vẫn đang nhận webhook.
- **Cài đặt Zalo OA hiện tại** (theo `docs/zalo-oa-setup.md` của repo cũ):
  - Webhook: `https://chatbot.abmedu.vn/webhooks/zalo`.
  - OAuth callback: `https://chatbot.abmedu.vn/api/zalo/oauth/callback`.
  - Chữ ký webhook: `X-ZEvent-Signature = SHA256(app_id + raw_body + timestamp + OA secret)`. Công thức không dùng URL, nên đứng sau một proxy vẫn kiểm được.
  - Token OAuth v4: access token sống 25 giờ, refresh token 3 tháng và chỉ dùng được một lần.
  - Gửi tin qua `openapi.zalo.me/v3.0/oa/message/cs`. Zalo chỉ cho gửi trong 48 giờ kể từ lần cuối khách nhắn.
  - Sự kiện đang dùng: `user_send_text`, `user_send_image`, `user_received_message`, `user_seen_message`, `oa_send_*` (nhân viên gõ trong app OA).
- **Agent cũ.**
  - Instruction v4.2 khoảng 11.000 ký tự, KB01/02/04, phần riêng cho Zalo, chính sách tiếp nhận đăng ký 199k.
  - Model trả về JSON (`citations`, `actions`).
  - Chính sách 199k được **code kiểm** trước khi gửi (`assertRegistrationPolicyOutput`), không chỉ dựa vào prompt.
  - Ảnh biên lai được đọc bằng model có thị giác (vision).
- **CRM hiện tại.**
  - Fanpage đã chạy đúng khuôn cần dùng: webhook vào Worker (`facebook-webhook.ts`), Worker tự gửi tin (`facebook-send.ts`, lệnh `target: 'worker'`), GoClaw trả lời qua `run_completion` do bridge trên PC gọi.
  - `channel_account.channel` có CHECK chỉ nhận `('zalo', 'facebook')` (migration 0012).

## Hợp đồng

**Kết quả.**
- Khách nhắn Zalo OA thì tin vào Inbox của CRM, và một agent GoClaw mang nội dung agent OA cũ trả lời.
- Nhân viên trả lời OA từ CRM. Handoff, báo Lark và trích lead dùng chung luồng đang có.
- Webapp-Chatbot cũ thôi trả lời Zalo OA.

**Ràng buộc.**
- **Không đổi gì trong cài đặt app Zalo OA:** URL webhook, callback OAuth, domain đã xác thực và các sự kiện đã bật giữ nguyên.
- Sao lưu D1 và DB SQLite của VPS trước khi thay đổi.
- Không in secret. App Secret, OA Secret và token phải được mã hoá hoặc lưu ở Worker secret.
- Grok viết code, Opus soát. Thay đổi cấu hình GoClaw cần user đồng ý.

**Không làm.**
- Không chuyển Facebook, TikTok, web chat, ads hay analytics của webapp cũ.
- Không chuyển DNS `abmedu.vn` sang Cloudflare.
- Mặc định không nhập lịch sử hội thoại cũ và contact cũ (29 contact, 3 lead). Xem câu hỏi mở 2.

**Tiêu chí nghiệm thu.**
1. Khách nhắn OA, tin hiện trong Inbox CRM với nhãn kênh OA, và agent trả lời trong 1 phút.
2. Ping chữ ký của Zalo trả 200. Chữ ký sai trả 401.
3. Nhân viên gửi từ CRM thì khách nhận được. Nhân viên gõ trong app OA thì hội thoại chuyển sang `human`, và bot không trả lời trùng.
4. Token tự làm mới qua cron, không cần dán tay.
5. Webapp cũ không gửi thêm câu trả lời nào cho OA sau khi chuyển.
6. Đường lùi: bật lại kênh OA ở webapp cũ và đổi lại Caddy là quay về như trước, không cần đụng cài đặt Zalo.

## Phương án

| | A. Caddy trên VPS chuyển tiếp đường dẫn Zalo sang Worker (khuyên dùng) | B. Chuyển DNS `abmedu.vn` sang Cloudflare, gắn Worker route | C. Webapp cũ nhận rồi chuyển tiếp sự kiện sang CRM |
| --- | --- | --- | --- |
| Cách làm | Caddy chuyển `/webhooks/zalo` và `/api/zalo/oauth/*` sang Worker CRM (`header_up Host`). Các đường dẫn khác vẫn vào app cũ | Đổi nameserver cả domain, chuyển hết bản ghi sang Cloudflare, thêm route trên `chatbot.abmedu.vn` | Sửa code webapp cũ để đẩy sự kiện OA sang CRM và nhận lệnh gửi |
| Cài đặt Zalo | Giữ nguyên | Giữ nguyên | Giữ nguyên |
| Rủi ro lớn nhất | Phụ thuộc VPS còn sống. VPS vốn đang chạy, nên rủi ro không đổi so với hôm nay | Đổi DNS cả domain công ty (website, email MX), dễ gây gián đoạn | Hai hệ thống cùng giữ logic OA, khó gỡ, trái ý "CRM thay hẳn" |
| Giả định chính | Caddy chuyển nguyên body (chữ ký Zalo không dùng URL) | Chuyển hết bản ghi DNS không sót | Webapp cũ còn được bảo trì lâu dài |
| Chi phí bỏ dở | Thấp: xoá 2 dòng Caddy | Cao | Trung bình |

**Phương án tốt hơn:**
- User nói "vẫn chạy qua Cloudflare tunnel". Thực tế domain không đi qua tunnel, và Worker CRM không cần tunnel vì đã có sẵn trên Cloudflare.
- Phương án A giữ được đúng yêu cầu gốc ("giữ nguyên cài đặt Zalo OA") với ít thay đổi nhất.

## Hướng chọn: A, kênh `zalo_oa` chạy hẳn trong Worker

Kênh mới theo đúng khuôn Facebook:

1. **Migration.**
   - Thêm `'zalo_oa'` vào CHECK `channel`. SQLite phải dựng lại bảng, nên cần sao lưu và chạy thử trên bản sao.
   - Thêm chỗ lưu token OA (mã hoá) và trạng thái kết nối.
2. **Webhook Worker** `/channels/zalo-oa/webhook`.
   - Kiểm chữ ký bằng OA secret (Worker secret).
   - Ghi tin khách vào bảng `message`, nhận diện tin `oa_send_*` của chính hệ thống qua `message_id`.
   - Tin nhân viên gõ trong app OA tính như `staff_phone`.
   - Ghi trạng thái đã nhận / đã xem.
3. **Gửi tin từ Worker** qua `message/cs`, lệnh mới `send_zalo_oa` với `target: 'worker'`.
   - Báo lỗi rõ khi quá 48 giờ hoặc token hết hạn.
   - Có tính vào hạn mức gửi mỗi ngày.
4. **OAuth v4 (PKCE).**
   - Nút "Kết nối Zalo OA" trong CRM, callback đi qua Caddy.
   - Cron làm mới token khi access token còn dưới 3 giờ. Refresh token chỉ dùng được một lần nên phải ghi bằng compare-and-set.
5. **Agent GoClaw mới.**
   - Tên đề xuất `tu-van-oa`, dựng từ nội dung agent OA đang chạy trên production. Bản trong DB VPS là bản đúng nhất, không phải file trong repo.
   - Trả lời dạng văn bản thuần, kèm dòng HANDOFF như `sale-tu-van`.
6. **Chuyển sang CRM.**
   - Sao lưu DB VPS. Thêm 2 khối reverse_proxy vào Caddy. Kết nối OAuth từ CRM. Tắt kênh OA ở webapp cũ.
   - Nhắn thử, rồi theo dõi 24 giờ.

## Rủi ro cần user quyết

1. **Chính sách 199k và ảnh biên lai.**
   - App cũ đọc ảnh bằng vision và có code chặn câu xác nhận sai. Agent GoClaw dùng `deepseek-flash` thì không đọc được ảnh.
   - Đề xuất: khách gửi ảnh biên lai hoặc báo đã chuyển khoản thì bot HANDOFF cho người xác nhận, giống `sale-tu-van`. Như vậy bot không tự xác nhận đăng ký 199k nữa.
2. **Cách lấy nội dung agent cũ.** Cần SSH vào VPS (đọc DB) hoặc đăng nhập webapp cũ để xuất instruction đang chạy thật.
3. **Zalo OA và Zalo cá nhân là cùng một người.** Một khách có thể nhắn cả OA lẫn nick Zalo cá nhân. CRM sẽ thấy 2 hội thoại riêng, không tự gộp.

## Quyết định của user (14/10/2026)

1. **Giữ nguyên chính sách 199k.**
   - Bot vẫn tự xác nhận đăng ký khi khách báo đã chuyển đủ 199.000đ, hoặc gửi biên lai hợp lệ, cho các OA có marker `registration_policy: abm-agent-199k-v1`.
   - Vì vậy CRM phải có hai thứ:
     - (a) đưa được ảnh của khách vào model có vision;
     - (b) chuyển code kiểm câu xác nhận trước khi gửi (tương đương `assertRegistrationPolicyOutput`) vào Worker.
   - Hoàn tiền, tranh chấp và yêu cầu gặp người vẫn HANDOFF.
2. **Nhập lịch sử hội thoại OA cũ vào CRM.** Chỉ nhập tin và hồ sơ khách của kênh Zalo OA. Không nhập contact hay lead của CRM cũ.
3. **Toàn quyền trên VPS** `180.93.50.84`: sao lưu, đọc DB và cấu hình, sửa Caddy, tắt kênh OA ở webapp cũ.
   - Khoá cũ `webapp_backup_ed25519` nằm trên máy Mac, không có trên máy Windows.
   - Đã tạo khoá mới `C:\Users\ABM\.ssh\abm_vps_ed25519` (`abm-windows-crm-to-vps`). User cần thêm public key vào `/root/.ssh/authorized_keys` trên VPS.

## Câu hỏi mở

1. GoClaw `deepseek-flash` có nhận nội dung ảnh (`image_url`) qua `/v1/chat/completions` không? Plan phải chạy thử điều này trước. Nếu không nhận, cần chọn model có vision cho agent `tu-van-oa`.
