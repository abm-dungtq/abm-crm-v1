# PoC GoClaw + Lark identity — hoàn tất local

Ngày: 2026-10-04, Asia/Saigon. Phạm vi: [phase 06](../261003-2239-abm-crm-foundation-poc/phase-06-poc-goclaw-lark-identity.md).

Task 6.2 đã pass local. User chọn chỉ làm local trong lượt này, theo thông báo coordinator ngày 2026-10-04. Task 6.3–6.7 là **PENDING-HUMAN**; chưa deploy, tạo tài nguyên remote, thay đổi Lark/GoClaw, sinh token hay thực hiện downtime. ADR-004 giữ proposed; chưa chứng minh cơ chế 1, 2 hoặc 3 trên runtime thật.

[Báo cáo lần trước](poc-goclaw-lark-identity-result.md) giữ hướng dẫn liên kết contact và lịch sử lỗi dependency. Kết quả Task 6.2 trong báo cáo này thay thế checkpoint lỗi local cũ. Khi resume, Orca trả `consumer_fenced`: process không còn sở hữu dispatch cũ; không gửi worker_done hoặc lifecycle bằng ID cũ. Phần hoàn tất báo cáo thực hiện theo yêu cầu trực tiếp “tiep tuc”, không coi dispatch cũ đã thành công.

## Kết quả Verify

| Task | Trạng thái | Bằng chứng |
| --- | --- | --- |
| 6.0 | PASS | Lệnh grep nguyên văn bằng Git Bash trả `1`, exit 0; đường liên kết A/B/nhóm ở báo cáo trước. |
| 6.1 | PASS, chỉ đọc | Health HTTP 200, body `{"status":"ok","protocol":3}`; HEAD `549c81fd2406875be34cec3d7274125238e7d4a0`, danh sách patch không đổi so với báo cáo trước. HEAD checkout chưa chứng minh revision binary đang chạy. |
| 6.2 | PASS | `pnpm -F @abm/poc-goclaw-identity test`, exit 0, 1 file và 8 tests passed, không có failed. |
| 6.3 | PENDING-HUMAN | Chưa có Worker URL; chưa chạy curl remote. |
| 6.4 | PENDING-HUMAN | Chưa backup/cấu hình; chưa có ảnh dashboard và bằng chứng agent thấy hai tool. |
| 6.5 | PENDING-HUMAN | Chưa có năm kịch bản thật và SELECT audit remote. |
| 6.6 | CONDITIONAL / PENDING-HUMAN | Chỉ chạy nếu cơ chế 1 fail; chưa có sample sender đáng tin cậy. |
| 6.7 | PENDING-HUMAN | Chưa có ba PASS live; không stop/start GoClaw. |
| 6.8 | PARTIAL | Báo cáo tồn tại; grep ADR nguyên văn trả `1`, exit 0; ADR giữ proposed. Chưa có quyết định cleanup; không commit theo chỉ định. |

Verify 6.2 cuối cùng lúc 09:33:40 giờ địa phương:

```text
$ vitest run
 RUN  v4.1.11 D:/TQD/CRM/poc/goclaw-identity
 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  1.90s
```

`pnpm -F @abm/poc-goclaw-identity typecheck` cuối cùng exit 0, output `$ tsc --noEmit`. `pnpm -F @abm/poc-goclaw-identity exec wrangler deploy --dry-run` exit 0, bundle 66.74 KiB, không tạo deployment. Database ID hiện là placeholder; không sử dụng để deploy thật.

## Thay đổi và review local

Sửa harness dùng [Cloudflare Vitest integration hiện hành](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/): pin `@cloudflare/vitest-plugin` 1.3.6 và Vitest 4.1.11 theo peer range `^4.1.0`. Thay Miniflare trực tiếp bằng plugin; dùng `readD1Migrations` và `applyD1Migrations` để parse đúng migration/trigger, không tự tách SQL. TypeScript nạp `@cloudflare/vitest-plugin/types`; binding khai báo bằng `Cloudflare.Env`, runtime dùng `env` từ `cloudflare:workers`. Coordinator đã duyệt sửa harness và cấp quyền xử lý lỗi type/config local.

Các file sửa trong lượt thực thi: `poc/goclaw-identity/package.json`, `vitest.config.ts`, `tsconfig.json`, `test/identity.test.ts`, `test/env.d.ts` và lockfile sinh bởi `pnpm install`. Lockfile có thay đổi của workspace khác; không coi toàn bộ diff thuộc phase 06. Không sửa `pnpm-workspace.yaml`, `.gitignore`, plan.md, status phase khác hoặc code GoClaw.

Tám test kiểm credential thiếu/sai/revoked; A/B/group khác nhau; giả acting_user không đổi actor; group không giả initiating_user; admin auth và kill switch không tạo activity/audit; audit lỗi rollback activity; health/read activity độc lập; MCP initialize/discovery/notification. Review trực tiếp xác nhận token lưu hash, admin bảo vệ đọc/đổi kill switch, mutation và audit cùng batch, trigger kiểm switch ở thời điểm INSERT. Chưa có independent reviewer hoặc bằng chứng client GoClaw thật.

Hai lỗi typecheck đã xử lý với counsel coordinator: TS2307 cho `cloudflare:test` khi thiếu ambient type export; TS2339 cho DB/TEST_MIGRATIONS do dùng `ProvidedEnv` cũ thay `Cloudflare.Env`. Không thay hoặc làm yếu test để pass.

Endpoint `/hooks/pre-tool-use` hiện từ chối với `HOOK_NOT_CONFIGURED`; chưa triển khai HMAC theo payload giả định. MCP hiện triển khai transport tối thiểu; compatibility initialize và credential selection phải kiểm thật. PoC không chứng minh RBAC/projection/roster hay toàn bộ security acceptance của MVP1.

## Checklist phiên live có giám sát

Các lệnh dưới đây là hướng dẫn **chưa chạy**. Phiên mới phải lấy user consent cho từng thay đổi remote/GoClaw và downtime; dùng dispatch mới. Dùng PowerShell cho script GoClaw, không đưa secret vào argv, báo cáo, ảnh hoặc transcript. Chỉ sử dụng nhóm CRM-PoC và tài khoản thử A/B/C đã được admin xác nhận.

### Task 6.3 — Cloudflare PoC

1. User xác nhận account/environment và chỉ deploy PoC, rồi thực hiện wrangler login nếu cần. Từ `poc/goclaw-identity`, chạy `npx wrangler d1 create abm-crm-poc-identity`; ghi database ID thực vào `wrangler.jsonc`.
2. Trước thay schema/data, export backup DB và ghi đường dẫn backup; với DB mới xác nhận trạng thái rỗng. Sau consent chạy `npx wrangler d1 migrations apply abm-crm-poc-identity --remote`.
3. Xác nhận `.tokens.local` được git ignore trước khi chạy `node scripts/issue-tokens.mjs`. Script tạo file một lần, chỉ in ba hash theo thứ tự A, B, CRM-PoC; không đọc/in token gốc. User tự mở file để dán credential. Windows cần bảo vệ ACL file local, không chỉ dựa Unix mode.
4. Sau backup/consent seed hai user thử và binding nhóm theo danh tính user xác nhận; insert ba hash vào mcp_credential với subject tương ứng. Không dùng danh tính thật hoặc tự suy quyết định nghiệp vụ.
5. User nhập admin secret qua `npx wrangler secret put ADMIN_TOKEN`; không hardcode. Chạy `npx wrangler deploy`, ghi URL thực. Kiểm chưa xác thực bằng lệnh Verify nguyên văn dưới Git Bash:

```sh
curl -s -o /dev/null -w '%{http_code}' -X POST <worker-url>/mcp
```

Kỳ vọng `401`. Thay placeholder bằng URL deployment thực, không đặt bearer token vào lệnh này.

### Task 6.4 — GoClaw và Lark

1. Đọc lại `D:/Goclaw/docs/goclaw-system-overview.md`, xác định lệnh pg_dump, config.json và đường start/stop thực. Đề xuất chính xác lệnh cho user duyệt; backup DB/config trước bất kỳ thay đổi; ghi tên file, thời điểm và kiểm backup dùng được. Không tự dựng lệnh chứa credential.
2. User tạo/dùng app Lark được duyệt và cấp scope theo mục Larksuite Channel trong [GoClaw docs](https://docs.goclaw.sh/llms-full.txt). Tạo nhóm CRM-PoC, xác nhận chat ID và account A/B/C. Bật feishu với domain lark, group_policy allowlist, group_allow_from chỉ chat ID thử, require_mention true.
3. User tạo agent crm-sales-poc, gán nhóm thử; thêm MCP abm-crm-poc, transport streamable-http, Worker URL/mcp, require_user_credentials true, tool_allow chỉ whoami/add_activity.
4. Làm ba nhóm bước contact merge và user-credentials trong báo cáo trước; dùng UUID contact/tenant user đúng tenant/instance, query credential dùng user_id. User tự nhập bearer token từ file local. Ghi metadata bước thực, không secret.
5. Lưu ảnh dashboard dưới plans/reports đã che secret/PII: MCP server tồn tại và agent thấy đúng hai tool. Ghi đường dẫn ảnh, phiên bản GoClaw và timestamp.

### Task 6.5 — Chứng minh cơ chế 1

Ghi kết quả thật vào bảng sau, mỗi dòng kèm timestamp và artifact đã che. Không đổi PENDING thành PASS từ test local.

| Kịch bản | Kỳ vọng | Hiện tại |
| --- | --- | --- |
| A mention bot trong nhóm, whoami | subject user A | PENDING-HUMAN |
| B mention bot trong nhóm, whoami | subject user B | PENDING-HUMAN |
| C chưa liên kết mention bot, whoami | group CRM-PoC hoặc bị từ chối; không phải A/B | PENDING-HUMAN |
| B ghi L1 với acting_user A | activity và initiating_user là B | PENDING-HUMAN |
| A DM bot, whoami | subject user A | PENDING-HUMAN |

Từ thư mục PoC, chạy Verify nguyên văn:

```sh
npx wrangler d1 execute abm-crm-poc-identity --remote --command "SELECT initiating_user, COUNT(*) FROM audit_log GROUP BY initiating_user"
```

Đối chiếu baseline trước/sau để bảo đảm lần ghi giả actor được gán B. Source hiện có đường resolve ou_..., nhưng sender thực và credential pool chưa được chứng minh. Nếu dòng 1–2 fail, dừng và xin counsel coordinator trước Task 6.6 theo Failure Protocol.

### Task 6.6 — Dự phòng hook

1. Chỉ khi cơ chế 1 thất bại và user cho phép: backup, thêm HTTP PreToolUse hook, lấy sample thật từ bộ test hook và che secret trước lưu.
2. Nếu sample có sender đáng tin cậy, thiết kế endpoint theo payload thực. Xác minh nguồn hook; HMAC ràng buộc channel instance, chat/sender, tool, hash payload, call ID, expiry và nonce dùng một lần theo ADR-004. TTL 60 giây. Bổ sung test hết hạn/replay/sửa payload rồi chạy lại năm kịch bản live.
3. Nếu không có sender, ghi FAIL, đề xuất cơ chế 3 để user quyết định. Không tự patch bridge. Chưa có bằng chứng để chọn HMAC hoặc tuyên bố cơ chế 2 pass.

### Task 6.7 — Kill switch và downtime

1. Bằng đường nhập secret không echo, user/admin gọi POST /admin/kill-switch với body enabled true; thử sai credential phải 401. Lấy số activity/audit baseline, A yêu cầu ghi, kiểm KILL_SWITCH_ON và cả hai count không đổi; tắt switch và kiểm lại. Ghi PASS khi có log và D1 thật.
2. User chọn cửa sổ downtime vì bot Telegram hiện có sẽ dừng. Xác minh backup và lệnh PowerShell start/stop, chạy chỉ sau user xác nhận.
3. Khi GoClaw dừng, gọi Worker GET /health và GET /admin/activity với admin auth qua đường không echo; đều 200. Lưu HTTP status và count, không sao chép nội dung cá nhân.
4. Khởi động lại GoClaw bằng script PowerShell đã xác minh; health GoClaw 200 và kịch bản A whoami trong nhóm PASS. Báo cáo cần đúng ba kết quả live: kill switch chặn ghi, CRM chạy khi GoClaw tắt, GoClaw restart hoạt động.

### Task 6.8 — Kết luận và cleanup

Chỉ cập nhật ADR-004 accepted khi cơ chế đã có bằng chứng thật; nếu chưa chứng minh, giữ proposed và ghi quyết định cần user. Xin user chọn giữ/gỡ MCP server, agent, Worker và D1; giữ backup trước cleanup. Coordinator thực hiện commit, worker không commit. Lệnh grep ADR hiện đã pass về marker, nhưng marker proposed không chứng minh exit gate hoàn thành.

## Câu hỏi chưa giải quyết

Phiên live cần user chọn account Cloudflare, app/tenant/nhóm và danh tính thử, duyệt backup/cấu hình, chọn downtime và quyết định cleanup. Cơ chế identity cuối cùng vẫn chưa xác định. Coordinator cần tiếp nhận evidence local bằng dispatch hiện hành; dispatch cũ đã bị fenced.
