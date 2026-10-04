---
phase: 4
title: "Nhắn Leader qua Lark khi có yêu cầu duyệt"
status: completed
priority: P1
effort: "0.5-1d"
dependencies: [3]
---

# Phase 04: Nhắn Leader qua Lark

## Goal

Khi có yêu cầu duyệt Won/Lost (`agent_stage_change` có `toStage` là `won` hoặc `lost`), giao lead (`agent_assign`) hoặc chuyển người phụ trách (`owner_change`), CRM gửi tin nhắn riêng Lark cho Leader của nhóm. Leader nhận tin phải đã liên kết Lark và không phải người yêu cầu.

Đổi giai đoạn thông thường **không** gửi tin. Gửi lỗi không làm hỏng yêu cầu duyệt, và trạng thái gửi được lưu lại.

## Files to Create / Modify

- Modify: `apps/crm/src/worker/lark.ts`. Tách hàm lấy tenant token dùng chung, thêm `sendText(env, openId, text)`.
- Create: `apps/crm/src/worker/approval-notify.ts`. Chứa `approvalNeedsLeaderDm`, `leaderRecipients`, `deliverApprovalDm(env, outboxId)`.
- Modify: `apps/crm/src/worker/commands.ts`. Thêm `requesterId` vào payload sự kiện `approval.requested` đã có.
- Không cần migration mới: cột `attempts`, `last_error`, `sent_at` của `outbox` đã có từ `0004_agent_gateway.sql`.
- Modify: `apps/crm/src/worker/index.ts` và `mcp-routes.ts`. Sau khi lệnh thành công, gọi `waitUntil` để gửi.
- Modify: `apps/crm/src/worker/admin-routes.ts`. Thêm `POST /admin/outbox/:id/resend` để Admin gửi lại tin lỗi.
- Create test: `apps/crm/test/approval-notify.test.ts`.
- Modify docs: `docs/adr/adr-004-chat-actor-identity.md` (nghĩa `actor_kind`, ngoại lệ Admin, tin Leader).

## Tasks

### Task 4.1 — `sendText` trong `lark.ts`

- Goal: gửi một tin văn bản tới một `open_id` bằng bot app.
- Target: `apps/crm/src/worker/lark.ts`.
- Steps:
  1. Tách đoạn lấy `tenant_access_token` trong `lookupOpenIds` thành `tenantToken(env)`, rồi cho `lookupOpenIds` dùng lại.
  2. Thêm hàm sau:

     ```ts
     sendText(env, openId, text)
     ```

     Hàm gọi `larkPost` tới `${LARK_BASE}/im/v1/messages?receive_id_type=open_id` với body:

     ```ts
     { receive_id: openId, msg_type: 'text', content: JSON.stringify({ text }) }
     ```

  3. Không đưa token hay secret vào thông điệp lỗi. `larkPost` hiện đã chỉ trả code/msg.
- Success criteria: test cũ `lark-link.test.ts` vẫn xanh.
- Verify: `pnpm -F @abm/crm test -- lark-link` exit 0.

### Task 4.2 — Quy tắc người nhận

- Goal: xác định đúng ai nhận tin.
- Target: `apps/crm/src/worker/approval-notify.ts`.
- Steps:
  1. Viết `approvalNeedsLeaderDm(kind, payload)`. Trả `true` khi:
     - `kind = 'owner_change'`; hoặc
     - `kind = 'agent_assign'`; hoặc
     - `kind = 'agent_stage_change'` và `payload.toStage` thuộc `('won','lost')`.
  2. Viết `leaderRecipients(db, lead, requesterId)`. Hàm trả `{id, display_name, lark_open_id}[]` gồm các `app_user` thỏa mọi điều kiện:
     - `status='active'`;
     - `role='leader'`;
     - `lark_link_status='linked'`;
     - `lark_open_id IS NOT NULL`;
     - `id <> requesterId`;
     - thuộc nhóm của lead: `team_id = lead.team_id`. Nếu `lead.team_id` là null (lead ở hàng chờ) thì dùng `department_id = lead.department_id`.
  3. Nội dung tin, bằng tiếng Việt và không chứa SĐT/email:

     ```text
     [CRM] <tên người yêu cầu> đề nghị <việc> cho lead <code> – <tên khách>. Duyệt tại: <origin>/approvals
     ```

- Success criteria: test ở Task 4.5 xanh.
- Verify: no verification needed (Task 4.5).

### Task 4.3 — Phát sự kiện trong cùng giao dịch

- Goal: mỗi approval có đúng một dòng `outbox` `approval.requested` ghi cùng batch. Sự kiện giữ nguyên cho **mọi** approval (đã có từ trước, kể cả đổi stage thường); việc lọc ai cần nhắn nằm ở bước gửi.
- Target: `commands.ts`. Sửa ở handler đề xuất (phase 03) và ở `requestOwnerChange`.
- Steps:
  1. `requestOwnerChange` và `propose` đã phát `approval.requested` (phase 03). Chỉ bổ sung `requesterId: actor.id` (và `toStage` cho owner_change là `null`) vào payload, không phát thêm sự kiện:

     ```ts
     tx.event('approval.requested', { approvalId, leadId, kind, toStage, requesterId: actor.id })
     ```

  2. Callback ở Task 4.4 chỉ gửi khi `approvalNeedsLeaderDm` đúng. `deliverApprovalDm` gặp approval không cần nhắn thì đặt `status='skipped'` và không gọi Lark.
- Success criteria: test ở Task 4.5 xanh.
- Verify: no verification needed (Task 4.5).

### Task 4.4 — Gửi sau khi commit

- Goal: tin được gửi ngoài giao dịch, và kết quả gửi được lưu vào `outbox`.
- Target: `approval-notify.ts`, `index.ts` (route `/commands/:name`), `mcp-routes.ts`, `admin-routes.ts`.
- Steps:
  1. Viết `deliverApprovalDm(env, outboxId)` theo thứ tự sau:
     - đọc dòng `outbox` có `status IN ('pending','failed')`;
     - nạp approval, lead và người yêu cầu;
     - tìm người nhận bằng `leaderRecipients`;
     - nếu không có ai: `status='no_recipient'`;
     - nếu có: gửi cho từng người;
     - gửi hết thành công: `status='sent'`, `sent_at=now`;
     - có lỗi: `status='failed'`, `last_error` = thông điệp `LarkError` (đã an toàn);
     - luôn tăng `attempts`;
     - mọi ngoại lệ đều bắt lại, không ném ra.
  2. Thêm `readonly eventIds: string[]` vào `GuardedTx`. `event()` push id của dòng outbox vào mảng này. Thêm tham số thứ 6 tùy chọn cho `runCommand`: `onCommitted?: (tx: GuardedTx) => void`. Gọi nó ngay sau khi `tx.commit()` thành công, không gọi khi replay. Route web `/commands/:name` và `/api/mcp` truyền callback. Callback lọc các id có event `approval.requested`, rồi gọi `background(c, deliverApprovalDm(c.env, id))` (helper ở phase 03) cho từng id. **Không** quét mọi outbox `pending`: eval đã có dòng cũ từ trước phase này, quét sẽ nhắn nhầm chúng khi deploy.

     Không đổi kiểu `ApiResult` trả cho client. Test cần chờ gửi xong thì dùng `createExecutionContext()` và `waitOnExecutionContext()` từ `cloudflare:test`, hoặc gọi thẳng `deliverApprovalDm`.
  3. Thêm route `POST /admin/outbox/:id/resend`:
     - chỉ Admin được gọi;
     - chạy `deliverApprovalDm` và chờ kết quả;
     - trả trạng thái mới;
     - ghi audit.
- Success criteria: test ở Task 4.5 xanh.
- Verify: no verification needed (Task 4.5).

### Task 4.5 — Test

- Target: tạo `apps/crm/test/approval-notify.test.ts`. Mock `fetch` bằng `vi.spyOn(globalThis, 'fetch')`, theo mẫu trong `lark-link.test.ts`. Seed Leader có `lark_link_status='linked'` và `lark_open_id` giả.
- Test cases:
  1. Sale xin Won qua bot (`tools/call change_stage`):
     - có approval;
     - có outbox `approval.requested`;
     - `deliverApprovalDm` gọi fetch tới `/im/v1/messages` đúng `receive_id` của Leader;
     - outbox thành `sent`.
  2. Sale đổi stage thường qua bot: có outbox `approval.requested` nhưng **không** gọi fetch tới Lark; gọi thẳng `deliverApprovalDm` thì outbox thành `skipped`.
  3. Leader tự yêu cầu giao lead: không có người nhận (chính Leader bị loại), outbox thành `no_recipient`.
  4. Lark trả HTTP 500:
     - approval vẫn `pending`;
     - outbox `failed`, `attempts=1`;
     - `last_error` không chứa chuỗi `Bearer`.
  5. Admin gọi resend sau khi fetch trả OK: outbox thành `sent`, `attempts=2`.
  6. Nội dung tin không chứa SĐT hay email của khách.
- Verify:
  - `pnpm -F @abm/crm test` exit 0 và output không chứa `failed` ngoài tên test;
  - `pnpm -F @abm/crm typecheck` exit 0.

### Task 4.6 — Cập nhật ADR-004

- Target: `docs/adr/adr-004-chat-actor-identity.md`.
- Steps: thêm mục "Quyết định 2026-10-04" ghi các ý sau:
  - token Bearer riêng từng người, lưu hash;
  - `actor_user_id` là người chủ token, `actor_kind` là kênh;
  - Admin qua agent làm thẳng, các vai trò khác tạo yêu cầu duyệt;
  - Leader nhận tin riêng Lark khi có yêu cầu Won/Lost, giao lead hoặc chuyển người phụ trách;
  - bot trả dữ liệu đầy đủ theo quyền, user chấp nhận rủi ro lộ trong nhóm;
  - kill switch.

  Giữ trạng thái `proposed`. Phase 05 mới đổi sang `accepted` sau khi chạy thật.
- Verify: `Select-String -Path docs/adr/adr-004-chat-actor-identity.md -Pattern "2026-10-04"` trả ít nhất một dòng.
- Commit: `feat(crm): notify team leaders on Lark about agent approval requests`

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

Dùng `git revert`. Các dòng outbox đã ghi không ảnh hưởng nghiệp vụ.
