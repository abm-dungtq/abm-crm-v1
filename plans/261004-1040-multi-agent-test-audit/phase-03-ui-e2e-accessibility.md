---
phase: 3
title: "Giao diện, E2E, khả năng tiếp cận"
status: pending
priority: P1
runtime: antigravity
dependencies: []
---

# Phase 03: Giao diện, E2E, khả năng tiếp cận

## Goal

Dùng `ak-test ui` trên bản build local để tìm lỗi giao diện, luồng người dùng, responsive và khả năng tiếp cận của CRM.

## Context

- Luồng chuẩn PRD 35.3: Lead vào → kiểm trùng → giao Sale → liên hệ lần đầu → hoạt động → Next Action → đổi stage → follow-up → Won/Lost → audit. Mô tả màn hình và vai trò: `plans/reports/crm-mvp1-eval-ui-261004.md`.
- Mã giao diện: `apps/crm/src/web/` (router, pages, components, styles.css).
- Chạy local (từ `D:/TQD/CRM/apps/crm`):
  1. `npx wrangler d1 migrations apply abm-crm-eval --local`
  2. `npx wrangler d1 execute abm-crm-eval --local --file seed/demo.sql` (chỉ trên state local trống; nếu đã có dữ liệu, xoá thư mục `apps/crm/.wrangler/state` trước — thư mục này bị gitignore và chỉ chứa dữ liệu mẫu)
  3. `pnpm build` rồi `npx wrangler dev --port 8787` (phục vụ cả `/api` và assets). Dùng đúng cổng 8787; nếu bận, báo coordinator, không đổi cổng.
- Chọn vai trò: màn hình đầu, hoặc `localStorage['abm-crm-demo-user']` = `u-lan` (Sale), `u-hung` (Leader), `u-head` (Trưởng phòng), `u-bgd` (BGĐ), `u-admin` (Admin).
- Không đụng URL Cloudflare thật `abm-crm-eval.*.workers.dev`.

## Góc kiểm tra

1. Luồng PRD 35.3 đầy đủ theo từng vai trò, gồm Won và Lost.
2. Trạng thái: loading, rỗng, lỗi API (409 stale khi hai tab sửa cùng lead, 422 validate, 403), thông báo thành công.
3. Responsive 390px, 768px, 1440px: tràn ngang, chữ bị cắt, drawer menu, bảng/thẻ.
4. Khả năng tiếp cận: điều hướng bàn phím, focus hiển thị, nhãn form, dialog (`<dialog>`) đóng bằng Esc và trả focus, độ tương phản, chế độ tối.
5. Lỗi console và request lỗi trên mọi trang.
6. Dữ liệu hiển thị: định dạng ngày giờ VN, tiền, nhãn tiếng Việt, đổi vai trò làm mới dữ liệu đúng phạm vi.

## Files

- Create: `plans/261004-1040-multi-agent-test-audit/reports/phase-03-ui-e2e-accessibility.md`.
- Ảnh chụp và script tạm để ngoài repo (thư mục tạm của hệ điều hành); chỉ dẫn đường dẫn trong báo cáo.
- Không sửa mã, không thêm dependency vào workspace.

## Steps

1. Đọc `ak-test` và `references/ui-testing-workflow.md`.
2. Dựng môi trường local như trên; ghi PID và cổng.
3. Kiểm tra từng góc; chụp bằng chứng cho mỗi lỗi.
4. Dừng `wrangler dev` mình đã chạy trước khi kết thúc.

## Report format

Mỗi phát hiện: ID `U-xx`, mức độ, trang/route + vai trò + độ rộng, `file:line` nếu xác định được, bước tái hiện, mong đợi vs thực tế, đường dẫn ảnh. Cuối báo cáo: công cụ trình duyệt đã dùng, phần chưa kiểm tra và lý do.

## Acceptance

- Báo cáo đủ định dạng; mỗi góc kiểm tra 1–6 có kết luận.
- Không còn tiến trình `wrangler dev` do phase này khởi chạy.
- `git status` không có thay đổi ngoài báo cáo.
