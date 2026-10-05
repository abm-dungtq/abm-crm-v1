# PoC GoClaw + Lark identity — kết quả thực thi

Ngày: 2026-10-04 (Asia/Saigon). Task: `task_a12757e5441c`; dispatch hiện tại: `ctx_f3cba33d9cb7`.

Phạm vi: [phase 06](../261003-2239-abm-crm-foundation-poc/phase-06-poc-goclaw-lark-identity.md). Theo hướng dẫn coordinator `msg_faa5265fc4ee`, user chọn LOCAL ONLY: hoàn tất kiểm chứng local và checklist live, giữ các bước live PENDING-HUMAN. Task 6.2 đã PASS 8/8 test và typecheck; chưa có bằng chứng live để chọn cơ chế, nên [ADR-004](../../docs/adr/adr-004-chat-actor-identity.md) giữ proposed. Không thay đổi GoClaw/Lark, tạo tài nguyên remote, sinh credential thật hay ghi MISA; không commit.

## Đường liên kết

Nguồn: [GoClaw full docs](https://docs.goclaw.sh/llms-full.txt), tải ngày 2026-10-04, mục User Identity Resolution, Contacts, Tenant Users, MCP User Credentials. Docs chỉ liệt kê route merge, không mô tả body; body dưới đây được đối chiếu read-only với `D:/Goclaw/source/internal/http/contact_merge_handlers.go` và `mcp_user_credentials.go`. Đây là hướng dẫn chưa thực thi, không phải bằng chứng runtime.

### (a) Liên kết contact Lark của A và B

1. Sau backup và user consent, dùng nhóm riêng CRM-PoC và tài khoản thử A/B/C. A, B gửi DM bot để contact cá nhân xuất hiện. User admin đăng nhập GoClaw trong tenant đúng; mọi API sau dùng phiên admin đã xác thực và tenant đúng, không đưa secret vào báo cáo.
2. Gọi `GET /v1/contacts` (có phân trang), tìm contact đúng channel instance Lark/feishu và sender `ou_...` của A/B; tránh chọn contact nhóm hoặc contact ở instance khác. Gọi `GET /v1/tenant-users` lấy UUID `id` và chuỗi `user_id` của tenant user tương ứng.
3. Với từng nhân viên, gọi `POST /v1/contacts/merge` với `{"contact_ids":["<contact UUID>"],"tenant_user_id":"<tenant user UUID>"}`. Nếu user chưa tồn tại, body thay `tenant_user_id` bằng `"create_user":{"user_id":"<user ID đã được admin xác nhận>","display_name":"<tên thử>"}`. Không gửi đồng thời hai trường target. Không tự tạo hay chọn danh tính nghiệp vụ.
4. Kiểm `GET /v1/contacts/merged/<tenant user UUID>` chứa contact đúng. Merge còn di chuyển context files theo source; vì vậy đây là thay đổi GoClaw phải backup/consent trước.

### (b) Credential per-user

1. Sau khi user tạo MCP server `abm-crm-poc` với `require_user_credentials: true`, dùng UUID server thực tế.
2. Admin gọi `PUT /v1/mcp/servers/<server UUID>/user-credentials?user_id=<tenant user user_id>` cho A rồi B, body `{"headers":{"Authorization":"Bearer [redacted]"}}`, với token riêng của từng user. Query dùng chuỗi `user_id`, không dùng UUID record `tenant_user_id` của merge. User mở file local token để nhập; executor không in token.
3. Gọi `GET` cùng route/query; xác nhận `has_credentials` và `has_headers`, endpoint chỉ trả metadata. Quyền target khác caller yêu cầu system admin hoặc tenant admin/owner cùng tenant.

### (c) Credential contact nhóm CRM-PoC

1. Lấy contact nhóm đúng instance, `contact_type=group` và sender chat ID thực (Lark thường `oc_...`) trong `GET /v1/contacts`.
2. Merge contact nhóm qua cùng `POST /v1/contacts/merge` vào tenant user riêng đại diện nhóm, khác A/B; dùng UUID user nhóm đã được admin xác nhận, hoặc `create_user` đã được user đồng ý. Không merge nhóm vào nhân viên.
3. Đặt token group bằng `PUT /v1/mcp/servers/<server UUID>/user-credentials?user_id=<group tenant user user_id>` với body headers Authorization như trên; kiểm presence bằng GET. CRM token phải map subject group CRM-PoC, không map nhân viên.
4. Resolver thử sender cá nhân trước, sau đó lấy chat ID từ `group:{channel}:{chatID}` để resolve contact nhóm. C chưa liên kết chỉ được ra group hoặc bị từ chối; phải kiểm thực tế tại Task 6.5.

Docs dùng chữ “numeric sender ID” theo nhóm Telegram; Lark dùng `ou_...`. Source `internal/agent/user_identity_resolver.go` hiện chỉ cắt hậu tố `|`, không parse số, nên có đường liên kết trên source; việc sender thực được truyền đúng tới resolver và credential pool vẫn chưa được chứng minh. Task 6.5 phải kiểm A/B trong nhóm và DM, không kết luận PASS từ docs/source.

## Trạng thái thực thi và Verify

| Task | Kết quả Verify | Bằng chứng |
| --- | --- | --- |
| 6.0 | PASS | Lệnh grep nguyên văn dưới Git Bash trả `1`, exit 0; kiểm lại sau cập nhật báo cáo. |
| 6.1 | PASS (bằng chứng dispatch trước) | Health HTTP 200, body `{"status":"ok","protocol":3}`; thời điểm bên dưới. Không gọi lại GoClaw trong dispatch LOCAL ONLY. |
| 6.2 | PASS | Lệnh nguyên văn dưới Git Bash exit 0, `Tests 8 passed (8)`, không có `failed`; typecheck exit 0. |
| 6.3 | PASS (trừ ADMIN_TOKEN do user đặt) | 2026-10-04 12:05, user duyệt. Xem mục Live run bên dưới. |
| 6.4 | IN-PROGRESS | Backup GoClaw xong; chờ user tạo nhóm CRM-PoC và cấu hình. |
| 6.5 | PENDING-HUMAN | Chưa chạy query remote và 5 kịch bản Lark thật. |
| 6.6 | PENDING-HUMAN (có điều kiện) | Chỉ chạy khi 6.5 fail hoặc không có đường Lark; chưa có payload tin cậy hay 5 PASS. |
| 6.7 | PENDING-HUMAN | Chưa có 3 PASS live; cần user duyệt kill switch và chọn downtime. |
| 6.8 | PASS (Verify tài liệu); dọn dẹp PENDING-HUMAN | Marker ADR-PROPOSED đúng một dòng, báo cáo tồn tại. Không nhận cơ chế accepted; coordinator sở hữu commit. |

## Live run 2026-10-04

User duyệt Task 6.3 và tự tạo nhóm CRM-PoC cho 6.4/6.5.

- Kiểm lại trước live: GoClaw health 200 `{"status":"ok","protocol":3}`; HEAD `549c81fd…` không đổi; test PoC 8/8, typecheck sạch.
- D1 `abm-crm-poc-identity` tạo mới, kiểm rỗng (chỉ `_cf_KV`), ghi ID vào `wrangler.jsonc`, áp migration `0001_init.sql`.
- Worker: https://abm-crm-poc-identity.ngulongyquan.workers.dev (version `1d0d2f0a`).
- `scripts/issue-tokens.mjs` chạy một lần, ghi `.tokens.local` (đã ignore, không mở/in). Ba hash nạp qua `seed-poc.local.sql` cùng user thử A/B (email `@example.test`) và nhóm `CRM-PoC` (department `poc-sales`). Remote có 3 credential A, B, CRM-PoC, `revoked=0`.
- Verify: `POST /mcp` không token → 401; `GET /health` → 200; `POST /admin/kill-switch` → 401 (chưa có `ADMIN_TOKEN`, fail closed).
- 14:21: user tạo nhóm Lark test mới, thêm bot và nhắn trong nhóm. GoClaw (kiểm chỉ đọc qua API và `logs\gateway.log`) ghi nhận contact nhóm `oc_e9424f03…` (instance `abm-lark`) và người gửi `ou_0b7b5…`. Phiên được lập theo nhóm (`agent:tqd:abm-lark:group:<chat_id>`, user `group:abm-lark:<chat_id>`), tức mặc định GoClaw coi cả nhóm là một người. Instance `abm-lark` hiện gắn agent `tqd` (cùng agent với Telegram), `group_policy: open`, `require_mention: true`. Chưa có MCP CRM, chưa merge contact.
- 14:25–14:30, user đồng ý 5 bước (Task 6.4):
  1. Backup `D:\Goclaw\backups\goclaw-db-before-crm-lark-agent-20261004-142549.dump` (707 952 byte, pg_dump exit 0), `config-before-crm-lark-agent-20261004-142549.json`, và cấu hình instance `abm-lark-instance-before-crm-lark-agent-20261004-142549.json` (agent cũ `tqd`, `group_policy: open`).
  2. Agent `crm-sales-poc` (id `01a105ce-7600-…`, predefined, `deepseek-flash`, tool `datetime`).
  3. MCP server `abm-crm-poc` (id `01a105ce-94e7-70d7-9ffe-a472a71dcdfe`), `streamable-http` tới `<PoC Worker>/mcp`, `settings.require_user_credentials: true`; grant cho `crm-sales-poc` với `tool_allow: [whoami, add_activity]`.
  4. Instance `abm-lark` chuyển sang `crm-sales-poc`. Telegram `tqd` giữ nguyên. Thử `group_policy: allowlist` + `group_allow_from: [oc_…]` thất bại về thiết kế: với Feishu, allowlist so **sender** (`ou_…`), không so chat ID (`bot_policy.go` `checkGroupPolicy`), nên mọi tin nhóm sẽ bị chặn. Đã đổi sang `group_policy: pairing`: nhóm lạ nhận mã ghép, chỉ nhóm được duyệt (`goclaw pairing approve <code>`, cần `GOCLAW_GATEWAY_TOKEN` trong env) mới chạy.
  5. Merge contact: `ou_0b7b5…` (user, Admin Trịnh Quang Dũng) → tenant user `crm-poc-a`; contact nhóm `oc_e9424…` → `crm-poc-group`. Token đặt bằng `scripts/connect-goclaw-users.mjs` do user chạy (script không in token). Admin là subject A: user quyết định Admin được ghi dữ liệu qua GoClaw để test.
- 14:35, kịch bản 1 lần đầu: bot trả lời "không có lệnh whoami"; log `tools_provided=1` (chỉ `datetime`). Nguyên nhân đã đọc trong source: tool MCP per-user được nạp theo `resolveActorUserID` (`internal/agent/loop_mcp_user.go`), trong nhóm trả **sender open_id thô** (`ou_…`), không dùng `CredentialUserID` của contact merge. Nhắn riêng thì dùng `UserID` đã thay bằng `user_id` tenant (`crm-poc-a`). Vì vậy credential phải đặt theo cả hai khóa: `crm-poc-a` (DM) và `ou_0b7b5…` (nhóm). Đã đặt thêm khóa `ou_…` cho A lúc 14:40. Hệ quả: trong nhóm, credential nhóm `crm-poc-group` không bao giờ được dùng; người chưa có credential theo `ou_` sẽ không thấy tool CRM (từ chối, không mạo danh).
- Backup GoClaw trước 6.4: `D:\Goclaw\backups\goclaw-db-before-crm-poc-20261004-120758.dump` (704 456 byte, pg_dump exit 0) và `config-before-crm-poc-20261004-120758.json`.

## Build GoClaw và patch

`git -C D:/Goclaw/source rev-parse HEAD` trả `549c81fd2406875be34cec3d7274125238e7d4a0`. Đây là HEAD checkout, chưa chứng minh binary runtime cùng revision. Health ghi nhận lúc `2026-10-03 17:07:43 UTC`.

Output `git -C D:/Goclaw/source status --short`:

```text
 M cmd/gateway_providers.go
 M cmd/migrate.go
 M cmd/migrate_test.go
 M internal/gateway/server.go
 M internal/http/provider_models.go
 M internal/http/providers.go
 M internal/mcp/bridge_server.go
 M internal/providers/adapter_openai.go
 M internal/providers/openai_chat.go
 M internal/providers/openai_config.go
 M internal/providers/openai_http.go
 M internal/store/provider_store.go
 M ui/web/src/constants/providers.ts
?? internal/gateway/bridge_tool_policy.go
?? internal/gateway/bridge_tool_policy_test.go
?? internal/mcp/bridge_authorization_test.go
?? internal/providers/openai_session_header.go
?? internal/providers/openai_session_header_test.go
?? internal/webui/dist/
```

## Bằng chứng local

Đã tạo `poc/goclaw-identity/` gồm manifest, config Worker, migration, Hono endpoint, tools, token issuer và test dùng D1 Miniflare. `/hooks/pre-tool-use` hiện fail closed `HOOK_NOT_CONFIGURED`; chưa có sample hook tin cậy nên không triển khai cơ chế 2 theo giả định. REST đọc activity là `GET /admin/activity`, yêu cầu admin credential; `/health` không phụ thuộc GoClaw. Credential nhóm ghi `initiating_user=NULL`, subject group vẫn lưu riêng theo ADR-004. Database ID trong Wrangler chưa được cấp, không được dùng config hiện tại để deploy remote. Chưa chạy token issuer; `.tokens.local` đã được ignore sẵn trước dispatch nên không cần sửa `.gitignore`.

Lệnh Task 6.2 chạy nguyên văn dưới Git Bash lúc 09:37:26 Asia/Saigon:

```sh
cd /d/TQD/CRM && pnpm -F @abm/poc-goclaw-identity test
```

```text
$ vitest run
RUN v4.1.11 D:/TQD/CRM/poc/goclaw-identity
Test Files 1 passed (1)
Tests 8 passed (8)
Duration 1.90s
```

Exit 0; output không chứa `failed`. `pnpm -F @abm/poc-goclaw-identity typecheck` cũng exit 0 (`tsc --noEmit`). Test sử dụng D1 runtime của Cloudflare, áp migration trong database test cô lập; không dùng D1 remote hay sửa database GoClaw. Tám test kiểm missing/invalid/revoked token, danh tính A/B/group, bỏ qua acting_user giả, group không mạo danh nhân viên, admin authentication và kill switch, rollback khi audit lỗi, REST độc lập, initialize/list/notification MCP. Đây không phải năm kịch bản Lark live và không chứng minh downtime thực tế.

Coordinator đã duyệt đổi cấu hình test sang Vitest `4.1.11` + `@cloudflare/vitest-plugin` `1.3.6`, dùng `cloudflareTest` và `defineConfig` thay `defineWorkersConfig`. Cấu hình nằm tại [vitest.config.ts](../../poc/goclaw-identity/vitest.config.ts). Coordinator đã xử lý shared dependency/install trước dispatch này; worker không sửa shared workspace hay lockfile.

## Lịch sử blocker đã được giải quyết

Lệnh cài dependency: `pnpm install --filter @abm/poc-goclaw-identity --lockfile=false`, exit 1. Output cuối:

```text
Error: ERR_PNPM_PACKAGE_MANAGER_LIFECYCLE_ORDER
  × installing dependencies
  ╰─▶ Unable to determine lifecycle order for workspace projects: D:\TQD\CRM
```

Lỗi trên thuộc dispatch trước `ctx_8110185d339e`, từng gửi câu hỏi `msg_26dc5db7b3b7` và escalation `msg_a954ce3b8e81`. Coordinator xác nhận lúc 09:33 đã xử lý dependency và allowBuilds esbuild/workerd; test và typecheck hiện PASS nên lỗi này không còn chặn local.

Hướng dẫn transport dựa trên [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports); D1 test dựa trên [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/core/standards/). Chưa xác minh compatibility live với client GoClaw.

## Checklist live cho lượt có user

Mọi bước dưới đây chưa chạy. Trước mỗi thay đổi remote/GoClaw, gửi Orca ask cho coordinator để lấy quyết định của user; nếu Verify không đạt thì STOP và gửi exact command cùng full output đã che secret. Không tự patch GoClaw hoặc suy diễn PASS từ test local.

### Task 6.3 — Worker và D1 cô lập

1. Xin user đồng ý tạo riêng Worker/D1 `abm-crm-poc-identity`. Chạy từ `poc/goclaw-identity/`; nếu chưa xác thực Wrangler, user thực hiện login. Không dùng credential/account ID trong báo cáo.
2. Sau approval, chạy `npx wrangler d1 create abm-crm-poc-identity`; thay UUID placeholder trong `wrangler.jsonc` bằng ID vừa cấp. Trước thay đổi dữ liệu database đã có, export backup; database mới phải xác nhận rỗng. Chạy `npx wrangler d1 migrations apply abm-crm-poc-identity --remote` rồi `npx wrangler deploy`; lưu URL Worker và kết quả đã che thông tin nhạy cảm.
3. Kiểm `.tokens.local` đã ignore; chạy `node scripts/issue-tokens.mjs` một lần. Script ghi token thật vào file local, chỉ in ba hash theo thứ tự A, B, CRM-PoC, từ chối overwrite. Executor không mở/in file token. Trên Windows, user kiểm quyền đọc file local; mode POSIX không thay thế ACL Windows.
4. Sau user xác nhận mapping thử, insert user A/B với email thử và group CRM-PoC với department thử, rồi insert ba hash vào `mcp_credential` tương ứng. Dùng một file SQL chỉ chứa hash và dữ liệu thử, lưu dưới `poc/goclaw-identity/`, áp bằng Wrangler sau backup. Không dùng dữ liệu nhân viên thật hoặc token gốc trong SQL.
5. User nhập admin secret qua `npx wrangler secret put ADMIN_TOKEN`; không hardcode. Verify nguyên văn: `curl -s -o /dev/null -w '%{http_code}' -X POST <worker-url>/mcp`, thay URL thật, phải in `401`.

### Task 6.4 — Backup và kết nối do user thực hiện

1. Xin user consent từng thay đổi. Theo `D:/Goclaw/docs/goclaw-system-overview.md`, dùng PowerShell backup DB bằng pg_dump và copy config.json; ghi đường dẫn backup, thời điểm và kết quả kiểm file có dữ liệu, không đọc/in config hoặc dump. Chưa có backup nào được tạo trong dispatch này.
2. User tạo/chọn app bot Lark và scope theo mục Larksuite Channel của GoClaw docs, đặt secret trực tiếp. Chỉ dùng nhóm CRM-PoC và A/B/C. Bật `feishu` với `domain: "lark"`, `group_policy: "allowlist"`, `group_allow_from` là chat ID nhóm thử, `require_mention: true`.
3. User tạo agent `crm-sales-poc`, gán nhóm thử, thêm MCP `abm-crm-poc` transport `streamable-http`, URL Worker `/mcp`, `require_user_credentials: true`, `tool_allow: ["whoami","add_activity"]`.
4. Theo ba nhóm bước Đường liên kết ở trên, merge A/B và nhóm riêng rồi đặt credentials từ file local do user mở. Lưu các route/UI đã dùng và metadata presence, không lưu giá trị secret.
5. Verify dashboard hiển thị MCP server và agent thấy đúng hai tool; user lưu ảnh đã che secret dưới `plans/reports/`, ghi đường dẫn tại đây.

### Task 6.5 — Cơ chế 1 trên Lark thật

| Kịch bản | Kỳ vọng | Kết quả live |
| --- | --- | --- |
| A @bot nhóm gọi whoami | subject user A | PASS 14:37: log `mcp.pool.user.connected … user:ou_0b7b5… tools=2`, `tool call … mcp_abm_crm_poc__whoami`; bot trả lời `user / A / poc-a@example.test` |
| B @bot nhóm gọi whoami | subject user B | PENDING-HUMAN |
| C chưa liên kết @bot gọi whoami | group CRM-PoC hoặc từ chối, không A/B | PENDING-HUMAN |
| B ghi lead L1 và giả acting_user A | activity actor B, audit initiating_user B | PENDING-HUMAN |
| A DM bot gọi whoami | subject user A | PENDING-HUMAN |

Lưu log/ảnh đã che secret cho từng dòng. Verify nguyên văn từ package PoC: `npx wrangler d1 execute abm-crm-poc-identity --remote --command "SELECT initiating_user, COUNT(*) FROM audit_log GROUP BY initiating_user"`; kết quả phải khớp kịch bản 4 và cả năm dòng phải PASS. Nếu A/B đều ra group/cùng subject, dừng và xin hướng dẫn coordinator trước Task 6.6; nếu mọi dòng PASS thì không cần cơ chế 2.

### Task 6.6 — Hook có điều kiện

1. Chỉ sau consent và backup, user tạo hook HTTP PreToolUse tới `/hooks/pre-tool-use`, chạy bộ test hook và lưu sample đã xóa secret vào báo cáo. Endpoint local hiện trả deny/503; chưa có sample và chưa có HMAC được triển khai.
2. Nếu payload có sender/session tin cậy, đối chiếu semantics hook và triển khai attestation ràng buộc sender, channel/chat, tool, hash payload, tool_call_id, timestamp, nonce; TTL 60 giây và dùng một lần theo ADR-004. Secret HMAC phải đặt qua Wrangler secret, không do model cung cấp. Kiểm thiếu/sai/hết hạn/replay trước khi chạy lại năm kịch bản thật.
3. Verify chỉ PASS khi cả năm kịch bản PASS với cơ chế 2. Nếu payload không có sender tin cậy, ghi FAIL và xin user quyết định cơ chế 3; không sửa bridge hoặc GoClaw trong dispatch local này.

### Task 6.7 — Kill switch và downtime

1. Xin user duyệt thao tác kill switch; lấy baseline COUNT activity/audit. Kiểm admin token sai trả 401, bật bằng admin token đúng qua POST `/admin/kill-switch` body `{"enabled":true}`; A yêu cầu ghi và phải nhận `KILL_SWITCH_ON`, hai count không tăng. Tắt lại với body `{"enabled":false}`. Credentials phải đi qua đường không echo; không chép lệnh có token vào log.
2. User chọn khung giờ downtime bot Telegram hiện có và duyệt stop/start. Sau backup, chạy `stop-goclaw.ps1` bằng PowerShell theo runbook thật, không Bash. Trong downtime gọi Worker `GET /health` và `GET /admin/activity` với admin credential; cả hai phải 200, lưu bằng chứng cùng thời điểm GoClaw dừng.
3. Chạy `start-goclaw.ps1` bằng PowerShell, kiểm GoClaw health 200 và A @bot nhóm whoami lại đúng user A. Nếu startup lỗi, gửi coordinator evidence để phục hồi theo backup, không tự mở rộng sửa GoClaw.

| Verify live Task 6.7 | Kết quả |
| --- | --- |
| Kill switch chặn ghi, count không đổi | PENDING-HUMAN |
| CRM health/activity 200 khi GoClaw tắt | PENDING-HUMAN |
| GoClaw khởi động lại và kịch bản A PASS | PENDING-HUMAN |

### Task 6.8 — Quyết định và dọn dẹp sau live

Chỉ chuyển ADR-004 sang accepted khi có bằng chứng cơ chế thực tế. Xin user quyết định giữ hay gỡ MCP/agent thử và xóa Worker/D1; trước xóa phải lưu evidence cần thiết. Hiện chưa tạo tài nguyên live nên không có thao tác dọn dẹp remote trong dispatch này. Coordinator thực hiện commit, worker không commit.

## Rủi ro và vận hành

Build GoClaw đã patch; HEAD checkout chưa chứng minh revision binary. Cơ chế 1 có đường source nhưng sender Lark `ou_...` và chọn credential trong group còn phải kiểm live. Cơ chế 2 cần payload tin cậy và replay store; chưa triển khai. Cơ chế 3 cần consent, backup và bảo trì patch khi nâng upstream. PoC không thay thế kiểm projection nhóm/DM, roster, approval callback hay toàn bộ permission parity của MVP1. Wrangler còn database ID placeholder; không deploy trước cấp tài nguyên cô lập. Runbook sau live cần giữ mapping contact/tenant user, token rotation/revocation, backup/restore, kill switch và stop/start có lịch downtime.

## Câu hỏi chưa giải quyết

Chưa chọn cơ chế 1/2/3 trước PoC live. Lượt sau cần user xác nhận tài nguyên Cloudflare, cấu hình Lark/GoClaw và danh tính thử, downtime, cùng quyết định dọn dẹp. Các bước này nằm ngoài scope LOCAL ONLY đã được user chọn cho dispatch hiện tại.
