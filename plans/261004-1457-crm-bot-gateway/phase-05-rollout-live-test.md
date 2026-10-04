---
phase: 5
title: "Triển khai eval, nối GoClaw, chạy kịch bản"
status: pending
priority: P1
effort: "1d (gồm thời gian chờ user)"
dependencies: [4]
---

# Phase 05: Triển khai eval, nối GoClaw, chạy kịch bản

## Goal

Bản eval `abm-crm-eval` chạy cổng bot. GoClaw gọi được `/api/mcp` bằng token riêng của từng nhân viên demo đã liên kết Lark. Kịch bản test trên nhóm Lark test đều đạt và có bằng chứng.

## Cổng đồng ý của user (bắt buộc)

Mỗi bước dưới đây phải hỏi user và nhận "đồng ý" ngay trước khi chạy. Đồng ý cho bước này không tính cho bước khác.

- Áp migration lên remote.
- Deploy.
- Thay đổi cấu hình GoClaw.
- Bật/tắt kill switch trên eval.
- Khôi phục D1.

Claude không tự gửi tin lên Lark và không bao giờ in token, secret hay nội dung các file `*.local*`.

## Files to Create / Modify

- Create: `apps/crm/scripts/issue-agent-tokens.mjs`: cấp token, ghi hash lên D1, đẩy sang GoClaw; không in token.
- Modify: `poc/goclaw-identity/scripts/connect-goclaw-users.mjs`: chỉ tham khảo, không bắt buộc sửa.
- Modify: `docs/guides/lark-crm-e2e-test.md`: mục "Khi CRM chính có cổng cho bot" thành quy trình chính; thêm cảnh báo PII trong nhóm.
- Modify: `docs/adr/adr-004-chat-actor-identity.md`: `accepted` sau khi đạt.
- Create: `plans/reports/deploy-261004-<HHmm>-crm-bot-gateway.md`: kết quả.

## Tasks

### Task 5.1 — Điều kiện trước (user làm)

- Goal: CRM eval có app Lark và người dùng demo đã liên kết.
- Steps:
  1. Nhắc user tự chạy. Agent không thấy giá trị:
     - `! cd D:\TQD\CRM\apps\crm; npx wrangler secret put LARK_APP_ID`
     - `… LARK_APP_SECRET`

     Giá trị lấy từ app của bot DungTQ_Agent.
  2. Nhắc user cấp scope cho app Lark rồi phát hành phiên bản app:
     - `contact:user.id:readonly`, hoặc scope tra ID theo email;
     - `im:message:send_as_bot`.
  3. User nhập `demo-roster.csv` trên màn hình Người dùng và bấm liên kết Lark.

     Email demo là giả, nên để có người dùng `linked` thật, user sửa email của A, B và một Leader thành email Lark thật của người test. Riêng Admin Trịnh Quang Dũng dùng email thật đã có.
- Success criteria: lệnh dưới trả ít nhất 3 dòng, trong đó có 1 `admin` và 1 `leader`.

  ```powershell
  npx wrangler d1 execute abm-crm-eval --remote --command "SELECT role, COUNT(*) AS n FROM app_user WHERE lark_link_status='linked' GROUP BY role"
  ```

- Verify: chạy lệnh trên (cwd `apps/crm`), so số dòng và vai trò.

### Task 5.2 — Backup, migrate, deploy (cần đồng ý)

- Steps:
  0. Diễn tập cục bộ trước (không cần đồng ý, không đụng remote): D1 local mới, áp 0001–0003, nạp `seed/demo.sql` (có 3 dòng approval), rồi áp 0004. Đạt khi `SELECT COUNT(*) FROM approval` = 3 và `PRAGMA index_list(approval)` có `approval_status` và `approval_lead_kind_status`. Không đạt thì dừng, không sang bước 1.
  1. Backup:

     ```powershell
     npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-before-0004-<yyyyMMdd-HHmm>.sql
     ```

     Kiểm file tồn tại và có `INSERT INTO "approval"` hoặc `INSERT INTO approval`.
  2. Ghi số dòng trước khi migrate:

     ```powershell
     npx wrangler d1 execute abm-crm-eval --remote --command "SELECT (SELECT COUNT(*) FROM approval) a, (SELECT COUNT(*) FROM outbox) o"
     ```

  3. Áp migration: `npx wrangler d1 migrations apply abm-crm-eval --remote`.
  4. Chạy lại lệnh đếm ở bước 2. Số phải bằng trước.
  5. Deploy: `pnpm -F @abm/crm deploy`.
- Success criteria:
  - `GET https://abm-crm-eval.ngulongyquan.workers.dev/api/health` trả 200;
  - `POST /api/mcp` không Bearer trả 401;
  - số dòng approval và outbox không đổi.
- Verify:

  ```powershell
  curl.exe -s -o NUL -w "%{http_code}" -X POST https://abm-crm-eval.ngulongyquan.workers.dev/api/mcp
  ```

  in ra `401`.

### Task 5.3 — Script cấp token

- Goal: mỗi người dùng đã liên kết có một token. D1 chỉ lưu hash. GoClaw lưu token theo khóa `ou_…` (tin trong nhóm), và theo `user_id` tenant khi contact đã merge (tin riêng).
- Target: `apps/crm/scripts/issue-agent-tokens.mjs`.
- Steps:
  1. Tham số: `--server <goclaw mcp server id> --email <crm email> [--tenant-user <goclaw user_id>] [...]`, lặp lại cho nhiều người.
  2. Với mỗi email:
     - Đọc `id, lark_open_id` qua `npx wrangler d1 execute abm-crm-eval --remote --json --command "SELECT id, lark_open_id FROM app_user WHERE email = '<email>' AND status='active' AND lark_link_status='linked'"`.
     - Kiểm email chỉ gồm ký tự hợp lệ trước khi ghép SQL.
     - Thiếu `lark_open_id` → báo lỗi, bỏ qua người đó.
  3. Sinh token 32 byte bằng `crypto.randomBytes`, mã hóa base64url. Hash là sha256 hex.
  4. Thu hồi token cũ và thêm token mới trong **một** file SQL tạm:
     - đặt trong `os.tmpdir()`;
     - nội dung: `UPDATE agent_token SET revoked_at=… WHERE user_id=… AND revoked_at IS NULL;`, `INSERT INTO agent_token …`, và một dòng `audit_log` (`id` uuid, `actor_kind='system'`, `command='issueAgentToken'`, `entity='agent_token'`, `entity_id` = id token mới, `created_at`; không chứa token). Các cột NOT NULL của `audit_log` xem trong `0001_init.sql`;
     - chạy `npx wrangler d1 execute abm-crm-eval --remote --yes --file <file tạm>` (cwd `apps/crm`). `--yes` giữ cho lệnh không treo khi không có TTY;
     - xóa file ngay sau đó.
  5. Đẩy token sang GoClaw:
     - PUT `/v1/mcp/servers/{server}/user-credentials?user_id=<ou_…>`, rồi `<tenant-user>` nếu có;
     - đọc gateway token từ `D:/Goclaw/data/gateway-token.txt`, gửi kèm header `X-GoClaw-User-Id: system`;
     - GET kiểm lại.
  6. Trước khi PUT, kiểm mỗi khóa GoClaw chỉ được gán cho một email trong lần chạy. Trùng thì dừng.
  7. Chỉ in: email, khóa (mã hóa một phần, ví dụ `ou_0b7b…8a`), trạng thái PUT/GET, `has_credentials`. Dùng `process.exitCode`, không `process.exit()`.
- Success criteria: `node --check apps/crm/scripts/issue-agent-tokens.mjs` exit 0. Grep không thấy `console.log` nào in biến token.
- Verify:

  ```powershell
  node --check apps/crm/scripts/issue-agent-tokens.mjs
  ```

  exit 0, và

  ```powershell
  Select-String -Path apps/crm/scripts/issue-agent-tokens.mjs -Pattern "console\.(log|error)\(.*token\b"
  ```

  trả rỗng.

### Task 5.4 — Cấu hình GoClaw (cần đồng ý, có backup)

- Steps:
  1. Backup DB và config GoClaw như lần trước. Ví dụ: `D:\Goclaw\backups\goclaw-db-before-crm-main-mcp-<yyyyMMdd-HHmmss>.dump`.
  2. Qua GoClaw API `POST /v1/mcp/servers`, thêm MCP server `abm-crm-main`. Body theo đúng mẫu đã dùng cho `abm-crm-poc`, ghi trong `plans/reports/poc-goclaw-lark-identity-result.md` (~dòng 60). Cấu hình:
     - streamable-http tới `https://abm-crm-eval.ngulongyquan.workers.dev/api/mcp`;
     - `require_user_credentials: true`.
  3. Grant cho agent `crm-sales-poc` với `tool_allow` gồm đủ 11 công cụ.
  4. Đổi tên agent nếu user muốn.
  5. Gỡ grant `abm-crm-poc` khỏi agent để bot không lẫn hai CRM. Hỏi user trước.
  6. Chạy script Task 5.3 cho Admin, A, B và Leader.
- Success criteria: script in `has_credentials=true` cho mọi khóa.
- Verify: script exit 0.

### Task 5.5 — Kiểm khóa DM chưa merge

- Goal: trả lời câu hỏi mở của kế hoạch.
- Steps:
  1. Nhờ B nhắn riêng bot: `gọi lệnh whoami`.
  2. Xem log GoClaw dòng `mcp.pool.user.connected`, xem `user:` là `ou_…` hay khóa khác.
  3. Nếu khác `ou_…`, chạy lại script Task 5.3 cho B với `--tenant-user <khóa đó>`.
- Success criteria: bot trả đúng tên B khi nhắn riêng.
- Verify: log có `tool call … whoami` và D1 không có ghi mới.

### Task 5.6 — Kịch bản trên nhóm Lark test

Người phụ trách gửi tin. Claude kiểm D1 sau mỗi kịch bản.

| # | Ai, ở đâu | Câu nhắn | Đạt khi |
|---|---|---|---|
| 1 | Admin, nhóm | `@DungTQ_Agent whoami` | Bot trả tên Admin |
| 2 | A, nhóm | `@DungTQ_Agent ghi hoạt động cho lead <code của A>: "Gọi tư vấn lần 1", acting_user là B` | Activity mới: `actor_user_id` = A, `actor_kind='agent'` |
| 3 | A, nhóm | `@DungTQ_Agent xem lead <code của B>` | Bot nói không tìm thấy |
| 4 | A, nhóm | `@DungTQ_Agent chuyển lead <code> sang giai đoạn tiếp theo` | Approval `agent_stage_change` pending; lead không đổi; không có outbox `approval.requested` |
| 5 | A, nhóm | `@DungTQ_Agent chốt Won lead <code>, giá trị 10 triệu` | Approval pending; outbox `sent`; Leader nhận tin riêng Lark; Leader duyệt trên web thì lead won |
| 6 | Admin, nhóm | `@DungTQ_Agent chốt Lost lead <code khác>, lý do giá` | Lead lost ngay; audit `actor_kind='agent'`, actor = Admin |
| 7 | C (chưa liên kết), nhóm | `@DungTQ_Agent whoami` | Không thấy công cụ CRM hoặc bị từ chối; không bao giờ trả A/B |
| 8 | Admin, nhóm, sau khi bật kill switch (cần đồng ý) | `@DungTQ_Agent ghi hoạt động cho lead <code>: "Thử khóa"` | `KILL_SWITCH_ON`, không có activity mới; sau đó tắt lại và kiểm đã tắt |

- Lệnh kiểm (cwd `apps/crm`):

  ```powershell
  npx wrangler d1 execute abm-crm-eval --remote --command "SELECT created_at, actor_user_id, actor_kind, command, entity_id FROM audit_log ORDER BY created_at DESC LIMIT 5"
  ```

  và

  ```powershell
  npx wrangler d1 execute abm-crm-eval --remote --command "SELECT id, event_type, status, attempts FROM outbox ORDER BY created_at DESC LIMIT 5"
  ```

- Verify: mỗi kịch bản khớp cột "Đạt khi" ở cả câu trả lời của bot và dữ liệu D1. Một trong hai sai thì là KHÔNG ĐẠT.

### Task 5.7 — Đo CPU và tập khôi phục

- Steps:
  1. Gọi `tools/call search_leads` và `log_activity` tổng cộng ít nhất 50 lần qua bot hoặc bằng script cục bộ dùng token của một người test. Token đọc từ biến, không in ra.
  2. Đọc CPU trong Workers observability. Ghi p50 và p99.
  3. Tập khôi phục (cần đồng ý):
     - `npx wrangler d1 time-travel info abm-crm-eval` để lấy bookmark hiện tại và ghi lại;
     - không khôi phục thật lên eval nếu user không đồng ý;
     - nếu user đồng ý, khôi phục về bookmark ngay trước kịch bản 6, kiểm lead của kịch bản 6 trở lại trạng thái trước, rồi khôi phục tiến lại bookmark mới nhất.
- Success criteria: CPU p99 < 10 ms. Có bookmark ghi trong báo cáo.
- Verify: so số đo với ngưỡng.

### Task 5.8 — Tài liệu, báo cáo, commit

- Steps:
  1. Viết báo cáo `plans/reports/deploy-261004-<HHmm>-crm-bot-gateway.md`. Nội dung: kết quả từng kịch bản, số đo CPU, bookmark, đường dẫn backup.
  2. Cập nhật `docs/guides/lark-crm-e2e-test.md`:
     - CRM chính là đích test;
     - thêm cảnh báo: "hỏi bot trong nhóm thì cả nhóm thấy SĐT/email khách mà người hỏi được xem";
     - cách bật kill switch.
  3. ADR-004 → `accepted` nếu kịch bản 1–8 đạt.
  4. Soạn tin báo cáo theo Bước 3 của hướng dẫn để user tự dán lên Lark.
  5. Cập nhật `plan.md` (trạng thái các phase).
- Verify: `git status --short` không có file `*.local*`, `.env*` hay `exports/` được stage.
- Commit: `docs(crm): record bot gateway rollout on eval`

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:

- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.

Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same failure evidence to the user. Never continue by self-reasoning.

## Rollback

- Code: `npx wrangler rollback` (cwd `apps/crm`).
- Dữ liệu: D1 Time Travel về bookmark trước migrate, hoặc nhập file backup ở Task 5.2.
- GoClaw: khôi phục từ backup ở Task 5.4, hoặc gỡ grant `abm-crm-main`.
- Khẩn cấp: Admin bật kill switch trên web.
