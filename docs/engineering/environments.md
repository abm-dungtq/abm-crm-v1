# Môi trường

Đích kiến trúc: local (Miniflare qua Wrangler), staging và production theo [ADR-001](../adr/adr-001-stack-cloudflare-modular-monolith.md). Scaffold hiện tại chưa có Wrangler manifest/binding thật; tên dưới đây là quy ước, không chứng minh tài nguyên đã tạo.

| Môi trường | Dữ liệu / hạ tầng | Ranh giới |
| --- | --- | --- |
| local | Miniflare D1/R2/Queues local, dữ liệu tổng hợp | Không remote binding production; secret local được ignore |
| staging | Worker/D1/R2/Queues/Access application và secrets riêng | Lark app và GoClaw agent riêng; roster/test credential riêng, không đổi GoClaw production |
| production | Tài nguyên/secrets riêng, chỉ dữ liệu được duyệt migrate | Chưa triển khai trong foundation/PoC; không seed/reset |

Tên logical theo `abm-crm-<env>`; tài nguyên nhiều loại thêm suffix: `abm-crm-staging-api`, `abm-crm-staging-db`, `abm-crm-staging-files`, `abm-crm-staging-events`. Manifest khi có là nguồn binding ID chuẩn; không copy ID/secrets vào docs. Mỗi env có queue producer/consumer, Cron, Access audience, MCP credential và Lark destination riêng; không có fallback tự động sang production. R2 private, quyền truy cập qua API policy.

Kiểm env/binding/destination trước deploy, migration, export/restore. Login/tạo tài nguyên remote và thay đổi GoClaw là bước user-only theo execution guide. Xem [deploy](deployment-baseline.md), [security](../security/security-baseline.md) và [backup](../operations/backup-restore-plan.md).
