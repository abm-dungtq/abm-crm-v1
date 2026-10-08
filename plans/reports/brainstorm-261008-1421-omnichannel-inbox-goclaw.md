# Brainstorm: Inbox đa kênh (Zalo cá nhân + Fanpage) và chatbot GoClaw trong ABM CRM

Ngày: 2026-10-08. Nguồn thiết kế trước đó: `D:\Goclaw\plans\reports\brainstorm-261008-1409-zalo-unified-inbox.md`. Có giám sát kongming qua ba vòng (phạm vi, CRM/chia việc, tích hợp repo).

## Quyết định đã chốt

| Mục | Quyết định |
|---|---|
| Nơi xây | Tích hợp vào repo này (`apps/crm`), không làm web-app riêng |
| LLM | GoClaw, `deepseek-flash` (OpenCode Go) cho mọi agent. Embedding OpenAI `text-embedding-3-small` |
| Kênh | Zalo cá nhân (dưới 10 tài khoản nhân viên, số phụ) + Fanpage. Không Zalo OA, không Pancake |
| Thông báo | Lark (dùng `lark.ts` sẵn có) |
| Quyền xem | Nhân viên xem được mọi hội thoại |
| Chia việc | Quản lý chia tay hoặc tự động lần lượt; handoff tự vào hàng chờ nhân viên; tên nhân viên gắn trên luồng |
| CRM | Agent tóm tắt thông tin khách thành `contact` / `lead` của CRM này |
| Nhóm Zalo | Quản lý nhóm, gửi tin định kỳ, tóm tắt nhóm hằng ngày |
| Hạ tầng GoClaw | Máy Windows chạy 24/7 sau Cloudflare Tunnel `goclaw.tqd.io.vn` |
| Tài khoản Zalo | Số chung của công ty (cập nhật 14:30) |
| Tin định kỳ | Gửi vào nhóm **có khách hàng** |
| Tóm tắt nhóm hằng ngày | Gửi vào Lark |
| Pipeline của lead | Chatbot tạo lead, nhân viên chọn quy trình `b2b` hoặc `learner` |
| Hàng lệnh | Lease trong D1, không dùng Queues |

## Hiện trạng repo (đã scout)

- Một app `apps/crm`: Hono trên Cloudflare Workers + D1 + React/Vite SPA (TanStack Router/Query), contract zod ở `packages/contracts`. Migrations SQL đánh số tới `0011`.
- Dùng lại được: `app_user` + role/scope (`scope.ts`), `contact`, `contact_point`, `lead` (`owner_user_id`, `stage`, `source` đã có facebook/zalo, guarded write), `assignLead`, `approval`, `activity` (`actor_kind` human/agent/system), `audit_log`, `idempotency_key`, `lark.ts`, MCP bot gateway với kill switch.
- Chưa có: bảng hội thoại/tin nhắn, Zalo, Messenger, webhook, realtime, round-robin. Bảng `outbox` có nhưng chưa có dispatcher; `wrangler.jsonc` chưa có queue/cron.
- ADR-001: toàn Cloudflare, GoClaw nằm ngoài core và không là nguồn dữ liệu chuẩn, Durable Objects chỉ cho lịch MVP3.
- Plan đang chạy trên `main`: 261004-1457 (bot gateway, phase 05), 261004-1300 (auth, phase 05), 261005-1053 (learner ops). Cùng đụng `index.ts`, `commands.ts`, `env.ts`, contracts, migrations.

## Contract

**Outcome:** Trong ABM CRM có trang Inbox gom tin Zalo cá nhân của nhân viên và Fanpage. GoClaw trả lời ở chế độ AI; khi cần người, luồng được chia cho nhân viên, nhân viên chat ngay trong CRM, Lark nhận thông báo. Thông tin khách thành `contact`/`lead` có chủ sở hữu, chia tay hoặc lần lượt. Có trang Nhóm Zalo với gửi tin định kỳ và tóm tắt hằng ngày.

**Constraints:**
- Worker là nơi duy nhất ghi dữ liệu chuẩn. GoClaw và sidecar không giữ trạng thái nghiệp vụ.
- zca-js cần socket sống lâu nên không chạy trong Worker: cần một sidecar Node ngoài Cloudflare, là ngoại lệ của ADR-001.
- Sidecar chỉ kéo lệnh (pull), không mở cổng vào.
- Không dùng Durable Objects; UI cập nhật bằng polling.
- Mở rộng `contact_point` / `lead`, không tạo mô hình khách hàng song song.
- Zalo cá nhân là giao thức không chính thức: rủi ro khóa tài khoản, nhân viên chỉ dùng Zalo trên điện thoại.
- Messenger cần App Review (`pages_messaging`), cửa sổ 24 giờ, tag `HUMAN_AGENT` cho trả lời muộn. Kiểm lại theo tài liệu Meta hiện hành.
- Dữ liệu cá nhân theo Nghị định 13/2023; dùng bảng `consent` / `privacy_request` sẵn có.
- Backup D1 trước mọi migration (theo `docs/engineering/deployment-baseline.md`).

**Non-goals:** Zalo OA, Pancake, chủ động nhắn 1-1 cho khách lạ, app di động riêng, sửa mã GoClaw, Durable Objects, nhiều tổ chức.

**Acceptance criteria:**
- Quản trị kết nối tài khoản Zalo bằng QR trong CRM và thấy trạng thái từng tài khoản; Fanpage nhận webhook có xác minh chữ ký.
- Mọi tin vào/ra, kể cả tin nhân viên gửi từ điện thoại, có trong Inbox trong vài giây; không trả lời trùng.
- Chế độ AI/Người theo hội thoại, bền qua khởi động lại; nhân viên nhắn từ điện thoại hoặc bấm Tiếp quản thì bot im.
- Handoff: luồng vào hàng chờ của một nhân viên, tên hiện trên luồng, Lark nhận tóm tắt + link trong 1 phút.
- Khách để lại thông tin thì có `contact` + `contact_point` + lead chờ phân loại; nhân viên chọn pipeline thì thành lead thật; ghi đè trường đã có đi qua `approval`.
- Chia lead thủ công hoặc lần lượt, có `audit_log`.
- Tin định kỳ vào nhóm đúng lịch, có giới hạn/ngày và công tắc tắt; tóm tắt nhóm hằng ngày.
- Kill switch tắt được bot khách hàng riêng với bot nhân viên.
- `pnpm -F @abm/crm test`, `typecheck`, `build` xanh; pilot 2 tài khoản Zalo trong 2 tuần trước khi mở rộng.

## Hướng đã chọn

**Worker điều phối, sidecar thực thi.**

```text
Khách Zalo ─► zca-js ─┐                         ┌─ Messenger webhook / Graph send
                      │  apps/zalo-bridge (Node, │
GoClaw 127.0.0.1 ◄────┤  máy Windows, pull-only) │
                      │        ▲ HMAC            ▼
                      └─► ABM CRM Worker (Hono + D1) ── SPA: Inbox · Nhóm · Tài khoản kênh
                              ├─ conversation / message / channel_account / zalo_group / schedule
                              ├─ bảng lệnh có lease = outbox dispatcher
                              ├─ contact · lead · approval · activity · audit
                              └─ Cron Triggers: lịch nhóm, tóm tắt, SLA, dọn phiên GoClaw
                                       └─► Lark
```

- **Worker** giữ trạng thái hội thoại, chế độ, xử lý marker `[HANDOFF: ...]`, chống trùng, chia việc, approval, audit. Phát lệnh `send_zalo`, `send_messenger`, `run_completion` vào một bảng lệnh có `claimed_at`, `attempts`, `lease_expires`. Bảng này chính là outbox dispatcher mà ADR-001 cần, không làm bảng riêng cho inbox.
- **Sidecar `apps/zalo-bridge`** trên máy Windows cạnh GoClaw: giữ phiên zca-js, đẩy sự kiện vào Worker (HMAC, idempotent theo mã tin), long-poll lệnh, gọi GoClaw qua `127.0.0.1` (không qua tunnel), gửi ảnh QR đăng nhập lên CRM. Sidecar không tự quyết điều gì.
- **Messenger** gửi qua Graph từ Worker nhưng đi chung bảng lệnh để có một đường retry/chống trùng.
- **Mở rộng mô hình:** `contact_point.type` thêm `zalo_uid`, `fb_psid` (đang là CHECK phone/email); `lead.source` đã có facebook/zalo.
- **Tuần tự theo hội thoại** bằng lease trong D1 thay cho Durable Objects.
- **Gọi GoClaw stateless** cho trích CRM và tóm tắt nhóm (`X-GoClaw-User-Id` mới mỗi lần, dọn bằng RPC `sessions.delete` của GoClaw qua cron).

## Chi tiết theo quyết định 14:30

### Tài khoản chung và chia việc
- Mọi tài khoản Zalo là pool chung: hội thoại được chia thủ công hoặc lần lượt cho nhân viên đang trực. Khách thấy tên tài khoản công ty; tên nhân viên chỉ hiện nội bộ trên luồng.
- Mỗi số chung chỉ có một điện thoại giữ, không ai đăng nhập Zalo PC/Web. Bảng `channel_account` có lease phiên để sidecar không mở trùng một tài khoản.
- Tin gửi từ điện thoại của số chung không biết là nhân viên nào: ghi `staff_phone`, chuyển sang chế độ Người, giữ nguyên người được giao, cập nhật `last_activity_at`.

### Lead do chatbot tạo
Bảng `lead` bắt buộc `pipeline` (NOT NULL, `b2b` | `learner`) và có ràng buộc trạng thái: `queue` không có chủ, `active` phải có chủ + Next Action, `learner` không được `queue` (`migrations/0006_learner_foundation.sql:79-87`). Vì vậy:
- Chatbot tạo `contact` + `contact_point` (Zalo ID / Facebook ID / SĐT) và một **lead chờ phân loại** gắn với hội thoại, chứa thông tin agent trích được.
- Nhân viên chọn `b2b` hoặc `learner`; thao tác này tạo lead thật qua lệnh tạo lead sẵn có, giữ mọi ràng buộc và luật giữ khách của learner.
- Đã loại: thêm pipeline `unclassified` (lan ra mọi truy vấn/báo cáo theo pipeline) và tạo lead `b2b` rồi đổi sang `learner` (phải viết chuyển trạng thái chéo pipeline đụng ba CHECK, và làm sai số liệu hàng đợi b2b).

### Tin định kỳ vào nhóm có khách
Đây là rủi ro khóa tài khoản cao nhất của cả hệ thống. Giữ trong phạm vi theo quyết định, với các điều kiện:
- Quản lý duyệt từng mẫu tin trước khi lịch chạy (dùng `approval`).
- Giới hạn số tin/ngày tính **theo tài khoản trên mọi lệnh gửi**, không theo từng lịch.
- Giờ yên lặng, lệch thời điểm ngẫu nhiên, tự dừng khi tài khoản có dấu hiệu bị cảnh báo, công tắc tắt.
- Đánh dấu nhóm tắt nhận tin định kỳ; dispatcher kiểm tra trước khi gửi.
- Pilot một nhóm trước khi mở rộng.

### Tóm tắt nhóm
Lệnh `run_completion` cho agent tóm tắt, rồi lệnh gửi Lark. Tắt gửi tin Zalo không chặn tóm tắt vì Lark độc lập.

## Các hướng đã xét

| Hướng | Dựa vào | Hỏng trước khi |
|---|---|---|
| **Worker điều phối, sidecar thực thi (chọn)** | Lease D1 đủ cho dưới 10 tài khoản | Lưu lượng vượt khả năng polling/lease của D1 |
| Bot loop bằng Cloudflare Queues trong Worker | Có Workers Paid và dispatcher đã xây | Dispatcher đang bị chặn chờ restore reconciliation (`deployment-baseline.md`); mỗi lần gọi GoClaw phải qua tunnel |
| Bot loop nằm trong sidecar, Worker chỉ lưu và hiển thị | Chấp nhận logic nghiệp vụ ngoài Cloudflare | Trái ADR-001 (GoClaw/ngoài core không là nguồn dữ liệu chuẩn); logic chia đôi hai nơi |

**Trade-offs:** hướng chọn cần xây dispatcher có lease, nhưng đó là việc ADR-001 vốn cần. Queues giảm code tự viết nhưng phụ thuộc hạ tầng chưa có và chi phí trả phí. Bot trong sidecar nhanh nhất nhưng đặt dữ liệu nghiệp vụ ra ngoài core.

**Better approaches:** so với web-app riêng ở thiết kế trước, tích hợp vào CRM tốt hơn vì dùng lại sẵn user/role, contact/lead, approval, audit, Lark; chi phí là phải theo ADR và tránh va chạm với các plan đang chạy.

## ADR mới cần viết

1. Sidecar ngoài Cloudflare cho phiên Zalo cá nhân và gọi LLM nội bộ, chỉ pull, kèm ghi nhận rủi ro điều khoản Zalo.
2. Bot khách hàng là một loại principal mới (khác bot nhân viên của ADR-004): chế độ AI/Người, marker handoff, đường approval cho ghi của agent, kill switch riêng.
3. Outbox dispatcher bằng lệnh có lease trong D1 (cập nhật "Queues" của ADR-001 thành "Queues hoặc lệnh lease D1").

## Thứ tự giai đoạn

| Giai đoạn | Nội dung |
|---|---|
| P0 | Chờ phase 05 của plan 1457 và 1300 xong; viết 3 ADR; nộp App Review Meta |
| P1 | Migration `0012+`, dispatcher có lease, sidecar Zalo, Inbox UI, AI/Người, handoff → Lark, chia thủ công, lease phiên cho số chung. Pilot 2 tài khoản / 2 tuần |
| P2 | Trích CRM, lead chờ phân loại + approval, chia lần lượt, SLA, tóm tắt nhóm hằng ngày |
| P3 | Messenger vào Inbox |
| P4 | Gửi tin định kỳ vào nhóm, sau khi có số liệu khóa/đá phiên |

## Rủi ro

1. Va chạm với plan 1457/1300/1053 trên cùng file và chuỗi migration.
2. Khóa tài khoản Zalo, nặng nhất khi gửi định kỳ.
3. Máy Windows hoặc tunnel rớt thì bot và Zalo cùng dừng; Inbox vẫn xem được và Messenger vẫn nhận tin vào Worker.
4. App Review Meta kéo dài hoặc bị từ chối.
5. Giấy phép và mức bảo trì zca-js chưa kiểm tra.

## Câu hỏi còn mở

Không còn. Đã chốt 2026-10-08: người dùng đồng ý cách "lead chờ phân loại"; nhân viên giữ điện thoại của số chung.
