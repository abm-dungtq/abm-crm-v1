# Báo cáo: CRM MVP1 — bản đánh giá giao diện trên Cloudflare

Ngày: 2026-10-04 · Plan: [261004-1005-crm-mvp1-eval-ui](../261004-1005-crm-mvp1-eval-ui/plan.md)

## Kết quả

- URL đánh giá: https://abm-crm-eval.ngulongyquan.workers.dev
- Worker `abm-crm-eval` (Hono `/api/*` + static assets React, SPA fallback), D1 `abm-crm-eval`.
- Đăng nhập DEMO: chọn người dùng ở màn hình đầu, đổi vai trò ở góc trái dưới. Header `X-Demo-User` chỉ được chấp nhận khi `DEMO_MODE=1`; thiếu header → 401.
- Dữ liệu hư cấu: 8 người dùng, 22 lead (3 ở hàng chờ phòng, 2 Won, 2 Lost), 3 yêu cầu chờ duyệt (1 đổi owner, 2 đề xuất stage của agent).

## Màn hình

| Màn hình | Vai trò | Nội dung chính |
|---|---|---|
| Tổng quan | Sale/Leader/Head/BGĐ | KPI, pipeline theo stage, theo Sale, lead cần chú ý, lý do Lost |
| Pipeline | Sale/Leader/Head/BGĐ | Kanban theo stage QĐ1, SLA stage, cảnh báo trễ, đổi stage |
| Lead | Sale/Leader/Head/BGĐ | Danh sách, hàng chờ phòng (Leader giao lead), tạo lead + kiểm trùng |
| Chi tiết lead | theo phạm vi | Stepper stage, Next Action bắt buộc, timeline hoạt động, SLA, task, audit |
| Khách hàng 360 | theo phạm vi | Account, contact, lead liên quan |
| Việc của tôi | Sale/Leader | Quá hạn / hôm nay / sắp tới |
| Hàng chờ duyệt | Sale/Leader/Head | Duyệt/từ chối, nhận diện yêu cầu stale |
| Nhật ký audit | Leader/Head/BGĐ/Admin | Diff trước/sau; Sale bị chặn (403) |
| Quản trị | Admin | Chỉ số hệ thống, không có dữ liệu khách |

## Kiểm chứng

- `pnpm -F @abm/contracts typecheck`, `pnpm -F @abm/crm typecheck`: sạch.
- `pnpm -F @abm/crm test`: 20/20 pass — phạm vi Sale, quyền theo vai trò, stale version, chuyển stage một bước, Lost cần lý do, liên hệ lần đầu, ghi đồng thời, idempotency, Forced Next Action, kiểm trùng, giao/nhả lead, duyệt (gồm stale), read model.
- Build: JS 489 KB (148 KB gzip), CSS 18 KB.
- Ảnh chụp headless 13 màn hình ở 1440px và 390px: không lỗi console, không tràn ngang.
- Luồng UI end-to-end (local): Sale ghi cuộc gọi → đổi Lead mới → Đã liên hệ; hoàn thành Next Action bị chặn khi chưa có việc mới, rồi thay việc mới; Leader giao lead từ hàng chờ; form tạo lead hiện cảnh báo trùng.
- Remote: `/` 200, route SPA 200, `/api/health` ok, `/api/leads` không header → 401; ảnh màn chọn vai trò, dashboard Leader, chi tiết lead 390px đều đúng.

## Rút gọn có chủ đích

Xem plan. Chính: đăng nhập DEMO thay Cloudflare Access/Lark OAuth; pipeline chỉ dùng bảng `lead`; migration SQL thuần thay Drizzle; chưa có agent write, kill switch, thông báo.

Lệch ADR-001: test dùng `@cloudflare/vitest-plugin` 1.3.6 + Vitest 4.1 với D1 thật trong workerd; cần ghi nhận vào ADR-001 nếu giữ hướng này.

## Rủi ro

- URL công khai, không có Cloudflare Access. Ai có link đều đọc/ghi được dữ liệu mẫu. Không nhập dữ liệu khách thật. Đề xuất bật Cloudflare Access (email allowlist) nếu chia sẻ rộng.
- Mốc thời gian lead mới tính theo giờ làm việc lúc sinh seed; để lâu SLA liên hệ sẽ chuyển sang trễ — sinh lại seed trước buổi đánh giá.

## Vận hành

Seed lại (từ `apps/crm`). `seed/demo.sql` chỉ có INSERT nên phải chạy trên DB trống: backup, xoá dữ liệu các bảng (hoặc tạo D1 mới và cập nhật `database_id`), apply migration, rồi seed.

```bash
npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-backup.sql
node seed/generate-demo-seed.mjs
npx wrangler d1 execute abm-crm-eval --remote --file seed/demo.sql
```

Triển khai lại: `pnpm -F @abm/crm deploy`.

Gỡ bỏ: `npx wrangler delete abm-crm-eval` và `npx wrangler d1 delete abm-crm-eval`.

## Còn chờ phía người dùng

Lark scopes + danh sách nhân sự, đường dẫn Excel MISA, Hermes trên máy khác, chọn agent, xoay Lark secret, chạy live phase 06, phase 08, cập nhật ADR-001.
