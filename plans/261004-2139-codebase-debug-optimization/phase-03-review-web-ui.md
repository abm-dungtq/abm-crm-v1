---
phase: 3
title: Review giao diện web
status: pending
runtime: antigravity
---

# Phase 03 — Review frontend (ak-code-review)

## Goal

Danh sách lỗi và điểm yếu của web React/Vite/TanStack Router/Query.

## Scope

- Đọc: `apps/crm/src/web/**`, `apps/crm/index.html`, `apps/crm/vite.config.*`, `apps/crm/package.json`.
- Ghi: chỉ `plans/261004-2139-codebase-debug-optimization/reports/review-web-ui.md`.

## Steps

1. Chạy skill `ak-code-review` ở chế độ review toàn codebase, tập trung vào:
   - xử lý lỗi, trạng thái loading và trạng thái rỗng;
   - invalidation của TanStack Query sau lệnh ghi;
   - menu và route hiển thị theo vai trò có khớp với quyền của API không;
   - accessibility: nhãn, focus, dùng được bằng bàn phím, hiển thị ở khổ 375px;
   - render thừa và bundle lớn: chạy `pnpm -F @abm/crm build` để xem kích thước từng chunk;
   - code trùng lặp giữa các trang.
2. Kiểm lại từng phát hiện trên code trước khi ghi; ghi rõ CONFIRMED hay PLAUSIBLE.
3. Báo cáo gồm:
   - bảng phát hiện: mức độ, `file:dòng`, kịch bản, đề xuất;
   - mục "Cơ hội tối ưu" tách riêng.

## Verify

- Báo cáo tồn tại; mọi phát hiện có `file:dòng`.
- `git status --short` không có thay đổi nào ngoài file báo cáo. Thư mục `dist` đã được ignore.
