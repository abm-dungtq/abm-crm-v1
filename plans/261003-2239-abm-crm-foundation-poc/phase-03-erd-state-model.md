---
phase: 3
title: "ERD v1 và state model"
status: pending
priority: P1
effort: "2-3 ngày"
dependencies: [2]
---

# Phase 03: ERD v1 và state model

## Goal

ERD v1 chi tiết cho MVP1, entity roadmap cho MVP2–5 (đủ 12 module), và state machine cho Lead/Deal, Task, Approval, Outbox, được user duyệt trước khi viết migration.

## Context

- Đọc: `docs/decisions/business-decisions-v1.md` (QĐ2–QĐ4 đã chốt), PRD mục 21 (Data model lõi) và 35, thiết kế mục "Các quyết định data model cần khóa".
- Nguyên tắc bắt buộc: schema typed, không custom-field platform; mọi bảng nghiệp vụ có `id` (TEXT, ULID), `created_at`, `updated_at`, `version` (INTEGER) với bảng được sửa đồng thời; thời gian lưu UTC ISO-8601, timezone hiển thị `Asia/Ho_Chi_Minh`.
- D1 là SQLite: không dùng kiểu/tính năng riêng PostgreSQL.
- Không tự đổi QĐ đã chốt. Nếu ERD cần thay đổi quyết định, ghi vào mục "Cần user duyệt".

## Files to Create / Modify

- Create: `D:/TQD/CRM/docs/architecture/erd-v1.md`
- Create: `D:/TQD/CRM/docs/architecture/state-machines-v1.md`

## Tasks

### Task 3.1 — ERD MVP1
- Goal: mermaid `erDiagram` cho MVP1.
- Target: `docs/architecture/erd-v1.md`, mục `## MVP1`.
- Steps: mô tả tối thiểu các entity sau với khóa và quan hệ:
  - Nội bộ: `organization`, `department`, `user` (email, lark_open_id, status), `team`, `user_team`, `role`, `user_role`, `channel_identity` (namespace, external_id unique, user_id, linked_at), `lark_group_binding` (chat_id unique, department_id, status).
  - Khách: `account`, `contact`, `account_contact` (role), `contact_point` (type email/phone, normalized_value, verified), `duplicate_candidate`.
  - Bán hàng: `lead` (source, owner_user_id, stage_id, status, next_action_task_id, version), `deal`, `pipeline`, `stage` (order, entry/exit criteria JSON, sla_hours), `lost_reason`, `ownership_history`, `assignment`.
  - Việc và hoạt động: `task` (type, owner_user_id, due_at, status, version), `task_link` (entity_type, entity_id), `activity` (type call/meeting/email/note/chat, actor_user_id, source, source_ref).
  - Quản trị: `approval` (requester, action, payload_json, payload_hash, target_type, target_id, target_version, status, approver_user_id, expires_at), `audit_log` (initiating_user_id, executing_actor, action, entity, before_json, after_json, approval_id, correlation_id, source), `outbox` (event_type, payload_json, idempotency_key unique, status, attempts), `idempotency_key` (key unique, command, result_json), `agent_kill_switch` (scope, enabled, changed_by), `notification`.
- Success criteria: mỗi entity trên xuất hiện trong khối mermaid.
- Verify: `cd /d/TQD/CRM && for e in organization department user team channel_identity lark_group_binding account contact account_contact contact_point lead deal stage lost_reason ownership_history task task_link activity approval audit_log outbox idempotency_key agent_kill_switch; do grep -q "$e" docs/architecture/erd-v1.md || echo MISSING $e; done; echo DONE` chỉ in `DONE`.

### Task 3.2 — Ràng buộc và index
- Goal: bảng ràng buộc dưới ERD.
- Steps: mục `## Ràng buộc và index` liệt kê: unique `channel_identity(namespace, external_id)`; unique `lark_group_binding(chat_id)`; index `contact_point(type, normalized_value)` (không unique); unique `account(tax_code)` khi không null; index `lead(owner_user_id, status)`, `task(owner_user_id, status, due_at)`, `audit_log(entity, entity_id, created_at)`; unique `outbox(idempotency_key)`; CHECK: lead active phải có `owner_user_id` và `next_action_task_id` (ghi chú: kiểm ở command + test, vì SQLite không CHECK được liên bảng).
- Verify: `grep -c '^- ' /d/TQD/CRM/docs/architecture/erd-v1.md` in ra số ≥ `8`.

### Task 3.3 — Entity roadmap MVP2–5
- Goal: đủ 12 module có entity dự kiến, chưa chi tiết cột.
- Steps: mục `## Roadmap entity` bảng 3 cột (Module PRD | Bậc | Entity): Product/ProductVersion/PriceList/EntitlementTemplate/KnowledgeDoc (M4, MVP2); Proposal/ProposalVersion/Contract/Order/OrderLine snapshot/PaymentSchedule/PaymentReference (M5, MVP2); HandoverCase/HandoverChecklist/ChangeRequest (M6, MVP2); Program/Session/Enrollment/Resource/Reservation/ChecklistTemplate (M7, MVP3); Entitlement/Grant/Fulfillment (M8, MVP2); Ticket/Feedback/HealthSignal/ContactPlan (M9, MVP3); Opportunity(renewal/upsell/cross-sell/referral) (M10, MVP3–4); Conversation/Message/Attachment (M11, MVP4); Workflow/EventHandler/Dashboard snapshot (M12, MVP1–5).
- Verify: `cd /d/TQD/CRM && grep -cE '^\| *(M|[0-9])' docs/architecture/erd-v1.md` in ra số ≥ `9`.

### Task 3.4 — State machines
- Target: `docs/architecture/state-machines-v1.md`.
- Steps: bốn mermaid `stateDiagram-v2` và bảng chuyển trạng thái (từ, sang, ai được làm, điều kiện, cần duyệt?):
  1. Lead/Deal theo stage QĐ1; Lost bắt buộc `lost_reason`; mọi chuyển stage ghi audit; agent chỉ đề xuất, cần duyệt (theo quyết định đã chốt).
  2. Task: open → in_progress → done/cancelled; hoàn thành next-action task của lead active yêu cầu tạo next action mới trong cùng command (Forced Next Action).
  3. Approval: pending → approved → executed; pending → rejected/expired; approved → stale (khi target_version đổi hoặc payload_hash khác) → phải tạo approval mới.
  4. Outbox: pending → sent; pending → failed (attempts++) → pending; failed vượt ngưỡng → dead; external send kết quả không rõ → unknown → đối soát thủ công.
- Verify: `grep -c 'stateDiagram-v2' /d/TQD/CRM/docs/architecture/state-machines-v1.md` in ra `4`.

### Task 3.5 — Duyệt và commit
- Steps: gửi user hai file, ghi `Đã duyệt bởi user: <tên> — <YYYY-MM-DD> [APPROVED]` cuối `erd-v1.md`; commit `docs: add ERD v1 and state machines`.
- Verify: `grep -c 'APPROVED' /d/TQD/CRM/docs/architecture/erd-v1.md` in ra `1` và `git log -1 --oneline` chứa `ERD v1`.
- Nếu user chưa duyệt: dừng ở trạng thái chờ.

## Risk

ERD thiếu entity làm migration MVP1 phải đổi nhiều. Giảm bằng checklist Task 3.1 và duyệt user.

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
