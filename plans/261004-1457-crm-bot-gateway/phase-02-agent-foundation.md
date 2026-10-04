---
phase: 2
title: "Nền tảng agent: schema, Actor.kind, kill switch, token"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 02: Nền tảng agent

## Goal

CRM có bảng token agent (chỉ lưu hash), có kill switch, có kiểu approval `agent_assign` và cột trạng thái gửi tin cho outbox. Mọi dòng activity, audit và approval ghi đúng `actor_kind` theo kênh: web là `human`, bot là `agent`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0004_agent_gateway.sql`
- Modify: `apps/crm/src/worker/env.ts` (`Actor` thêm `kind`)
- Modify: `apps/crm/src/worker/actor.ts` (`loadUser` gán `kind: 'human'`)
- Modify: `apps/crm/src/worker/guarded-tx.ts` (`activity`, `audit` dùng `this.actor.kind`; thêm `assertAgentWritesOpen()`)
- Modify: `apps/crm/src/worker/commands.ts` (`requested_by_kind` dùng `actor.kind`; `runCommand` kiểm kill switch khi `actor.kind==='agent'`)
- Modify: `apps/crm/src/worker/admin-routes.ts` (kill switch GET/PUT, thu hồi token khi khóa user, xem số token còn hiệu lực)
- Modify: `apps/crm/src/web/pages/admin.tsx` hoặc `admin-users.tsx` (công tắc kill switch, cột "Bot" theo người dùng)
- Create test: `apps/crm/test/agent-foundation.test.ts`

## Tasks

### Task 2.1 — Migration 0004

- Goal: schema mới chạy được trên D1 cục bộ và trong Vitest.
- Target: `apps/crm/migrations/0004_agent_gateway.sql`.
- Steps:
  1. `CREATE TABLE agent_token`:
     - cột `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL REFERENCES app_user(id)`, `token_hash TEXT NOT NULL UNIQUE`, `label TEXT`, `created_at TEXT NOT NULL`, `revoked_at TEXT`, `last_used_at TEXT`;
     - index trên `user_id`.
  2. Tạo bảng kill switch:
     - `CREATE TABLE agent_kill_switch (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0, updated_by_user_id TEXT, updated_at TEXT)`;
     - `INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0)`.
  3. Mở rộng CHECK `approval.kind` thêm `'agent_assign'`. SQLite không sửa được CHECK tại chỗ, nên dựng lại bảng:
     - `PRAGMA defer_foreign_keys = ON;`
     - tạo `approval_new` với đúng định nghĩa cột của `approval` trong `0001_init.sql` (dòng 165-185), chỉ khác CHECK `kind`;
     - `INSERT INTO approval_new SELECT * FROM approval;`
     - `DROP TABLE approval;` rồi `ALTER TABLE approval_new RENAME TO approval;`
     - tạo lại mọi index của `approval`: `approval_status` (`0001_init.sql`) và `approval_lead_kind_status` (`0002_lead_won_note.sql:4`). Tìm `ON approval(` trong **mọi** file migration.
  4. `ALTER TABLE outbox ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;`, `ADD COLUMN last_error TEXT;`, `ADD COLUMN sent_at TEXT;`.
- Success criteria: migration chạy trong Vitest (Vitest tự áp migrations theo `vitest.config.ts`). Test cũ về approval vẫn xanh.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 2.2 — `Actor.kind`

- Goal: kênh đi kèm actor qua mọi tầng.
- Target: `env.ts` (`interface Actor`), `actor.ts` (`loadUser`), `guarded-tx.ts` (`activity()`, `audit()`), `commands.ts` (chỗ ghi `requested_by_kind: 'human'`).
- Steps:
  1. Thêm `kind: 'human' | 'agent'` vào `Actor`.
  2. `loadUser` gán `kind: 'human'`. Export thêm `loadAgentActor(db, userId)`, trả actor với `kind: 'agent'` (dùng chung truy vấn, lọc `status='active'`).
  3. Thay mọi `'human'` ghi cứng trong `guarded-tx.ts` và `commands.ts` bằng `this.actor.kind` / `actor.kind`.
  4. Sửa mọi chỗ khác tạo `Actor` (grep `role:` trong `apps/crm/src/worker` và `apps/crm/test`) cho đủ trường `kind`.
- Success criteria: `pnpm -F @abm/crm typecheck` exit 0; `Select-String -Path apps/crm/src/worker/*.ts -Pattern "actor_kind: 'human'|requested_by_kind: 'human'"` không trả dòng nào.
- Verify: chạy cả hai lệnh trên. Typecheck exit 0 và Select-String rỗng.

### Task 2.3 — Kill switch trong pipeline

- Goal: khi bật, mọi lệnh ghi có `actor.kind==='agent'` trả `KILL_SWITCH_ON`. Lệnh web không bị ảnh hưởng.
- Target: `commands.ts` `runCommand`; `guarded-tx.ts`.
- Steps:
  1. Trong `runCommand`, sau bước kiểm role và trước idempotency replay: nếu `actor.kind==='agent'`, đọc `SELECT enabled FROM agent_kill_switch WHERE id = 1`; `enabled = 1` thì trả `fail('KILL_SWITCH_ON', 'Bot đang bị tạm khóa ghi dữ liệu')`.
  2. Trước `tx.commit()`, nếu actor là agent, gọi `tx.assert('SELECT COALESCE(MAX(enabled), 0) = 0 FROM agent_kill_switch WHERE id = 1', [])` để chặn cả khi công tắc bật giữa chừng. Dùng `COALESCE(MAX…)` để thiếu dòng vẫn tính là tắt. Nếu không thì sau khi test xóa bảng, mọi lệnh agent sẽ thành `STALE_VERSION`. Bước 1 cũng đọc theo cách này. Test reset dữ liệu trong `beforeEach` phải chèn lại dòng `id=1` hoặc không xóa bảng này.
  3. Map lỗi guard do assert này thành `KILL_SWITCH_ON`: kiểm lại công tắc sau khi batch lỗi.
- Success criteria: test ở Task 2.6 xanh.
- Verify: no verification needed (Task 2.6).

### Task 2.4 — API Admin: kill switch, token, khóa người dùng

- Goal: Admin bật/tắt kill switch và thấy, thu hồi token bot của từng người.
- Target: `apps/crm/src/worker/admin-routes.ts`.
- Steps:
  1. `GET /admin/agent-kill-switch` trả `{enabled, updatedAt}`.
  2. `PUT /admin/agent-kill-switch` nhận body `{enabled: boolean}`, upsert dòng `id=1` (`INSERT … ON CONFLICT(id) DO UPDATE`) và ghi `audit_log` (command `setAgentKillSwitch`). Theo mẫu audit có sẵn trong file.
  3. `POST /admin/users/:id/agent-token/revoke` đặt `revoked_at` cho mọi token còn hiệu lực của user và ghi audit.
  4. Trong route khóa người dùng (gần chỗ đang thu hồi session), thêm `UPDATE agent_token SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL` trong cùng batch.
  5. Danh sách người dùng của Admin (`adminOverview` trong `apps/crm/src/worker/queries.ts`, ~dòng 387) trả thêm `agentTokens: number`, là số token còn hiệu lực.
  6. **Không** có route trả token gốc. Việc cấp token làm bằng script ở phase 05.
- Success criteria: test Task 2.6 xanh.
- Verify: no verification needed (Task 2.6).

### Task 2.5 — Giao diện Admin

- Goal: Admin bật/tắt kill switch, thấy ai có token bot, thu hồi được.
- Target: `apps/crm/src/web/pages/admin.tsx` (công tắc), `apps/crm/src/web/pages/admin-users.tsx` (cột Bot và nút "Thu hồi chìa khóa bot").
- Steps:
  1. Công tắc "Tạm khóa bot ghi dữ liệu", kèm hộp xác nhận trước khi đổi.
  2. Cột "Bot": `Có (n)` hoặc `Chưa`. Nút thu hồi có xác nhận.
- Success criteria: `pnpm -F @abm/crm build` exit 0.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 2.6 — Test nền tảng

- Target: tạo `apps/crm/test/agent-foundation.test.ts` theo cấu trúc `admin-users.test.ts`.
- Test cases:
  1. Lệnh `logActivity` chạy với actor kind `human` (import `runCommand` từ `../src/worker/commands` và dựng `Actor` literal; `commands.test.ts` không gọi trực tiếp nên không có mẫu sẵn) ghi activity `actor_kind='human'`.
  2. Cùng lệnh với actor từ `loadAgentActor` ghi `actor_kind='agent'` và audit `actor_kind='agent'`.
  3. Bật kill switch qua `PUT /api/admin/agent-kill-switch` bằng session Admin. Lệnh agent → `KILL_SWITCH_ON`, không có activity mới. Lệnh human → thành công.
  4. Admin agent cũng bị chặn khi bật.
  5. Không phải Admin gọi `PUT /api/admin/agent-kill-switch` → 403.
  6. Khóa user → token của user có `revoked_at`.
  7. Approval kind `agent_assign` insert được (CHECK mới).
- Verify: `pnpm -F @abm/crm test` exit 0, output không chứa `failed`; `pnpm -F @abm/crm typecheck` exit 0.
- Commit: `feat(crm): add agent identity foundation and kill switch`.

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

- Code: `git revert`.
- Migration chưa áp lên remote ở phase này. Chỉ phase 05 áp, và có backup.
