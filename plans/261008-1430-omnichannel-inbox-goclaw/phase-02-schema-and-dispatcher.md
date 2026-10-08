---
phase: 2
title: "Schema, contracts, dispatcher lease"
status: completed
priority: P1
effort: "2d"
dependencies: [1]
---

# Phase 02: Schema, contracts, dispatcher lease

## Goal

D1 có các bảng inbox theo [hợp đồng dùng chung](plan.md#hợp-đồng-dùng-chung-giữa-các-phase), `contact_point` nhận `zalo_uid`/`fb_psid`, và module dispatcher claim/lease/hoàn tất lệnh có test.

## Files to Create / Modify

- Create: `apps/crm/migrations/0012_inbox.sql`
- Create: `apps/crm/migrations/0013_contact_point_channels.sql`
- Create: `apps/crm/src/worker/inbox/dispatcher.ts`
- Create: `apps/crm/test/inbox-dispatcher.test.ts`
- Create: `apps/crm/test/inbox-schema.test.ts`
- Modify: `packages/contracts/src/index.ts` (thêm hằng số và schema zod cho inbox; không đổi lệnh cũ)
- Modify: `apps/crm/src/worker/env.ts` (thêm biến môi trường mới, đều optional)
- Modify: `apps/crm/test/helpers/reset-db.ts` (thêm các bảng mới vào danh sách xoá; sau khi xoá, chạy `INSERT OR IGNORE INTO customer_bot_switch (id, enabled) VALUES (1, 0)`; phase 06 thêm dòng tương tự cho `inbox_setting`)

## Tasks

### Task 2.1 — Đọc mẫu sẵn có

- Goal: nắm quy ước migration và test trước khi viết.
- Target files: `apps/crm/migrations/0004_agent_gateway.sql` (mẫu rebuild bảng có `PRAGMA defer_foreign_keys`), `apps/crm/migrations/0011_privacy_requests.sql`, `apps/crm/test/helpers/reset-db.ts`, `apps/crm/test/agent-foundation.test.ts`.
- Steps: đọc bốn file; ghi lại cách test áp migration (`TEST_MIGRATIONS`) và cách tạo actor test.
- Verify: no verification needed.

### Task 2.2 — Migration `0012_inbox.sql`

- Goal: tạo 8 bảng mới đúng tên cột ở plan.md.
- Target files: `apps/crm/migrations/0012_inbox.sql`.
- Steps:
  1. Viết `CREATE TABLE` cho `channel_account`, `conversation`, `message`, `channel_command`, `lead_intake`, `inbox_roster`, `group_schedule`, `customer_bot_switch` với CHECK cho mọi cột enum, khoá ngoại tới `organization(id)`, `app_user(id)`, `contact(id)`, `lead(id)`, `conversation(id)`, `channel_account(id)` đúng như tên cột gợi ý.
  2. Mặc định: `bot_enabled` 1, `send_paused` 0, `daily_send_cap` 40, `mode` `'ai'`, `status` của `channel_command` `'pending'`, `attempts` 0, `summary_enabled` 0, `scheduled_opt_out` 0.
  3. Index: `conversation(organization_id, last_message_at)`, `conversation(assignee_user_id, mode)`, `message(conversation_id, created_at)`, `channel_command(target, status, next_run_at)`, `lead_intake(status, created_at)`, `group_schedule(status, next_run_at)`.
  4. `INSERT INTO customer_bot_switch (id, enabled) VALUES (1, 0);`
- Success criteria: file áp được trên D1 local.
- Verify: `cd apps/crm && npx wrangler d1 migrations apply abm-crm-eval --local` exit 0 và in `0012_inbox.sql`.

### Task 2.3 — Migration `0013_contact_point_channels.sql`

- Goal: `contact_point.type` nhận thêm `zalo_uid`, `fb_psid`.
- Target files: `apps/crm/migrations/0013_contact_point_channels.sql`.
- Steps:
  1. Theo mẫu rebuild của `0004`: `PRAGMA defer_foreign_keys = ON;`, tạo `contact_point_new` cùng cột với CHECK mới, `INSERT ... SELECT` toàn bộ, `DROP TABLE contact_point`, `ALTER TABLE contact_point_new RENAME TO contact_point`, tạo lại index `contact_point_lookup`.
  2. Đầu file ghi chú: "Backup D1 trước khi áp lên remote theo docs/engineering/deployment-baseline.md".
- Verify: lệnh apply local ở Task 2.2 chạy lại exit 0 và in `0013_contact_point_channels.sql`.

### Task 2.4 — Test schema

- Goal: chứng minh các ràng buộc chính.
- Target files: `apps/crm/test/inbox-schema.test.ts`.
- Steps: viết test (vitest, theo mẫu `agent-foundation.test.ts`):
  1. Chèn hai `message` cùng `conversation_id` + `external_msg_id` → lần hai lỗi UNIQUE.
  2. Chèn `conversation.mode = 'other'` → lỗi CHECK.
  3. Chèn `contact_point.type = 'zalo_uid'` → thành công; `type = 'fax'` → lỗi.
  4. `customer_bot_switch` có đúng một dòng `enabled = 0`.
- Verify: `pnpm -F @abm/crm test -- inbox-schema` exit 0.

### Task 2.5 — Contracts

- Goal: định nghĩa dùng chung cho Worker, web, sidecar.
- Target files: `packages/contracts/src/index.ts`.
- Steps: thêm và export:
  1. `CONVERSATION_MODES = ['ai','human','paused'] as const`, `SENDER_KINDS`, `CHANNEL_KINDS = ['zalo','facebook']`, `COMMAND_KINDS`.
  2. zod `bridgeEventSchema`: union theo `type`: `message` (accountExternalId, threadId, threadKind `direct`|`group`, msgId, fromSelf boolean, senderExternalId, senderName, text, attachments mảng tùy chọn, sentAt ISO, commandId tùy chọn: id lệnh `send_zalo` đã sinh ra tin này khi `fromSelf`), `account_status` (accountId bắt buộc, accountExternalId bắt buộc khi status `connected`, status, lastError tùy chọn), `qr` (accountId, imageDataUrl, expiresAt), `group_list` (accountExternalId, groups mảng {threadId, name}). Body là `{ events: bridgeEvent[] }`, tối đa 100 sự kiện.
  3. zod `bridgeCommandResultSchema`: `{ attempts: number, ok: boolean, externalMsgId?: string, text?: string, error?: string }`.
- Verify: `pnpm -F @abm/contracts typecheck` exit 0 (nếu package không có script này thì `pnpm -F @abm/crm typecheck` exit 0).

### Task 2.6 — Env

- Target files: `apps/crm/src/worker/env.ts`.
- Steps: thêm vào `Env` các trường optional `BRIDGE_SECRET`, `LARK_INBOX_CHAT_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `FB_PAGE_TOKENS` (chuỗi JSON), mỗi trường một dòng chú thích ngắn.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 2.7 — Dispatcher

- Goal: một module duy nhất tạo, nhận, gia hạn, hoàn tất lệnh.
- Target files: `apps/crm/src/worker/inbox/dispatcher.ts`.
- Steps: export các hàm (D1 thuần, không phụ thuộc Hono):
  1. `enqueueCommand(db, { kind, target, channelAccountId, conversationId, payload, dedupeKey, runAt? })`: `INSERT ... ON CONFLICT(dedupe_key) DO NOTHING`; trả id lệnh hoặc id có sẵn.
  2. `claimCommands(db, target, limit, leaseSeconds = 300, now)`: chọn lệnh `status='pending' AND next_run_at <= now` hoặc `status='claimed' AND lease_expires_at < now`, cập nhật thành `claimed`, `attempts = attempts + 1`, `claimed_at`, `lease_expires_at`; dùng `UPDATE ... WHERE id = ? AND (điều kiện cũ)` từng dòng để hai người claim cùng lúc không lấy trùng; trả các dòng đã claim thành công.
  3. `completeCommand(db, id, attempts, result)`: `UPDATE ... SET status='done', result_json=? WHERE id=? AND status='claimed' AND attempts=?`; trả `true` khi đổi đúng 1 dòng, `false` nếu không (kết quả cũ, người gọi phải bỏ qua).
  4. `failCommand(db, id, attempts, error, now)` (cùng điều kiện `status='claimed' AND attempts=?`; riêng khi Worker tự huỷ một lệnh chưa claim thì dùng `cancelCommand(db, id, error)` đặt `failed`): nếu `attempts >= 5` thì `status='failed'`, ngược lại `status='pending'`, `next_run_at = now + 2^attempts phút`.
  5. `accountSendsToday(db, channelAccountId, dayStartIso)`: đếm lệnh `send_zalo`/`send_messenger` `status IN ('claimed','done')` của tài khoản từ đầu ngày giờ Việt Nam.
- Success criteria: không có SQL nối chuỗi từ input; mọi giá trị qua `bind`.
- Verify: Task 2.8.

### Task 2.8 — Test dispatcher

- Target files: `apps/crm/test/inbox-dispatcher.test.ts`.
- Steps: test các trường hợp:
  1. `enqueueCommand` hai lần cùng `dedupeKey` → một dòng.
  2. Hai lần `claimCommands` liên tiếp → lần hai không lấy lại lệnh đã claim còn hạn.
  3. Lease hết hạn (truyền `now` sau `lease_expires_at`) → claim lại được, `attempts = 2`.
  4. `failCommand` lần 5 → `failed`; lần 1 → `pending` và `next_run_at` lùi 2 phút.
  4b. `completeCommand` với `attempts` cũ (lệnh đã bị claim lại) → trả `false`, trạng thái không đổi.
  5. `accountSendsToday` đếm đúng.
- Verify: `pnpm -F @abm/crm test -- inbox-dispatcher` exit 0.

### Task 2.9 — Hồi quy và commit

- Steps:
  1. Chạy toàn bộ: `pnpm -F @abm/crm test` và `pnpm -F @abm/crm typecheck`.
  2. Commit: `feat(crm): add inbox schema and leased command dispatcher`.
- Verify: cả hai lệnh exit 0; `git log -1 --format=%s` đúng thông điệp.

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
