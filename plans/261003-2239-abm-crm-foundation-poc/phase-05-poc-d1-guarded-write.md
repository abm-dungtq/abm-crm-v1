---
phase: 5
title: "PoC D1 guarded write, concurrency, restore"
status: pending
priority: P1
effort: "2-3 ngày"
dependencies: [1, 4]
---

# Phase 05: PoC D1 guarded write, concurrency, restore

## Goal

Chứng minh bằng test chạy được rằng pattern ADR-003 trên D1: (a) command stale không đổi dữ liệu, không sinh audit/outbox; (b) hai writer song song chỉ một thắng; (c) lỗi giữa batch rollback toàn bộ; (d) Forced Next Action giữ được; (e) restore Time Travel hoạt động. Kết quả quyết định ADR-003 `accepted` hay phải sửa.

## Context

- Chỉ dùng database cô lập tên `abm-crm-poc`, dữ liệu tổng hợp. Không đụng staging/production (chưa tồn tại).
- Bước remote cần user đã chạy `wrangler login` (tài khoản Cloudflare của user). Executor không tự tạo tài khoản, không in token.
- Đọc: `docs/adr/adr-003-d1-guarded-write-pattern.md`, `docs/architecture/erd-v1.md`. Tài liệu D1: https://developers.cloudflare.com/d1/worker-api/d1-database/ (batch), https://developers.cloudflare.com/d1/reference/time-travel/.
- Phiên bản thư viện: cài bản mới nhất tại thời điểm chạy và ghi version vào báo cáo.

## Files to Create / Modify (chỉ trong `poc/d1-guard/`)

- Create: `poc/d1-guard/package.json` (name `@abm/poc-d1-guard`, scripts `test`, `typecheck`, `deploy`)
- Create: `poc/d1-guard/wrangler.jsonc` (binding `DB` → database `abm-crm-poc`)
- Create: `poc/d1-guard/migrations/0001_init.sql`
- Create: `poc/d1-guard/src/index.ts` (Hono app, route `POST /lead/:id/stage`, `POST /lead/:id/complete-next-action`)
- Create: `poc/d1-guard/src/guarded-write.ts`
- Create: `poc/d1-guard/vitest.config.ts`
- Create: `poc/d1-guard/test/guarded-write.test.ts`
- Create: `poc/d1-guard/scripts/race.mjs`
- Create: `D:/TQD/CRM/plans/reports/poc-d1-guarded-write-result.md`

## Tasks

### Task 5.1 — Scaffold
- Steps:
  1. Tạo các file trên; `pnpm add -F @abm/poc-d1-guard hono` và `pnpm add -D -F @abm/poc-d1-guard wrangler vitest @cloudflare/vitest-pool-workers typescript @cloudflare/workers-types`.
  2. `vitest.config.ts` dùng `defineWorkersConfig` với `wrangler.configPath: "./wrangler.jsonc"` và áp migrations vào D1 test (theo hướng dẫn `@cloudflare/vitest-pool-workers` hiện hành: `readD1Migrations` + `applyD1Migrations`).
- Verify: `cd /d/TQD/CRM && pnpm -F @abm/poc-d1-guard typecheck` exit 0.

### Task 5.2 — Schema tối thiểu
- Target: `migrations/0001_init.sql`.
- Steps: trước khi apply, đặt `database_id` tạm `"00000000-0000-0000-0000-000000000000"` trong `wrangler.jsonc` (thay bằng id thật ở Task 5.5). Tạo bảng `lead(id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, stage TEXT NOT NULL, next_action_task_id TEXT, version INTEGER NOT NULL DEFAULT 1, last_txn_id TEXT, updated_at TEXT NOT NULL)`, `task(id TEXT PRIMARY KEY, lead_id TEXT, status TEXT NOT NULL, due_at TEXT, version INTEGER NOT NULL DEFAULT 1, last_txn_id TEXT)`, `idempotency_key(key TEXT PRIMARY KEY, command TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL)`, `audit_log(id TEXT PRIMARY KEY, entity TEXT, entity_id TEXT, action TEXT, after_json TEXT, created_at TEXT)`, `outbox(id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, event_type TEXT, payload_json TEXT, status TEXT NOT NULL DEFAULT 'pending')`, `_guard(ok INTEGER NOT NULL CHECK (ok = 1))`.
- Verify: `cd /d/TQD/CRM/poc/d1-guard && npx wrangler d1 migrations apply abm-crm-poc --local` exit 0.

### Task 5.3 — Guarded write
- Target: `src/guarded-write.ts`, hàm `changeStage(db, {leadId, expectedVersion, stage, idempotencyKey})` và `completeNextAction(db, {leadId, taskId, expectedVersion, newTask})`.
- Steps:
  1. `changeStage` sinh `txnId` (ULID hoặc `crypto.randomUUID()`) rồi gọi `db.batch` đúng thứ tự SQL trong ADR-003: UPDATE có điều kiện version và đặt `last_txn_id=txnId`; INSERT guard `VALUES ((SELECT COALESCE((SELECT 1 FROM lead WHERE id=? AND version=expected+1 AND last_txn_id=txnId),0)))`; INSERT audit, outbox và `idempotency_key` bằng `SELECT ... WHERE id=? AND version=expected+1 AND last_txn_id=txnId`; cuối batch `DELETE FROM _guard`.
  2. Trước khi gọi batch, đọc `idempotency_key` theo key: nếu có → trả `result_json` cũ kèm `replay:true`, không ghi gì. Bắt lỗi batch chứa `CHECK constraint failed` → trả `{ok:false, code:"STALE_VERSION"}` (gồm cả lead không tồn tại → đổi thành `NOT_FOUND` nếu SELECT lead trước đó rỗng).
  3. `completeNextAction` trong một batch: đóng task cũ (điều kiện version), tạo task mới, cập nhật `lead.next_action_task_id` (điều kiện version), guard, audit. Thiếu `newTask` khi lead active → trả `VALIDATION_FAILED` trước khi gọi DB.
- Verify: `no verification needed` (Task 5.4 kiểm).

### Task 5.4 — Test local
- Target: `test/guarded-write.test.ts`. Các test bắt buộc (tên test đúng như sau):
  1. `stale version is rejected and leaves no audit or outbox` — gọi với version cũ (gồm cả trường hợp writer khác vừa tăng đúng version+1); kỳ vọng `STALE_VERSION`, đếm `audit_log`, `outbox` không tăng, `lead.stage` không đổi.
  2. `successful change writes lead, audit and outbox atomically` — đếm mỗi bảng +1, `_guard` rỗng.
  3. `sequential double submit with same expected version: second is stale`.
  4. `same idempotency key replays without duplicate outbox`.
  5. `failure mid-batch rolls back everything` — gọi `changeStage` với tùy chọn chỉ dùng trong test `injectFailureAfterUpdate: true`, tùy chọn này chèn statement `INSERT INTO _guard(ok) VALUES (0)` ngay sau UPDATE; kỳ vọng batch lỗi, `lead.version` và `lead.stage` không đổi, audit/outbox không tăng.
  6. `completing next action without a replacement is rejected for active lead`.
  7. `completing next action with replacement swaps task atomically`.
  8. `missing lead is rejected and writes nothing`.
- Verify: `cd /d/TQD/CRM && pnpm -F @abm/poc-d1-guard test` exit 0 và output chứa `8 passed`.

### Task 5.5 — Race trên D1 remote (cần user)
- Steps:
  1. Hỏi user xác nhận đã `wrangler login` và cho phép tạo database `abm-crm-poc` + Worker `abm-crm-poc` trên tài khoản của họ.
  2. `npx wrangler d1 create abm-crm-poc`, ghi `database_id` vào `wrangler.jsonc`; `npx wrangler d1 migrations apply abm-crm-poc --remote`; `npx wrangler deploy`.
  3. Seed 1 lead version 1 qua `npx wrangler d1 execute abm-crm-poc --remote --command "INSERT ..."`.
  4. `scripts/race.mjs`: gửi 20 cặp request song song `POST /lead/L1/stage` cùng `expectedVersion` (mỗi cặp dùng version hiện tại), ghi số thắng/thua.
- Success criteria: mỗi cặp đúng 1 `ok:true` và 1 `STALE_VERSION`; số dòng audit = số lần thắng.
- Verify: `node poc/d1-guard/scripts/race.mjs <worker-url>` in dòng `RACE_OK pairs=20 winners=20 audit=20`.

### Task 5.6 — Restore Time Travel (cần user)
- Steps:
  1. `npx wrangler d1 time-travel info abm-crm-poc` ghi bookmark hiện tại (B1).
  2. Chạy `UPDATE lead SET stage='Lost'` trên remote (dữ liệu tổng hợp).
  3. `npx wrangler d1 time-travel restore abm-crm-poc --bookmark=<B1>`.
  4. Đọc lại lead; đo thời gian từ lệnh restore tới khi đọc được dữ liệu đúng.
- Verify: `npx wrangler d1 execute abm-crm-poc --remote --command "SELECT stage FROM lead WHERE id='L1'"` trả stage trước bước 2.
- Ghi thêm: chạy `npx wrangler d1 export abm-crm-poc --remote --output exports/poc.sql` (thư mục `exports/` bị gitignore) và ghi kích thước file.

### Task 5.7 — Báo cáo và ADR
- Steps:
  1. Viết `plans/reports/poc-d1-guarded-write-result.md`: version thư viện, kết quả từng test, số liệu race, thời gian restore, giới hạn còn lại, đề xuất cho ADR-003.
  2. Nếu tất cả pass: đổi ADR-003 sang `accepted`, thêm link báo cáo vào `## Bằng chứng/PoC`.
  3. Hỏi user có xóa Worker và database `abm-crm-poc` không; chỉ xóa khi user đồng ý (`npx wrangler delete`, `npx wrangler d1 delete abm-crm-poc`).
  4. Commit `test: add D1 guarded write proof of concept`.
- Verify: `grep -c 'ADR-ACCEPTED' /d/TQD/CRM/docs/adr/adr-003-d1-guarded-write-pattern.md` in `1` (hoặc báo cáo ghi rõ FAIL và ADR giữ `proposed`).

## Risk

- `vitest-pool-workers` chạy D1 local, không chứng minh concurrency thật; Task 5.5 bù bằng remote.
- Tạo tài nguyên trên tài khoản user: chỉ sau khi user đồng ý, chỉ tên `abm-crm-poc`.

## Rollback

Xóa Worker và database `abm-crm-poc` khi user đồng ý; thư mục `poc/d1-guard/` có thể xóa sau MVP0.

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
