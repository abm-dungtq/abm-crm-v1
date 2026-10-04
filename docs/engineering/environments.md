# Môi trường

Đích kiến trúc: local (Miniflare qua Wrangler), staging và production theo [ADR-001](../adr/adr-001-stack-cloudflare-modular-monolith.md). Scaffold hiện tại chưa có Wrangler manifest/binding thật; tên dưới đây là quy ước, không chứng minh tài nguyên đã tạo.

| Môi trường | Dữ liệu / hạ tầng | Ranh giới |
| --- | --- | --- |
| local | Miniflare D1/R2/Queues local, dữ liệu tổng hợp | Không remote binding production; secret local được ignore |
| staging | Worker/D1/R2/Queues/Access application và secrets riêng | Lark app và GoClaw agent riêng; roster/test credential riêng, không đổi GoClaw production |
| production | Tài nguyên/secrets riêng, chỉ dữ liệu được duyệt migrate | Chưa triển khai trong foundation/PoC; không seed/reset |

Tên logical theo `abm-crm-<env>`; tài nguyên nhiều loại thêm suffix: `abm-crm-staging-api`, `abm-crm-staging-db`, `abm-crm-staging-files`, `abm-crm-staging-events`. Manifest khi có là nguồn binding ID chuẩn; không copy ID/secrets vào docs. Mỗi env có queue producer/consumer, Cron, Access audience, MCP credential và Lark destination riêng; không có fallback tự động sang production. R2 private, quyền truy cập qua API policy.

## Biến xác thực của Worker CRM

| Biến | Loại | Ý nghĩa |
| --- | --- | --- |
| `AUTH_MODE` | var | `password` bật đăng nhập mật khẩu ([ADR-006](../adr/adr-006-password-login.md)). Có giá trị bất kỳ thì mọi đường demo tắt. |
| `DEMO_MODE` | var | `1` cho phép chọn người dùng demo bằng header. Chỉ dùng cho test và local khi `AUTH_MODE` trống; không đặt cùng `AUTH_MODE=password`. |
| `LARK_APP_ID`, `LARK_APP_SECRET` | secret | App Lark của bot GoClaw, dùng để tra `open_id` theo email. Đặt bằng `npx wrangler secret put`; không ghi vào repo hay docs. |

Chạy local (`wrangler dev`) mặc định ở chế độ mật khẩu: chạy `pnpm db:migrate:local`, `pnpm db:seed:local`, rồi `node scripts/bootstrap-admin.mjs --local --email admin@demo.abm.example` (cwd `apps/crm`) để có mật khẩu tạm Admin trong `apps/crm/.admin-bootstrap.local`. Muốn màn hình chọn vai trò demo thì tạo `apps/crm/.dev.vars` (đã ignore) với hai dòng `AUTH_MODE=` và `DEMO_MODE=1`.

Kiểm env/binding/destination trước deploy, migration, export/restore. Login/tạo tài nguyên remote và thay đổi GoClaw là bước user-only theo execution guide. Xem [deploy](deployment-baseline.md), [security](../security/security-baseline.md) và [backup](../operations/backup-restore-plan.md).
