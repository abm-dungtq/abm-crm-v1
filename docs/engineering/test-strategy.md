# Chiến lược test

Nguồn: [PRD 28](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md), [ERD](../architecture/erd-v1.md), [permission matrix](../security/permission-matrix-v1.md), [action-risk](../security/action-risk-matrix-v1.md).

## Các tầng kiểm chứng

| Tầng | Công cụ / môi trường | Điều kiện pass |
| --- | --- | --- |
| Unit core policy | Vitest, không cần network | Scope own/team/department/org, Support chỉ activity, approval/risk, kill switch, SLA working calendar, duplicate và Next Action invariants đúng |
| Integration D1 | Vitest + `@cloudflare/vitest-pool-workers`, D1 local | Mutation/audit/outbox/idempotency cùng batch, missing/stale rollback, FK/CHECK, approval consume và retry đúng |
| Contract parity | Cùng fixture/schema qua REST và MCP | Cùng actor/scope/input cho cùng output hoặc error code; invalid input, scope denied, stale, kill switch không bypass |
| RBAC matrix | Sinh case từ ma trận đã duyệt | Mọi role × entity × action có allow và deny ngoài scope; Export/Admin/Audit không tự thừa hưởng R/W |
| Chat projection | Integration identity và response renderer | Nhóm không lộ PII/hoa hồng/Lost dù caller có quyền DM; spoofed actor, replay, roster lạ bị chặn |
| Remote concurrency | D1 staging cô lập | Hai writer cùng version chỉ một thắng; writer thua không mutation/audit/outbox; failure giữa batch rollback; kết quả có timestamp/build/schema |
| Restore drill | Staging có backup trước test | Time Travel + export fallback, file version, outbox/delivery ledger reconciliation; đo RPO ≤ 1 giờ/RTO ≤ 4 giờ |

Ma trận markdown hiện là contract review, không giả có generator/test chạy sẵn. Khi triển khai tạo policy fixtures tương ứng từng ô, kiểm coverage với ma trận; không tự suy quyền của ô pending. Kịch bản PRD: Create Customer, duplicate, assign/change owner, stage/Lost, PaymentReference, Handover, Entitlement và Permission chạy tại bậc có module; không xây module trước ladder.

## Gate và bằng chứng

Chạy test hẹp trước, mở rộng typecheck/build khi đổi shared contract. Phase 05 chứng minh D1; phase 06 chứng minh auth/actor. Local test không thay remote concurrency hoặc human approval. Restore drill ở mỗi bậc MVP0–5 và trước release có migration quan trọng theo [backup plan](../operations/backup-restore-plan.md). Dùng dữ liệu tổng hợp, D1/R2 staging riêng; user duyệt mọi remote resource/restore, không dùng dữ liệu thật. Lưu lệnh, exit code, pass/fail và artifact đã che secrets trong plans/reports; không ẩn test fail, không weakening test. Docs phase 04 chỉ xác minh nội dung, chưa tuyên bố runtime đã pass.
