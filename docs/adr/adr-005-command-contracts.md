# ADR-005: Command contracts dùng chung

Trạng thái: accepted [ADR-ACCEPTED]
Ngày: 2026-10-03

## Bối cảnh

UI, REST và MCP phải cho cùng kết quả quyền với cùng principal/input; không để mỗi adapter tự định nghĩa schema/policy. Nguồn: [QĐ5/QĐ10](../decisions/business-decisions-v1.md), [ERD](../architecture/erd-v1.md); accepted theo phase authority và xác nhận coordinator.

## Quyết định

Mỗi command khai báo trong `packages/contracts`: `name`, `input` (Zod), `output`, `requiredScope` (own/team/department/organization), `riskLevel` (read/low/approval). Mọi command ghi có `idempotent: true`, idempotency key và `expectedVersion` khi sửa record; command nhiều record khai báo expectedVersion cho từng target mutable.

REST validator, MCP tool schema và UI form dùng cùng định nghĩa này. Các adapter không tự suy role từ requiredScope hoặc riskLevel: core kiểm capability, actor, actual resource ownership/team/department, projection channel, kill switch, approval và business invariants. `toggle_kill_switch` vẫn Admin-only dù nằm trong risk taxonomy chung. UI form validation không thay authorization backend.

Lỗi stable gồm `FORBIDDEN`, `STALE_VERSION`, `APPROVAL_REQUIRED`, `KILL_SWITCH_ON`, `DUPLICATE_SUSPECTED`, `VALIDATION_FAILED`. Cùng input/actor cho cùng domain result/error qua REST và MCP; transport envelope có thể khác theo protocol, không trả raw DB errors/secrets. Các mã conflict/not-found bổ sung sau phải khai báo contract và test parity, không tự map mọi lỗi DB sang stale.

Idempotency key namespace organization/source/action; bind command/request hash/actor. Cùng key khác payload/actor reject conflict; replay cùng request kiểm quyền hiện tại rồi trả stored result, không audit/outbox lần hai. Nonce ghi D1 là mới mỗi invocation, khác key retry. Approval bind exact payload/target version, approver và expiry; mutation/audit/outbox/idempotency result/approval consumption nguyên tử theo [ADR-003](adr-003-d1-guarded-write-pattern.md).

## Phương án đã xét

- Schema/validator riêng mỗi adapter: dễ lệch scope/risk; loại.
- Model tự cung cấp actor/scope: không phải trusted identity; loại.
- Shared typed contracts và core policy: chọn, giữ adapter mỏng.

## Hệ quả

Đổi command contract phải review callers và chạy parity/RBAC tests; không có validator thứ hai. [Action-risk](../security/action-risk-matrix-v1.md) và [permission](../security/permission-matrix-v1.md) là policy input đã review; quyền chưa duyệt deny mặc định. Scaffold chưa có full command implementation, ADR không tuyên bố các tool đã chạy.

## Bằng chứng/PoC

[Test strategy](../engineering/test-strategy.md) quy định contract parity, idempotency, stale/approval/kill switch cases. Phase 05/06 kiểm runtime; ADR chốt convention, không chốt tính đúng của auth hoặc D1 guard chưa PoC.
