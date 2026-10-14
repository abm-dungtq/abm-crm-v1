# Phase 3: Giao diện hướng 3 cho Lead, Pipeline và hồ sơ khách

Làm sau phase 2, dùng lại token và component của phase 2. Thiết kế lấy từ `plans/reports/agy-261014-1440-crm-ui-redesign.md`, mục 2.3 và mục 4, giai đoạn 2.

## Task
- **`pages/pipeline.tsx` và `pages/leads.tsx`:**
  - chuyển qua lại giữa Kanban và Bảng;
  - dải KPI pipeline;
  - thẻ kanban có SĐT, huy hiệu kênh, chương trình và nút mở chat.
- **`pages/lead-detail.tsx`:** cột phải gồm thẻ thông tin, nút sao chép SĐT và xem nhanh hội thoại Inbox gần nhất (dùng API có sẵn).
- **`pages/customers.tsx` và `pages/learners.tsx`:**
  - form tạo mới đưa vào `Drawer`;
  - có ảnh đại diện;
  - danh sách học viên có thanh thời gian giữ khách.
- **`pages/learner-detail.tsx`:** chia thành 4 tab: Cơ hội & Tư vấn, Lớp học, Học phí, Hồ sơ & Quyền riêng tư.
- Không đổi hành vi nghiệp vụ, chỉ đổi cách trình bày.

## Files được sửa
`apps/crm/src/web/**`, `apps/crm/test/**`.

## Kiểm tra cuối phase
`pnpm -F @abm/crm test`, `typecheck` và `build` đều exit 0.

## Failure Protocol
Giống phase 1.
