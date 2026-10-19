# Agent GoClaw cho Inbox đa kênh

Bốn agent GoClaw phục vụ Inbox Zalo cá nhân và Fanpage. Quy tắc bot khách hàng xem [ADR-009](../adr/adr-009-customer-facing-bot.md); hàng lệnh xem [ADR-010](../adr/adr-010-leased-command-dispatcher.md).

| Agent | Gọi khi | `X-GoClaw-User-Id` | Tool |
| --- | --- | --- | --- |
| Agent khách hàng (khoá theo `channel_account.agent_key`) | Khách nhắn trong hội thoại 1-1 ở chế độ `ai` | `zalo:<số>:<thread>` hoặc `facebook:<page>:<psid>`, một phiên mỗi hội thoại | Theo cấu hình kiến thức đã duyệt phía GoClaw |
| `cham-soc-hoc-vien` (hoặc `conversation.group_agent_key`) | Học viên gọi bot trong nhóm Zalo đã bật bot | Như hội thoại 1-1: một phiên mỗi nhóm | `datetime` |
| `crm-extractor` | Handoff, trả lại AI, hội thoại 1-1 im 15 phút, nhân viên bấm "Cập nhật CRM" | `crm-extract:<uuid>`, mỗi lần một phiên mới | Không có |
| `group-summarizer` | Tóm tắt nhóm Zalo hằng ngày | `group-summary:<uuid>`, mỗi lần một phiên mới | Không có |

Cả bốn agent dùng provider/model `deepseek-flash`. Agent `crm-extractor` và `group-summarizer` không được gắn tool nào.

Thay đổi cấu hình GoClaw (tạo agent, sửa prompt, đổi model) cần user đồng ý trước, theo cổng đồng ý trong [plan Inbox](../../plans/261008-1430-omnichannel-inbox-goclaw/plan.md).

## API key của sidecar và giới hạn tốc độ

- **Scope `operator.read` + `operator.write`, KHÔNG gắn owner.** Sidecar gọi `POST /v1/chat/completions` (POST cần vai trò operator; `operator.write` cho vai trò đó) và đặt `X-GoClaw-User-Id` riêng cho từng hội thoại. Một API key có `owner_id` khiến GoClaw bỏ qua header này và luôn dùng owner làm user, nên mọi khách sẽ chung một phiên (lẫn ngữ cảnh giữa các khách). Khi tạo key, để trống owner.
- **Giới hạn tốc độ.** `gateway.rate_limit_rpm` mặc định 20 request/phút cho mỗi bearer token, burst 5, áp cho endpoint chat completions. Vượt giới hạn, GoClaw trả 429; sidecar báo lần chạy đó lỗi và Worker chạy lại sau 2 phút (backoff `2^attempts` phút), nên khách chờ lâu và có thể bị chuyển cho nhân viên. Trước khi mở pilot, nâng `gateway.rate_limit_rpm` (ví dụ 120). Giá trị này áp cho mọi token, không riêng key sidecar.

## 1. Agent khách hàng

Agent `sale-tu-van`: chuyên viên tư vấn và hỗ trợ khách của ABM trên Zalo/Fanpage. Từ 13/10/2026, agent này dùng bộ nạp chatbot ABM v8.0 (06/10/2026). Bộ nạp nằm ở `exports/bo-nap-chatbot-v8/`; thư mục `exports/` không đưa lên git.

| Context file | Nội dung |
| --- | --- |
| `SOUL.md` | `SYSTEM-INSTRUCTION.md` của bộ v8, cộng phần vận hành kênh CRM. Phần CRM gồm: văn bản thuần không Markdown; không hỏi khu vực hay múi giờ; cách đọc `[Tệp đính kèm]` và `[Nhân viên đã trao đổi: ...]`; danh sách trường hợp HANDOFF |
| `CAPABILITIES.md` | Chín tài liệu KB01–KB09 đã bỏ front matter, khoảng 102.000 ký tự. Đây là phần prompt ổn định nên được cache |
| `AGENTS.md` | Quy trình trả lời mỗi lượt |
| `IDENTITY.md`, `USER_PREDEFINED.md` | Tên Long, lời chào tin đầu, cách trả lời câu "người hay A.I", nhóm khách của kênh |

**Danh tính.** Bot tên Long, giới thiệu là "chuyên viên hỗ trợ kĩ thuật của ABM". Khi khách hỏi thẳng là người hay A.I, bot trả lời trung thực rằng mình là trợ lý A.I.

**Xưng hô theo hồ sơ Zalo.**

- Với hội thoại Zalo 1-1, payload `run_completion` (`purpose: 'reply'`) có thêm `zaloUserId`, là mã thread của khách.
- Sidecar gọi `getUserInfo` của zca-js để lấy tên hiển thị và giới tính (`0` là nam, `1` là nữ). Kết quả được nhớ 24 giờ, không có hồ sơ thì nhớ 1 giờ, mỗi lần tra chờ tối đa 5 giây.
- Sidecar thêm một dòng `[Hồ sơ Zalo của khách: tên "..."; giới tính: nam|nữ|không rõ]` vào đầu tin gửi GoClaw.
- Tra lỗi thì sidecar gửi tin như cũ, không thêm dòng này. Facebook không có dòng này. Ở nhóm, `zaloUserId` là người hỏi.

**Tài khoản Zalo là nick cá nhân.** Khi nhường việc cho người thật, bot không bao giờ nói với khách là "chuyển cho nhân viên/chuyên viên". Bot đưa một lý do đúng thực tế, ví dụ "em kiểm tra lại lịch rồi nhắn Anh/Chị", "em đối soát giao dịch rồi xác nhận lại", rồi kết thúc tin bằng một dòng riêng `[HANDOFF: <lý do ngắn>]`.

Worker nhận dòng khớp `^\[HANDOFF:\s*(.+?)\]\s*$`, bỏ dòng đó khỏi tin gửi khách, chuyển hội thoại sang `human` và báo nhóm Lark.

Các trường hợp bot nhường cho người:

- Khách chốt đăng ký hoặc báo đã chuyển khoản. Bot gửi trước giá, cọc và tài khoản MB đúng KB03.
- Khách hỏi lịch, link, địa điểm (bộ v8 chưa có lịch được xác nhận).
- Khách đặt lịch Zoom tư vấn.
- Báo giá Inhouse/DWY/LMS.
- Giảm giá, trả góp, ngoại lệ.
- Khiếu nại, lỗi truy cập.
- Các dữ kiện bộ v8 ghi "cần cập nhật" (quà tặng, đầu mối, SLA, case theo ngành).
- Khách muốn gặp người thật.

**Lớp kiểm tra chuyển người (hội thoại 1-1).** Bot có thể quên dòng HANDOFF, nên sau khi áp dụng câu trả lời của bot, Worker tự đọc lời khách của lượt đó (`customerText` trong payload `run_completion`, không gồm ngữ cảnh nhân viên) và quyết định riêng. Mã ở `apps/crm/src/worker/inbox/decision-layer.ts`.

- Lượt kiểm tra chạy sau khi tin trả lời của bot đã được đẩy đi, nên không làm tin trả lời chậm lại. Lượt chỉ có tệp đính kèm thì bỏ qua.
- Luật cứng quyết định trước, và chỉ bắt câu khẳng định: báo đã chuyển khoản hoặc gửi bill, đòi gặp người thật hoặc quản lý, khiếu nại hoặc đòi hoàn tiền, không vào được. Câu hỏi về chính sách ("hoàn tiền thế nào") và câu điều kiện ("nếu em đã chuyển khoản") để Jev xét. Luật so trên chữ đã bỏ dấu.
- Câu luật không bắt được thì hỏi TypeSafe Jev (`POST https://api.typesafe.ai/v1/systemone`, model ghim `jev-1.13.0`, chờ tối đa 1,5 giây). Jev chọn một trong các loại: `payment_done`, `wants_human`, `complaint`, `access_problem`, `schedule_or_link`, `special_pricing`, `none`. Câu trả lời chỉ được tính khi độ tự tin đạt `JEV_CONFIDENCE` (mặc định 0,75).
- **Dữ liệu ra ngoài.** Lời khách được gửi sang TypeSafe sau khi thay email, số điện thoại và dãy số dài (số tài khoản, mã) bằng `[email]`, `[phone]`, `[number]`. Tên và nội dung khác vẫn đi qua. TypeSafe chỉ cam kết không lưu dữ liệu với gói enterprise.
- Không bao giờ chặn câu trả lời của bot. Jev lỗi, quá giờ, thiếu key hay lỗi 5 lần liên tiếp (ngắt 30 giây) đều nghĩa là "không quyết định".
- Khi bot đã tự HANDOFF, lý do của bot được giữ; lớp này chỉ ghi nhật ký.

Chế độ (biến trong `apps/crm/wrangler.jsonc`), mỗi biến là `off`, `shadow` hoặc `active`. Từ 19/10/2026 cả hai biến để `active` theo quyết định của chủ dự án, không qua giai đoạn `shadow`:

| Biến | Ý nghĩa |
| --- | --- |
| `HANDOFF_NET_MODE` | `shadow`: chỉ ghi nhật ký. `active`: chuyển người thật khi bot không tự chuyển |
| `JEV_INTENT_MODE` | `off`: không hỏi Jev. `shadow`: hỏi và ghi lại, không tính. `active`: tính câu trả lời của Jev |

Key nằm trong secret `TYPESAFE_API_KEY` (`wrangler secret put TYPESAFE_API_KEY`; máy local dùng `apps/crm/.dev.vars`). Mỗi lần kiểm tra ghi một dòng `audit_log` với `command = 'inbox.handoffCheck'`: luật nào khớp, Jev chọn gì và độ tự tin, kết quả, có áp dụng không. Dòng này không chứa lời khách. So sánh với lý do HANDOFF của bot trước khi chuyển sang `active`.

Trước khi đổi ngưỡng hay chuyển chế độ, chạy `node --env-file=.dev.vars scripts/eval-handoff-check.mjs` trong `apps/crm`. Script chấm luật và Jev trên các câu mẫu ở `scripts/fixtures/handoff-labels.jsonl`. File này chỉ chứa câu tự viết, không đưa dữ liệu khách vào.

**Dựng, áp dụng và thử.** Các script nằm ở `D:\Goclaw\plans\261013-sale-tu-van-kb\`:

- Chạy `node apply-kb-v8.mjs` để xem bản dựng trong `out/`.
- Chạy `node apply-kb-v8.mjs --apply` để ghi lên GoClaw, ghi xong tự đọc lại để kiểm.
- Chạy `node run-kb-tests.mjs [mã ca...]` để chạy 71 ca của bộ v8 cùng các ca kênh CRM. Mỗi ca dùng một user thử riêng, phiên thử bị xoá sau khi chạy, kết quả ghi ra `test-results-*.md`.
- Rollback bằng bản sao `D:\Goclaw\backups\sale-tu-van-before-kb-v8-20261013.json`.
- Script dựng ban đầu `setup-inbox-agents.mjs` không còn ghi context file của `sale-tu-van`.

**Chi phí.** Mỗi lượt trả lời tốn khoảng 57.000 token đầu vào, phần lớn là bộ kiến thức đã được cache.

**Cập nhật kiến thức.** Sửa tệp KB trong bộ nạp rồi chạy lại apply và test. GoClaw tự gắn kịch bản "làm quen người dùng mới" (BOOTSTRAP) cho 3 lượt đầu của mỗi khách. Phần CRM trong `SOUL.md` ghi đè việc hỏi khu vực, múi giờ và ngôn ngữ.

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

## 4. `cham-soc-hoc-vien`

Long chăm sóc học viên trong các nhóm Zalo của ABM. Nick Zalo này chỉ dùng cho chatbot. Nguồn: [hợp đồng brainstorm](../../plans/reports/brainstorm-261013-1546-zalo-group-learner-care.md), [plan](../../plans/261013-1546-zalo-group-learner-care/plan.md).

**Khi nào Long trả lời.** Nhóm phải bật "Long trả lời trong nhóm" (`conversation.bot_reply_enabled`, mặc định tắt). Tài khoản phải bật bot, và `customer_bot_switch` phải chưa tắt bot. Khi đủ các điều kiện đó, Long trả lời khi:

- có người @mention nick bot (bridge gắn `mentionsSelf`; @all không tính);
- có người trả lời vào một tin của Long (`quotesSelf`);
- tin có chữ "Long ơi", không phân biệt hoa thường.

Không giới hạn số tin trong nhóm. Câu trả lời của Long cũng không tính vào hạn mức gửi mỗi ngày của tài khoản (lệnh gửi có `replyTo`). Tin đăng theo lịch vẫn tính.

**Tin gửi GoClaw.** Mỗi nhóm là một phiên. Text có dạng `[Nhóm Zalo "<tên nhóm>"] <người gửi>: <tin>`. Câu trả lời trích lại tin hỏi và tag người hỏi ở đầu tin. Vì vậy agent không mở đầu bằng tên người hỏi.

**Người ABM và nhân viên gõ tay.**

- Leader/Admin đánh dấu "Người ABM" trong danh sách thành viên nhóm. Danh sách lưu theo tài khoản Zalo (`zalo_staff_member`).
- Bridge gửi danh sách thành viên (`group_members`) khi kết nối và 6 giờ một lần, giãn 1,5 giây giữa các nhóm.
- Tin của Người ABM không gọi Long và huỷ các câu trả lời đang chờ của nhóm. Câu trả lời bị bỏ nếu Người ABM đã nhắn sau tin hỏi.
- Nhân viên gõ tay vào nhóm bằng nick bot hoặc từ web thì Long im 30 phút ở nhóm đó (`bot_paused_until`).

**HANDOFF trong nhóm.** CRM chỉ báo nhóm Lark, không đổi chế độ hội thoại. Trả lời lỗi cũng chỉ báo Lark. Các trường hợp: lịch học, link, record; lỗi truy cập; khiếu nại; câu hỏi ngoài kiến thức; người hỏi muốn gặp người thật. Học phí, cọc và số tài khoản không bao giờ được nói trong nhóm: Long mời học viên nhắn riêng.

**Kiến thức.** KB01, KB02, KB04–KB09 của bộ v8, bỏ KB03 và các dòng giá (khoảng 94.000 ký tự). Không dùng dữ liệu khoá học trong CRM. Admin đổi được agent cho từng nhóm (`group_agent_key`, chỉ chữ thường, số và `-`).

**Dựng, áp dụng và thử.** Các script nằm ở `D:\Goclaw\plans\261013-cham-soc-hoc-vien\`:

- `node build-kb.mjs` dựng `out/CAPABILITIES.md`.
- `node apply-agent.mjs` tạo hoặc cập nhật agent và context file.
- `node run-group-tests.mjs` chạy 15 ca G01–G15.

Mỗi lượt tốn khoảng 47.000 token đầu vào.

## 5. `crm-sales-poc` (bot Lark nội bộ)

Kênh `abm-lark` gắn agent này. Từ 16/10/2026 nó dùng CRM thật qua kết nối MCP `abm-crm-main` (`/api/mcp`, mỗi người một chìa khóa, đủ 11 lệnh). Công cụ có sẵn chỉ gồm `datetime`, `web_search`, `web_fetch`, `read_image`, `read_document`, `memory_*` và `mcp_tool_search`; không mở chạy lệnh, ghi file, trình duyệt hay cron.

**Cấp chìa khóa.** Người dùng phải liên kết Lark (`lark_link_status = linked`). Chạy trong `apps/crm`:

```
node scripts/issue-agent-tokens.mjs --server 01a1062a-ce8f-77b8-a16d-d69a39b2a6f5 --email <email> [--tenant-user <goclaw user_id>]
```

Trong nhóm, GoClaw tìm chìa khóa theo open_id Lark của người nhắn. Trong tin nhắn riêng, nếu contact đã được gộp vào một tenant user thì GoClaw dùng `user_id` của tenant user đó, nên phải thêm `--tenant-user`. Anh Dũng (Admin) được gộp vào `crm-poc-a`. Mỗi lần chạy lại script, chìa khóa cũ của người đó bị thu hồi.

## Cài lại bridge

Sidecar Zalo chạy bằng task "ABM Zalo Bridge" lúc đăng nhập Windows, cửa sổ ẩn, lặp mỗi 5 phút. Không cần quyền Admin và không cần chỉnh đồng hồ máy. Từ thư mục gốc repo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps\zalo-bridge\scripts\install-startup-task.ps1
```
