# Tài liệu ABM CRM

## Tài liệu hiện có

- [Gói yêu cầu và thiết kế nguồn](source-package/README.md): PRD, thiết kế, phản biện và GoClaw handoff; giữ nguyên nội dung để kiểm SHA-256 bằng manifest.
- [Cấu trúc repository](engineering/repository-structure.md): ranh giới workspace trong `engineering/`.
- [Quy ước lập trình](engineering/coding-conventions.md): TypeScript, migration, command và audit.
- [Decision pack](decisions/business-decisions-v1.md) và [câu hỏi nghiệp vụ](decisions/open-questions.md).
- [ERD v1](architecture/erd-v1.md) và [state model](architecture/state-machines-v1.md).
- ADR: [stack](adr/adr-001-stack-cloudflare-modular-monolith.md), [web auth](adr/adr-002-web-auth.md), [D1 guard](adr/adr-003-d1-guarded-write-pattern.md), [chat actor](adr/adr-004-chat-actor-identity.md), [command contracts](adr/adr-005-command-contracts.md), [đăng nhập mật khẩu](adr/adr-006-password-login.md), [luồng học viên và học phí](adr/adr-007-learner-pipeline-and-fees.md), [sidecar Zalo](adr/adr-008-zalo-bridge-sidecar.md), [bot khách hàng](adr/adr-009-customer-facing-bot.md), [dispatcher lệnh lease D1](adr/adr-010-leased-command-dispatcher.md). Stack/contracts/đăng nhập mật khẩu/luồng học viên/sidecar Zalo/bot khách hàng/dispatcher lease accepted; web auth cũ superseded; guard/actor proposed tới khi PoC pass.
- Hướng dẫn: [mẫu danh sách nhân sự](guides/staff-roster-template.md) để Admin nhập tài khoản; [vận hành học viên](guides/learner-ops-user-guide.md) cho từng vai trò; [quy trình test Lark → CRM](guides/lark-crm-e2e-test.md) và báo cáo kết quả trên Lark.
- [PRD CRM bàn làm việc — vận hành học viên](source-package/sources/prd-crm-ban-lam-viec-learner-ops-20261005.md).
- Chính sách: [permission matrix](security/permission-matrix-v1.md), [action-risk matrix](security/action-risk-matrix-v1.md), [security baseline](security/security-baseline.md). Quyền chi tiết còn cần review theo gate của ma trận.
- Engineering: [môi trường](engineering/environments.md), [seed/config](engineering/seed-config-structure.md), [deploy](engineering/deployment-baseline.md), [test strategy](engineering/test-strategy.md).
- Operations: [backup/restore plan](operations/backup-restore-plan.md); SLA còn cần drill chứng minh.
- MISA: [coverage](integrations/misa/misa-coverage-v1.md), [đối soát payment](integrations/misa/payment-reconciliation-rules-v1.md).

## Các thư mục sẽ được bổ sung

Các thư mục dưới đây đã có tài liệu, tiếp tục bổ sung theo ladder; việc tồn tại tài liệu không đồng nghĩa mọi nội dung đã được duyệt hoặc PoC đã pass.

| Thư mục | Nội dung |
| --- | --- |
| `decisions/` | Quyết định nghiệp vụ và phê duyệt của user. |
| `architecture/` | ERD và state model. |
| `adr/` | Quyết định kiến trúc và bằng chứng lựa chọn. |
| `security/` | Ma trận quyền, rủi ro và chính sách bảo vệ dữ liệu. |
| `integrations/` | Hợp đồng tích hợp và bằng chứng coverage. |

Xem [plan foundation và PoC](../plans/261003-2239-abm-crm-foundation-poc/plan.md) để biết các deliverable và dependency.
