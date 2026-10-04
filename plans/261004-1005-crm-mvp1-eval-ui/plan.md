---
title: "CRM MVP1 — bản đánh giá giao diện trên Cloudflare"
status: completed
priority: P1
branch: main
created: 2026-10-04
---

# CRM MVP1 — bản đánh giá giao diện trên Cloudflare

## Kết quả cần đạt

User mở một URL Cloudflare, chọn vai trò (Sale, Leader, Trưởng phòng, BGĐ, Admin) và chạy được luồng PRD 35.3 trên dữ liệu mẫu: Lead vào → kiểm trùng → giao Sale → liên hệ lần đầu → hoạt động → Next Action → đổi stage → follow-up → Won/Lost → audit.

Nguồn: [handoff](../handoffs/crm-frontend-design-cloudflare-deploy-20261004-1005.md), [ERD v1](../../docs/architecture/erd-v1.md), [state machines](../../docs/architecture/state-machines-v1.md), [ma trận quyền](../../docs/security/permission-matrix-v1.md), ADR-001/003/005.

## Phạm vi

- `packages/contracts`: Zod schema các command, mã lỗi ổn định (ADR-005).
- `apps/crm`: một Worker Hono phục vụ `/api/*` + static assets React/Vite/TanStack Router/Query; D1 `abm-crm-eval`.
- Màn hình: Tổng quan (Sale/Leader), Pipeline kanban, Lead (danh sách, hàng chờ, chi tiết), Khách hàng 360, Việc của tôi, Hàng chờ duyệt, Nhật ký audit, tìm kiếm toàn cục.
- Ghi dữ liệu theo guard pattern ADR-003 (version + `last_txn_id` + `_guard`), audit + outbox + idempotency cùng batch.

## Rút gọn có chủ đích cho bản đánh giá (ghi lại để MVP1 thật xử lý)

- Đăng nhập: chế độ DEMO chọn vai trò qua header `X-Demo-User`, chỉ bật khi `DEMO_MODE=1`. MVP1 thật dùng Cloudflare Access/Lark OAuth (ADR-002).
- Pipeline chỉ dùng bảng `lead` qua mọi stage; tách `deal` khi Tiềm năng để MVP1 thật.
- Migration SQL thuần qua Wrangler; chưa dùng Drizzle (ADR-001).
- Không có agent write, kill switch, notification push; hàng chờ duyệt gồm yêu cầu đổi owner và đề xuất mẫu của agent.
- Dữ liệu mẫu hư cấu, không có dữ liệu khách thật.

## Acceptance

1. `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm test` pass (stale version, Forced Next Action, kiểm trùng, phạm vi Sale, duyệt đổi owner stale).
2. `pnpm -F @abm/crm build` tạo assets; giao diện kiểm ở 390px và 1440px.
3. Deploy Worker `abm-crm-eval` + D1 `abm-crm-eval`, seed mẫu, URL trả về 200 và chạy hết luồng PRD 35.3.
4. Báo cáo đánh giá trong `plans/reports/`.

## Kết quả (2026-10-04)

Đạt cả 4 tiêu chí. URL https://abm-crm-eval.ngulongyquan.workers.dev — chi tiết kiểm chứng, rủi ro (URL công khai, chưa có Access) và cách seed lại/gỡ bỏ trong [báo cáo](../reports/crm-mvp1-eval-ui-261004.md).
