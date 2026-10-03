---
phase: 4
title: "ADR và ma trận quyền/rủi ro"
status: pending
priority: P1
effort: "2-3 ngày"
dependencies: [2, 3]
---

# Phase 04: ADR và ma trận quyền/rủi ro

## Goal

Bốn ADR, ma trận quyền v1, ma trận action-risk v1, quy ước command contract, chiến lược test và kế hoạch backup/restore. ADR-001/005 có thể `accepted` ngay; ADR-002/003/004 ở `proposed` cho tới khi PoC phase 05–06 xong.

## Context

- Đọc: `plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md` (stack, auth, trusted actor, D1 guard, cập nhật Lark), `docs/decisions/business-decisions-v1.md`, `docs/architecture/erd-v1.md`, PRD mục 23, 24, 28.
- Định dạng ADR: `# ADR-NNN: Tiêu đề`, `Trạng thái:` (proposed/accepted/superseded), `Ngày:`, `## Bối cảnh`, `## Quyết định`, `## Phương án đã xét`, `## Hệ quả`, `## Bằng chứng/PoC`.

## Files to Create / Modify

- Create: `D:/TQD/CRM/docs/adr/adr-001-stack-cloudflare-modular-monolith.md`
- Create: `D:/TQD/CRM/docs/adr/adr-002-web-auth.md`
- Create: `D:/TQD/CRM/docs/adr/adr-003-d1-guarded-write-pattern.md`
- Create: `D:/TQD/CRM/docs/adr/adr-004-chat-actor-identity.md`
- Create: `D:/TQD/CRM/docs/adr/adr-005-command-contracts.md`
- Create: `D:/TQD/CRM/docs/security/permission-matrix-v1.md`
- Create: `D:/TQD/CRM/docs/security/action-risk-matrix-v1.md`
- Create: `D:/TQD/CRM/docs/engineering/test-strategy.md`
- Create: `D:/TQD/CRM/docs/operations/backup-restore-plan.md`
- Create: `D:/TQD/CRM/docs/engineering/environments.md`
- Create: `D:/TQD/CRM/docs/engineering/seed-config-structure.md`
- Create: `D:/TQD/CRM/docs/engineering/deployment-baseline.md`
- Create: `D:/TQD/CRM/docs/security/security-baseline.md`
- Modify: `D:/TQD/CRM/docs/engineering/coding-conventions.md` (thêm mục Audit convention)

## Tasks

### Task 4.1 — ADR-001 Stack
- Quyết định: pnpm monorepo; Hono trên Workers cho REST + MCP Streamable HTTP không trạng thái; React + Vite + TanStack Router/Query PWA qua Workers Static Assets; D1 + Drizzle migrations; R2 private; Queues + outbox; Cron Triggers; Durable Objects chỉ cho chống trùng lịch tài nguyên (MVP3); Vitest + `@cloudflare/vitest-pool-workers`. Môi trường: local, staging, production tách D1/R2/secrets. Phương án đã xét: Twenty App, fork Twenty, Laravel PRD 29.2 (lý do loại: ràng buộc toàn Cloudflare). Trạng thái `accepted`.
- Quy ước cho mọi ADR: dòng trạng thái viết `Trạng thái: accepted [ADR-ACCEPTED]` hoặc `Trạng thái: proposed [ADR-PROPOSED]` (marker ASCII để grep ổn định).
- Verify: `grep -c 'ADR-ACCEPTED' /d/TQD/CRM/docs/adr/adr-001-stack-cloudflare-modular-monolith.md` in ra `1`.

### Task 4.2 — ADR-002 Web auth
- Quyết định đề xuất: PoC dùng Cloudflare Access (OTP email) và Worker xác minh JWT `Cf-Access-Jwt-Assertion` theo JWKS của team domain, map email → `user`; trước pilot chuyển sang Lark OAuth (hoặc Access OIDC nếu Lark tương thích — spike 1 giờ). Đường `/mcp` loại khỏi Access policy trình duyệt và bảo vệ bằng Access Service Token. Ghi giới hạn 50 seat miễn phí so với pilot 15–50 người. Trạng thái `proposed`.
- Verify: `grep -c 'Cf-Access-Jwt-Assertion' /d/TQD/CRM/docs/adr/adr-002-web-auth.md` in ra số ≥ `1`.

### Task 4.3 — ADR-003 D1 guarded write
- Quyết định đề xuất: mỗi command ghi = một `db.batch([...])`:
  ```sql
  -- ?5 = txn nonce (ULID mới cho mỗi lần gọi command)
  UPDATE lead SET stage_id=?1, version=version+1, updated_at=?2, last_txn_id=?5 WHERE id=?3 AND version=?4;
  INSERT INTO _guard(ok) VALUES ((SELECT COALESCE((SELECT 1 FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5), 0)));
  INSERT INTO audit_log(...) SELECT ... FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5;
  INSERT INTO outbox(...) SELECT ... FROM lead WHERE id=?3 AND version=?4+1 AND last_txn_id=?5;
  DELETE FROM _guard;
  ```
  với `CREATE TABLE _guard(ok INTEGER NOT NULL CHECK (ok = 1))` và cột `last_txn_id TEXT` trên mọi bảng sửa có điều kiện. Lý do có nonce: nếu chỉ kiểm `version=?4+1`, writer thua (UPDATE 0 dòng) vẫn thấy version mới của writer thắng và lọt guard; bản ghi không tồn tại cũng phải fail (COALESCE → 0). Không dùng `changes()`. Trạng thái `proposed` cho tới phase 05.
- Verify: `grep -c 'CHECK (ok = 1)' /d/TQD/CRM/docs/adr/adr-003-d1-guarded-write-pattern.md` in ra số ≥ `1`.

### Task 4.4 — ADR-004 Chat actor identity
- Quyết định đề xuất: nhân viên là chủ thể, nhóm là dự phòng. CRM cấp credential MCP per-user (gắn Lark open_id ↔ `user` sau bước liên kết DM) và per-group (`lark_group_binding`). Actor và scope lấy từ credential, không từ tham số tool. Credential nhóm: chỉ đọc dữ liệu phòng ban + ghi low-risk không gán người. Thứ tự dự phòng: (1) liên kết contact gốc GoClaw; (2) hook PreToolUse trả `updatedInput` chèn chứng thực HMAC; (3) patch bridge GoClaw ký `sender_id`. App Lark riêng của CRM cho nhắc việc và thẻ duyệt; duyệt chỉ qua callback thẻ có chữ ký Lark hoặc UI web. Bảo vệ nhóm: owner-only invite, `group_policy: allowlist`, cron so thành viên với danh sách phòng ban. Lark docx tự fetch là nguồn injection: ghi quan trọng luôn qua duyệt. Trạng thái `proposed` cho tới phase 06.
- Verify: `grep -c 'updatedInput' /d/TQD/CRM/docs/adr/adr-004-chat-actor-identity.md` in ra số ≥ `1`.

### Task 4.5 — ADR-005 Command contracts
- Quyết định: mỗi command khai báo trong `packages/contracts` gồm `name`, `input` (Zod), `output`, `requiredScope` (own/team/department/organization), `riskLevel` (read/low/approval), `idempotent: true` cho mọi command ghi, `expectedVersion` cho command sửa. REST validator, MCP tool schema và UI form dùng chung định nghĩa này. Lỗi trả mã ổn định (`FORBIDDEN`, `STALE_VERSION`, `APPROVAL_REQUIRED`, `KILL_SWITCH_ON`, `DUPLICATE_SUSPECTED`, `VALIDATION_FAILED`). Trạng thái `accepted`.
- Verify: `grep -c 'STALE_VERSION' /d/TQD/CRM/docs/adr/adr-005-command-contracts.md` in ra số ≥ `1`.

### Task 4.6 — Permission matrix v1
- Target: `docs/security/permission-matrix-v1.md`.
- Steps: bảng hàng = vai trò (Sale, Leader, Department Head, BGĐ, CSKH, Triển khai, Kế toán, Admin, Agent nhóm phòng ban, Agent cá nhân DM); cột = Customer/Lead/Deal/Task/Activity/Approval/Audit/Export/Admin config; ô = phạm vi (own/team/department/org/none) và hành động (R/W/Approve). Ghi rõ: bề mặt nhóm Lark trả dữ liệu mức department nhưng ẩn hoa hồng, lý do Lost, dữ liệu cá nhân khách (chỉ DM). Theo PRD 23.1–23.2.
- Verify: `cd /d/TQD/CRM && for r in Sale Leader 'Department Head' BGĐ Admin 'Agent nhóm'; do grep -q "$r" docs/security/permission-matrix-v1.md || echo MISSING $r; done; echo DONE` chỉ in `DONE`.

### Task 4.7 — Action-risk matrix v1
- Target: `docs/security/action-risk-matrix-v1.md`.
- Steps: bảng (command | riskLevel | agent tự làm? | ai duyệt | ghi chú). Tối thiểu: `search_customer` read; `get_customer_360` read; `add_activity` low/có; `create_next_action` low/có; `create_lead` low/có (kiểm trùng, trùng nghi vấn → `DUPLICATE_SUSPECTED`, không tự merge); `update_stage` approval/không/owner hoặc Leader; `mark_won`, `mark_lost` approval/Leader; `change_owner` approval/Leader; `send_external_message` approval/owner; `export_data` approval/Department Head; `toggle_kill_switch` admin only.
- Verify: `grep -c 'approval' /d/TQD/CRM/docs/security/action-risk-matrix-v1.md` in ra số ≥ `5`.

### Task 4.8 — Test strategy và backup/restore plan
- `docs/engineering/test-strategy.md`: unit (core policy), integration (D1 qua vitest-pool-workers), contract parity (cùng input qua REST và MCP cho cùng kết quả quyền), RBAC matrix test sinh từ permission matrix, concurrency test trên D1 remote staging, restore drill mỗi bậc.
- `docs/operations/backup-restore-plan.md`: RPO ≤ 1 giờ dựa trên D1 Time Travel; export D1 hằng ngày vào R2 private (`wrangler d1 export`), giữ theo retention đã chốt; R2 versioning cho file; secrets lưu ở Cloudflare + kho mật khẩu của user; GoClaw backup `pg_dump` theo runbook GoClaw; sau restore phải đối soát outbox/delivery ledger trước khi bật lại worker gửi; RTO ≤ 4 giờ với checklist từng bước.
- Verify: `grep -c 'Time Travel' /d/TQD/CRM/docs/operations/backup-restore-plan.md` in ra số ≥ `1` và `test -s /d/TQD/CRM/docs/engineering/test-strategy.md && echo OK` in `OK`.

### Task 4.9 — Baseline kỹ thuật MVP0 còn lại (PRD 34.3)
- Target và nội dung:
  1. `docs/engineering/environments.md`: local (miniflare), staging, production; mỗi môi trường có D1/R2/Queues/secrets riêng; tên tài nguyên theo mẫu `abm-crm-<env>`; Lark app và GoClaw agent riêng cho staging.
  2. `docs/engineering/seed-config-structure.md`: config pack versioned (branding, roles/scopes, pipeline/stages/lost reasons, SLA, product types, entitlement types, notification rules, nhóm Lark ↔ phòng ban); seed chỉ dữ liệu tổng hợp; validate config trước khi áp dụng; không seed/reset production.
  3. `docs/engineering/deployment-baseline.md`: deploy bằng `wrangler deploy` theo env; migration áp trước code; rollback Worker bằng `wrangler rollback` khác với restore DB; checklist release.
  4. `docs/security/security-baseline.md`: không secret trong repo (dùng `wrangler secret`), xác minh JWT Access, credential MCP lưu hash, kill switch, PII tối thiểu trong log, rate limit endpoint public, quy trình thu hồi khi nhân viên nghỉ.
  5. Mục `## Audit convention` trong `docs/engineering/coding-conventions.md`: trường bắt buộc của `audit_log` (initiating_user, executing_actor, action, entity, before/after, approval_id, correlation_id, source), ghi trong cùng batch với mutation, không lưu secret/hidden reasoning.
- Verify: `cd /d/TQD/CRM && for f in docs/engineering/environments.md docs/engineering/seed-config-structure.md docs/engineering/deployment-baseline.md docs/security/security-baseline.md; do test -s $f || echo MISSING $f; done; grep -q '## Audit convention' docs/engineering/coding-conventions.md || echo MISSING audit; echo DONE` chỉ in `DONE`.

### Task 4.10 — Commit
- Verify: `cd /d/TQD/CRM && git add docs && git commit -m "docs: add ADRs, permission and action-risk matrices" && git log -1 --oneline` chứa `ADRs`.

## Risk

Ma trận quyền lệch quyết định user. Task 4.6/4.7 phải trích dẫn `business-decisions-v1.md`; phase 08 đối chiếu lại.

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
