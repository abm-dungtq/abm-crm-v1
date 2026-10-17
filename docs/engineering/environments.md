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

## Worker cổng học viên (LMS)

Ba Worker dùng chung D1 `abm-crm-eval` ([ADR-011](../adr/adr-011-learner-lms-portal.md)): `abm-crm-eval` (CRM), `abm-lms` (`apps/lms/wrangler.jsonc`, trang học) và `abm-lms-content` (`apps/lms/wrangler.content.jsonc`, nội dung cẩm nang, R2 `abm-lms-content`). Origin nằm trong các file wrangler.

| Biến | Loại | Worker | Ý nghĩa |
| --- | --- | --- | --- |
| `CONTENT_SIGNING_SECRET` | secret | cả ba | Khoá HMAC ký link nội dung; ba Worker phải cùng giá trị. Bản gốc ở `~/.abm/content-signing-secret` trên máy quản trị. |
| `LMS_CONTENT_ORIGIN` | var | CRM, LMS | Origin của `abm-lms-content`. |
| `LMS_ORIGIN` | var | content | Origin trang học, đưa nguyên văn vào `frame-ancestors`; thiếu thì trả 500. |
| `STREAM_API_TOKEN` | secret | CRM | Token Cloudflare Stream để chép video từ link. Chưa đặt (chờ bật Stream). |
| `STREAM_ACCOUNT_ID` | var | CRM | Account id dùng cho Stream API. Chưa đặt. |
| `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_JWK` | secret | LMS | Khoá ký token phát video. Chưa đặt. |
| `STREAM_CUSTOMER_CODE` | var | LMS | Mã `customer-<code>` của Stream. Chưa đặt. |

Deploy: `pnpm --filter @abm/lms deploy:content`, `pnpm --filter @abm/lms run deploy`, `pnpm --filter @abm/crm run deploy`. Token đăng bài: `node scripts/issue-lms-publish-token.mjs --email <email>` (cwd `apps/crm`), xem [hướng dẫn đăng cẩm nang](../guides/lms-publish-handbook.md).

Chạy local (`wrangler dev`) mặc định ở chế độ mật khẩu: chạy `pnpm db:migrate:local`, `pnpm db:seed:local`, rồi `node scripts/bootstrap-admin.mjs --local --email admin@demo.abm.example` (cwd `apps/crm`) để có mật khẩu tạm Admin trong `apps/crm/.admin-bootstrap.local`. Muốn màn hình chọn vai trò demo thì tạo `apps/crm/.dev.vars` (đã ignore) với hai dòng `AUTH_MODE=` và `DEMO_MODE=1`.

Kiểm env/binding/destination trước deploy, migration, export/restore. Login/tạo tài nguyên remote và thay đổi GoClaw là bước user-only theo execution guide. Xem [deploy](deployment-baseline.md), [security](../security/security-baseline.md) và [backup](../operations/backup-restore-plan.md).

## Dữ liệu mẫu cho eval

Toàn bộ dữ liệu mẫu là dữ liệu giả, nằm trong `apps/crm/seed/`:

- `b2b-demo.sql`: 22 lead B2B mẫu. `learner-demo.sql`: 24 học viên, hợp đồng đối tác, lớp, buổi học, điểm danh, học phí.
- `import-200-learners-sample.csv`: file nhập thử 200 học viên giả.
- `load-eval-demo.mjs`: nạp mẫu lên eval (mặc định chạy thử, `--check` kiểm, `--apply` ghi). Cần file ánh xạ vị trí giữ chỗ sang id nhân viên thật, đặt ngoài repo, và `--backup-file` ngoài repo. File SQL chỉ hợp lệ trong 60 phút sau khi tạo.
- `cleanup-demo.sql`: xóa toàn bộ dữ liệu mẫu (id bắt đầu `demo-`).

Tạo lại hai file SQL và hướng dẫn chi tiết: `plans/reports/grok-261007-sample-data-impl.md`. `seed/demo.sql` là dữ liệu của test, không sửa.
