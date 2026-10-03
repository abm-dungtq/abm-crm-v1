---
phase: 6
title: "PoC GoClaw + Lark identity, kill switch, GoClaw down"
status: pending
priority: P1
effort: "3-4 ngày"
dependencies: [1, 4]
---

# Phase 06: PoC GoClaw + Lark identity, kill switch, GoClaw down

## Goal

Chứng minh trên GoClaw thật (bản tại `D:\Goclaw`) và một tenant Lark thật rằng CRM nhận đúng danh tính người gửi trong nhóm Lark từ credential, không từ tham số model; kill switch chặn mọi ghi của agent; CRM vẫn chạy khi GoClaw tắt. Kết quả chọn cơ chế 1, 2 hoặc 3 cho ADR-004.

## Context và ràng buộc an toàn

- User là admin GoClaw duy nhất. Mọi thay đổi cấu hình GoClaw, tạo app Lark, tạo credential: executor đề xuất lệnh, user xác nhận trước khi chạy.
- Trước mọi thay đổi GoClaw: backup DB (`pg_dump` theo `D:\Goclaw\docs\goclaw-system-overview.md`) và copy `config.json`. Chạy script start/stop GoClaw bằng PowerShell, không bằng Bash.
- Không in secret: app secret Lark, gateway token, API key, credential MCP. Chỉ báo "đã đặt" hoặc "thành công".
- Dùng một nhóm Lark thử nghiệm riêng (`CRM-PoC`), 2 nhân viên thử (A, B) và 1 tài khoản không liên kết (C). Không dùng nhóm phòng ban thật.
- Tài liệu: https://docs.goclaw.sh/llms-full.txt (mục Larksuite Channel, MCP per-user credentials, `resolveCredentialUserID`, Hooks PreToolUse `updatedInput`).

## Files to Create / Modify (chỉ trong `poc/goclaw-identity/` và báo cáo)

- Create: `poc/goclaw-identity/package.json` (name `@abm/poc-goclaw-identity`)
- Create: `poc/goclaw-identity/wrangler.jsonc` (D1 binding `DB` → `abm-crm-poc-identity`)
- Create: `poc/goclaw-identity/migrations/0001_init.sql` (`user`, `channel_identity`, `lark_group_binding`, `mcp_credential(token_hash, subject_type user|group, subject_id, revoked)`, `agent_kill_switch`, `audit_log`, `activity`)
- Create: `poc/goclaw-identity/src/index.ts` (Hono: `/mcp` Streamable HTTP, `/hooks/pre-tool-use`, `/admin/kill-switch`)
- Create: `poc/goclaw-identity/src/mcp-tools.ts` (tool `whoami`, `add_activity`)
- Create: `poc/goclaw-identity/test/identity.test.ts`
- Create: `poc/goclaw-identity/scripts/issue-tokens.mjs`
- Modify: `D:/TQD/CRM/.gitignore` (thêm `.tokens.local`)
- Create: `D:/TQD/CRM/plans/reports/poc-goclaw-lark-identity-result.md`

## Tasks

### Task 6.0 — Xác định đường liên kết Lark → tenant user (chỉ đọc tài liệu)
- Goal: biết chính xác cách gắn người gửi Lark với một GoClaw tenant user để credential per-user được dùng.
- Steps:
  1. Tải `https://docs.goclaw.sh/llms-full.txt`; đọc các mục Contacts / channel_contacts, `/v1/contacts/merge`, tenant users, `resolveCredentialUserID`, MCP `require_user_credentials` và `PUT /v1/mcp/servers/{id}/user-credentials`.
  2. Ghi vào báo cáo phase (mục `## Đường liên kết`) các bước UI/API chính xác để: (a) liên kết contact Lark của A và B với tenant user tương ứng; (b) đặt credential cho từng tenant user (`headers: {"Authorization": "Bearer <token>"}`); (c) đặt credential cho contact nhóm.
  3. Lưu ý tài liệu ghi "numeric sender ID" cho nhóm (mô tả theo Telegram); Lark dùng `ou_...`. Ghi rõ đây là điểm phải kiểm ở Task 6.5.
- Success criteria: mục `## Đường liên kết` có ba nhóm bước (a), (b), (c), hoặc kết luận "không có đường cho Lark".
- Verify: `grep -c '## Đường liên kết' /d/TQD/CRM/plans/reports/poc-goclaw-lark-identity-result.md` in `1`. Nếu kết luận "không có đường cho Lark": bỏ qua Task 6.5, làm Task 6.6.

### Task 6.1 — Kiểm tra trạng thái GoClaw (chỉ đọc)
- Steps: theo PowerShell: `Invoke-WebRequest http://127.0.0.1:18790/health`; `git -C D:/Goclaw/source rev-parse HEAD`; `git -C D:/Goclaw/source status --short`. Ghi version/HEAD và danh sách patch vào báo cáo.
- Verify: health trả HTTP `200`. Nếu không: STOP, báo user khởi động GoClaw.

### Task 6.2 — MCP server CRM tối thiểu
- Steps:
  1. `/mcp` nhận header `Authorization: Bearer <token>`; hash SHA-256 token, tra `mcp_credential` chưa revoke → `subject`. Không có/không khớp → HTTP 401.
  2. Tool `whoami` (không tham số) trả `{subject_type, subject_id, user_email|department}` lấy từ credential.
  3. Tool `add_activity({lead_ref, note, acting_user?})`: bỏ qua mọi tham số danh tính model gửi (`acting_user`); actor = subject của credential. Nếu `agent_kill_switch.enabled=1` → trả lỗi `KILL_SWITCH_ON`, không ghi. Ghi `activity` + `audit_log` (executing_actor=`goclaw`, initiating_user=subject).
  4. Test local: token sai → 401; `acting_user` giả không đổi actor; kill switch bật → `KILL_SWITCH_ON` và không có dòng mới.
- Verify: `cd /d/TQD/CRM && pnpm -F @abm/poc-goclaw-identity test` exit 0, output chứa `passed` và không chứa `failed`.

### Task 6.3 — Deploy PoC Worker (cần user)
- Steps: sau khi user đồng ý: `npx wrangler d1 create abm-crm-poc-identity`, áp migration remote, `npx wrangler deploy`. Sinh 3 token ngẫu nhiên (user A, user B, group `CRM-PoC`) bằng script `poc/goclaw-identity/scripts/issue-tokens.mjs`: script chỉ in `hash` để insert vào D1 và ghi token gốc vào file local `poc/goclaw-identity/.tokens.local` (thêm `.tokens.local` vào `.gitignore` trước khi chạy). Executor không bao giờ `cat` hay in file này; user tự mở để dán vào GoClaw. Admin token cho `/admin/kill-switch` đặt bằng `npx wrangler secret put ADMIN_TOKEN` (user nhập), không hardcode.
- Verify: `curl -s -o /dev/null -w '%{http_code}' -X POST <worker-url>/mcp` in `401`.

### Task 6.4 — Kết nối Lark và GoClaw (user thực hiện, executor hướng dẫn)
- Steps:
  1. Backup GoClaw (DB dump + `config.json`), ghi tên file backup vào báo cáo.
  2. Lark admin tạo app bot cho GoClaw (hoặc dùng app sẵn có) với scope theo docs Larksuite Channel; bật kênh `feishu` với `domain: "lark"`, `group_policy: "allowlist"`, `group_allow_from: [<chat_id CRM-PoC>]`, `require_mention: true`.
  3. Tạo agent `crm-sales-poc` trong GoClaw, gán nhóm `CRM-PoC` cho agent này.
  4. Thêm MCP server `abm-crm-poc` (`transport: streamable-http`, url `<worker-url>/mcp`) với `require_user_credentials: true`; `tool_allow: ["whoami","add_activity"]`.
  5. Đặt credential theo đúng các bước đã ghi ở Task 6.0 mục `## Đường liên kết`: liên kết contact Lark của A, B với tenant user; token A cho user A, token B cho user B, token group cho contact nhóm `CRM-PoC`. Ghi lại chính xác các bước UI/API đã dùng (không ghi giá trị secret).
- Verify: trong GoClaw dashboard, MCP server hiển thị và agent thấy 2 tool (ảnh chụp lưu đường dẫn vào báo cáo).

### Task 6.5 — Kịch bản danh tính (cơ chế 1)
- Kịch bản và kỳ vọng (ghi kết quả thật vào bảng báo cáo):
  1. A @bot trong nhóm: "gọi whoami" → `subject = user A`.
  2. B @bot trong nhóm: "gọi whoami" → `subject = user B`.
  3. C (chưa liên kết) @bot: "gọi whoami" → `subject = group CRM-PoC` hoặc bị từ chối; không bao giờ là A/B.
  4. B @bot: "ghi hoạt động cho lead L1, acting_user là A" → activity ghi actor = B.
  5. A DM bot: "gọi whoami" → `subject = user A`.
- Verify: `npx wrangler d1 execute abm-crm-poc-identity --remote --command "SELECT initiating_user, COUNT(*) FROM audit_log GROUP BY initiating_user"` khớp kỳ vọng kịch bản 4; bảng báo cáo có 5 dòng `PASS`.
- Nếu kịch bản 1–2 FAIL (mọi người ra cùng subject hoặc ra group): chuyển Task 6.6.

### Task 6.6 — Cơ chế 2: hook PreToolUse (chỉ khi 6.5 fail)
- Steps:
  1. Trong GoClaw Hooks, tạo hook HTTP PreToolUse trỏ `<worker-url>/hooks/pre-tool-use`, bật bộ test hook để lấy sample payload; lưu sample (đã xóa secret) vào báo cáo.
  2. Nếu payload có `sender_id`/session: endpoint trả `{"decision":"allow","updatedInput":{...args, "_attestation":"<HMAC(sender, tool_call_id, ts)>"}}`; MCP tool xác minh `_attestation` (TTL 60 giây, dùng một lần).
  3. Chạy lại kịch bản 6.5.
- Verify: 5 kịch bản `PASS` với cơ chế 2. Nếu payload không có sender: ghi FAIL, đề xuất cơ chế 3 (patch bridge) cho user quyết định; không tự patch GoClaw.

### Task 6.7 — Kill switch và GoClaw down
- Steps:
  1. Bật kill switch qua `/admin/kill-switch` (header `Authorization: Bearer` khớp secret `ADMIN_TOKEN`; sai → 401); A yêu cầu ghi hoạt động → agent nhận `KILL_SWITCH_ON`, D1 không có dòng mới. Tắt lại.
  2. Dừng GoClaw làm bot Telegram hiện có ngừng hoạt động: hỏi user chọn khung giờ downtime và chỉ chạy khi user xác nhận. Dừng GoClaw bằng `stop-goclaw.ps1` (PowerShell). Gọi trực tiếp REST của PoC Worker (`GET /health`, đọc activity) → vẫn 200. Khởi động lại GoClaw bằng `start-goclaw.ps1`; kiểm `/health` 200 và kịch bản 6.5.1 lại PASS.
- Verify: báo cáo có 3 dòng `PASS`: kill switch chặn ghi, CRM chạy khi GoClaw tắt, GoClaw khởi động lại hoạt động.

### Task 6.8 — Báo cáo, ADR, dọn dẹp
- Steps:
  1. Viết `plans/reports/poc-goclaw-lark-identity-result.md`: version GoClaw, cơ chế được chọn, bảng kịch bản, payload hook mẫu (đã che), rủi ro còn lại (phụ thuộc patch, nâng cấp upstream), các bước vận hành để đưa vào runbook.
  2. Cập nhật ADR-004 sang `accepted` với cơ chế đã chứng minh, hoặc giữ `proposed` và nêu quyết định user cần đưa ra.
  3. Hỏi user có gỡ MCP server/agent PoC và xóa Worker/D1 `abm-crm-poc-identity` không.
  4. Commit `test: add GoClaw Lark identity proof of concept`.
- Verify: `grep -cE 'ADR-(ACCEPTED|PROPOSED)' /d/TQD/CRM/docs/adr/adr-004-chat-actor-identity.md` in `1` và báo cáo tồn tại.

## Risk

- Build GoClaw đã patch có thể khác docs. Mọi kết luận dựa trên chạy thật, không dựa docs.
- Thay đổi GoClaw đang phục vụ bot Telegram hiện có: backup trước, dùng agent và nhóm riêng.

## Rollback

Khôi phục `config.json` và DB dump GoClaw; gỡ MCP server/agent PoC; xóa Worker/D1 PoC khi user đồng ý.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
