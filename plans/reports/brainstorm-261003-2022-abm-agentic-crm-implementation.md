# Brainstorm: ý tưởng triển khai ABM Agentic CRM

Ngày: 03/10/2026, Asia/Saigon. Nguồn: gói `.orca/drops/abm-agentic-crm-cook-20261003-201748.zip` (HANDOFF, PRD v2.1, design, critical review, GoClaw handoff). Có một checkpoint kongming (`--advice`). Đây là khuyến nghị để lập plan, chưa phải ADR đã duyệt.

## Hợp đồng brainstorm

- **Outcome:** CRM ABM Revenue & Customer Operations trên Cloudflare, đủ 12 module theo Capability Ladder, có agent GoClaw từ MVP0/1, bắt đầu bằng pipeline B2B và quản lý việc đội sale.
- **Constraints:** các quyết định user trong HANDOFF giữ nguyên (Cloudflare trừ GoClaw; MISA AMIS là nguồn thực thu; agent tự ghi nhận và nhắc nội bộ, gửi ra ngoài hoặc thay đổi quan trọng phải duyệt đúng payload; core ABM riêng, học Twenty). Agent không truy cập DB; actor/scope không lấy từ tham số model điền. Backup trước mọi thay đổi schema/data.
- **Non-goals:** sửa Design Studio AI; fork Twenty; workflow builder; multi-tenant SaaS; tự xác nhận thực thu; deploy production trước khi gate PoC đạt.
- **Acceptance criteria:** decision pack đóng 11 quyết định mục 43 PRD; ERD v1 và ADR stack được duyệt; PoC chứng minh D1 guarded write, trusted actor GoClaw, kill switch và CRM vẫn chạy khi GoClaw tắt; MVP1 đạt exit gate mục 35.8 cộng agent gates trong thiết kế.

## Bằng chứng mới so với gói bàn giao

- Repo đích chưa được ghi trong HANDOFF. `D:\TQD\CRM` đang trống (chỉ có `.orca/`), không phải git repo. Đề xuất dùng thư mục này.
- Máy có Node 24, pnpm 12, wrangler 4.126, git. GoClaw đang chạy trên PC Windows tại `D:\Goclaw` qua cloudflared tunnel, có patch nguồn chưa commit, không tự khởi động, rate limit 20 rpm cho mỗi API key, model deepseek-flash có hạn mức sử dụng.
- Theo docs.goclaw.sh (kongming đã đối chiếu): MCP client của GoClaw chỉ gửi header tĩnh cho mỗi server, dùng chung cho mọi người dùng. Telegram user id chỉ nằm trong session key. Có hook PreToolUse/PostToolUse dạng HTTP đồng bộ.
- D1 docs: batch là một transaction, statement lỗi làm rollback cả batch. Không có tài liệu về `changes()` bên trong batch.

## Ý tưởng triển khai đề xuất

### Stack (ứng viên cho ADR)

pnpm monorepo: `apps/web` (React + Vite + TanStack Router/Query, PWA, Workers Static Assets), `apps/api` (Hono trên Workers: REST + MCP Streamable HTTP không trạng thái), `packages/core` (domain, command/query, policy, approval, audit), `packages/contracts` (Zod). Drizzle + D1 migrations, R2, Queues + outbox, Cron Triggers. Test bằng Vitest với `@cloudflare/vitest-pool-workers`, cộng test trên D1 thật trước ADR.

`packages/contracts` là nguồn duy nhất cho mỗi command: schema input/output, scope yêu cầu và mức action-risk. Từ đó sinh validation REST, schema MCP tool và policy UI, không viết validator thứ hai. Durable Objects chỉ dùng cho chống trùng lịch tài nguyên (MVP3), không dùng nơi khác.

### Auth nhân viên

Cloudflare Access (Google Workspace hoặc OTP email) bảo vệ web. Worker xác minh JWT `Cf-Access-Jwt-Assertion`, không tin header trần, rồi map email sang CRM user/role/scope. Đường MCP tách khỏi policy trình duyệt, bảo vệ bằng Access Service Token hoặc HMAC riêng cho GoClaw. Chỉ cân nhắc Better Auth khi khách hàng/người ngoài đăng nhập (MVP4).

### Trusted actor GoClaw → CRM (điểm sửa quan trọng nhất)

Mã liên kết (nhân viên gõ `/link CODE` trên Telegram để gắn channel identity với CRM user) là đúng nhưng chưa đủ, vì user id tới CRM vẫn có thể do model điền. Hai phương án:

| Phương án | Giả định chính | Hỏng sớm nhất khi |
| --- | --- | --- |
| A. Mở rộng patch bridge GoClaw: ký HMAC (session key + tool call id + timestamp) vào mỗi MCP call; CRM chỉ nhận actor từ chữ ký | Chấp nhận duy trì fork GoClaw | Nâng cấp upstream làm mất patch |
| B. Giữ GoClaw gốc: hook PreToolUse gửi session metadata + hash args cho CRM, tạo attestation TTL ngắn mà MCP call phải khớp | Payload hook trên build thật có đủ session/user | Race giữa hook và call, payload hook thiếu dữ liệu |

Khuyến nghị A nếu user chấp nhận sửa nguồn GoClaw (đã có patch bridge sẵn nên không phải dòng bảo trì mới); B là phương án dự phòng. Dù chọn bên nào: phê duyệt chỉ thực hiện trong UI CRM đã xác thực, không duyệt bằng câu "ok" trong chat; ghi của agent ở MVP1 chỉ low-risk, idempotent, có audit.

### Ghi có điều kiện trên D1

Bỏ ý tưởng dùng `changes()`. Một batch gồm: `UPDATE ... WHERE id=? AND version=?`; sau đó `INSERT INTO _guard(ok) SELECT CASE WHEN version=?+1 THEN 1 ELSE 0 END FROM record WHERE id=?` với `CHECK(ok=1)` để ép rollback khi stale; audit và outbox cũng `SELECT ... WHERE id=? AND version=?+1`. Cách này chỉ dựa vào tính nguyên tử đã có tài liệu. PoC phải chứng minh writer song song bị rollback.

### Trình tự

1. **Pha A – Decision pack (1–2 tuần):** đóng mục 43 PRD cùng user, ERD v1, ADR stack/auth/actor, ma trận quyền và action-risk, init repo `D:\TQD\CRM`.
2. **Pha B – PoC cô lập:** D1 guard/concurrency/restore; GoClaw trusted actor + kill switch + test GoClaw tắt/khởi động lại (CRM vẫn chạy UI/REST, nhắc việc vẫn xếp hàng); MISA coverage chạy song song, không chặn.
3. **Pha C – MVP1 vertical slice có chat:** Customer → Lead → Assign → Activity → Next Action → Stage → Won/Lost, audit, dashboard Sale/Leader, PWA; agent đọc, ghi hoạt động/việc low-risk, nhắc việc, báo cáo CRM cơ bản.
4. MVP2–5 theo ladder trong thiết kế.

### Vận hành GoClaw

PC tại nhà là điểm lỗi đơn. Trước pilot: commit các patch vào nhánh fork, chuyển GoClaw sang VPS Linux bằng Docker Compose, tách API key theo ứng dụng để rate limit 20 rpm không chặn chung cả đội. Không chặn PoC.

## Trade-offs

- Core riêng trên Workers: kiểm soát gate và chuyển giao tốt, nhưng đội phải tự sở hữu RBAC, migration, restore. Hỏng sớm nhất khi đánh giá thấp chi phí nền tảng.
- Cloudflare Access: không lưu mật khẩu, nhanh; phụ thuộc giới hạn 50 seat miễn phí và việc nhân viên có email nhận OTP.
- Fork GoClaw (phương án A): actor chắc chắn nhất; chi phí là duy trì patch khi upstream đổi.

Better approaches: none — hướng khuyến nghị là hướng đã chọn trong gói thiết kế (core ABM riêng trên Cloudflare + GoClaw ngoài), chỉ sửa hai chi tiết kỹ thuật (attestation actor, guard D1) theo bằng chứng docs.

## Rủi ro lớn nhất

Giả mạo actor hoặc prompt injection chéo người dùng qua một agent `tqd` dùng chung, một credential MCP chung và 20 rpm cho mỗi key. Phải chốt thiết kế attestation trước khi có bất kỳ write tool nào.

## Cập nhật 22:23 — kênh chat là Lark, mỗi nhóm là một phòng ban

Quyết định user: nhân viên chat trên Lark; agent được gắn vào từng nhóm chat; mỗi nhóm là một phòng ban và gắn với quyền truy cập. Quyết định này thay Telegram làm kênh nội bộ và thay mã `/link` trong mục trusted actor ở trên.

Bằng chứng từ docs.goclaw.sh (bản tải về ngày 03/10/2026, chưa kiểm trên build đã patch tại `D:\Goclaw`):

- GoClaw có kênh Larksuite gốc (websocket hoặc webhook), có `group_policy: allowlist`, `group_allow_from`, `require_mention` và cấu hình riêng cho từng nhóm theo chat ID (có thể gán agent cho từng nhóm).
- Trong nhóm, phiên có `user_id` là `group:<channel>:<chatId>` và một `sender_id` riêng.
- MCP server hỗ trợ credential riêng theo người dùng (`require_user_credentials`). Trước khi gọi tool, GoClaw xác định người dùng để lấy credential: trong nhóm, nó thử người gửi trước, nếu không ra thì dùng nhóm.
- Hook PreToolUse dạng HTTP có thể trả `updatedInput` để sửa input của chính lần gọi tool đó.
- Rate limit 20 rpm áp cho API key của HTTP API; kênh chat nối trực tiếp nên không bị giới hạn này.
- Link Lark docx dán vào chat được tự đọc và đưa vào prompt, nên đây là một đường prompt injection.

Thiết kế điều chỉnh:

1. **Người là chủ thể, nhóm là dự phòng.** CRM cấp credential MCP riêng cho từng nhân viên (gắn Lark open_id ↔ CRM user) và một credential cho mỗi nhóm phòng ban. Danh tính và scope lấy từ credential, không từ tham số model. Credential của nhóm chỉ đọc dữ liệu phòng ban và ghi low-risk không gắn với người cụ thể.
2. **CRM tự giữ bảng chat_id → phòng ban → scope.** Không tin GoClaw hay model về việc nhóm thuộc phòng nào.
3. **Bảo vệ nhóm:** chỉ owner được mời thành viên, không có người ngoài, GoClaw đặt `group_policy: allowlist`. Một cron trong CRM so thành viên nhóm (qua Lark API) với danh sách phòng ban, gặp người lạ thì khóa credential của nhóm.
4. **Hiển thị trong nhóm:** câu trả lời mọi thành viên đều thấy, nên dữ liệu trả trong nhóm giới hạn ở mức phòng ban được phép xem. Câu hỏi cá nhân hoặc nhạy cảm chuyển sang DM với bot. Điều này lệch với PRD 23.1 (Sale chỉ xem dữ liệu của mình), nên cần user chốt.
5. **App Lark riêng của CRM** (tách khỏi app GoClaw) để gửi nhắc việc, thông báo và thẻ phê duyệt. Lark ký callback khi người duyệt bấm thẻ, nên CRM biết chắc ai đã duyệt. Nhắc việc vẫn chạy khi GoClaw tắt.
6. **Thư mục người dùng:** đồng bộ nhân viên và phòng ban từ Lark (open_id, email, employee_id) sang CRM user/team. Đăng nhập web bằng Lark OAuth, hoặc Cloudflare Access OTP email đối chiếu theo email Lark trong PoC.
7. **Agent theo vai trò:** mỗi vai trò phòng ban có một agent (Sales, CSKH, Triển khai, BGĐ) với danh sách tool riêng, gắn vào nhóm tương ứng. Bỏ hướng một agent `tqd` dùng chung.

Thứ tự dự phòng cho việc xác định người gửi: (1) credential theo người qua cơ chế liên kết contact gốc của GoClaw; (2) hook PreToolUse trả `updatedInput` chèn chứng thực có chữ ký; (3) patch bridge GoClaw ký `sender_id`. Bỏ ý tưởng cho model truyền message_id vì người khác trong nhóm có thể dùng message_id của đồng nghiệp để giả danh.

Rủi ro lớn nhất đã đổi: toàn bộ mô hình quyền phía chat dựa vào việc GoClaw liên kết đúng Lark open_id với người dùng, mà tài liệu chưa mô tả rõ cho Lark và build tại `D:\Goclaw` đã được patch. Ngày đầu Pha B phải kiểm trên binary thật: thiết lập liên kết contact Lark, xem credential nào được dùng khi một người gửi trong nhóm, và payload thật của hook PreToolUse.

## Quyết định user ngày 03/10/2026

- Trong nhóm phòng ban, pipeline phòng ban xem được; hoa hồng, lý do Lost và dữ liệu cá nhân khách chỉ trả lời qua DM. Đây là điều chỉnh có chủ đích so với PRD 23.1 cho bề mặt chat nhóm; UI web vẫn áp scope cá nhân/team theo RBAC.
- Nhóm Lark không có người ngoài công ty; có Lark admin để tạo app CRM và cấp quyền danh bạ/phòng ban.
- Lark chỉ dùng cho chat; không có dữ liệu Lark Base cần migrate.
- Mỗi nhân viên làm bước liên kết tài khoản một lần qua DM với bot để ghi nhận theo người.

- Pilot 15–50 người dùng, nằm trong gói Cloudflare Access miễn phí (tối đa 50 seat).
- Pipeline B2B dùng mẫu PRD 10.2: Lead mới → Đã liên hệ → Tiềm năng → Tư vấn → Báo giá → Đàm phán → Chờ chốt → Won/Lost. Lý do Lost và SLA từng stage chốt trong Pha A.
- MVP1 agent tự làm: ghi hoạt động, tạo việc tiếp theo/nhắc việc, tạo lead có kiểm trùng. Phải duyệt: đổi stage, Won/Lost, đổi owner, mọi gửi ra ngoài.
- RPO ≤ 1 giờ, RTO ≤ 4 giờ: D1 Time Travel cộng export R2 hằng ngày; thời hạn lưu audit (đề xuất tối thiểu 2 năm) chốt trong Pha A.

- User là người duy nhất quản trị và duy trì GoClaw. Hệ quả: ưu tiên cơ chế gốc của GoClaw (liên kết contact, hook `updatedInput`) trước patch bridge để giảm việc bảo trì fork; runbook vận hành/khôi phục GoClaw phải viết đủ để người khác tiếp quản được.
- Repo CRM là `D:\TQD\CRM`; git đã khởi tạo ngày 03/10/2026.

## Câu hỏi chưa giải quyết

1. Lý do Lost và SLA từng stage (chốt trong Pha A).
2. Thời hạn lưu audit và dữ liệu CRM (chốt trong Pha A).
