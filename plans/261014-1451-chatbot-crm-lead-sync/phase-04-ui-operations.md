# Phase 4: Giao diện hướng 3 cho Tổng quan, Học phí, Đào tạo, Công việc và Quản trị

Làm sau phase 3. Thiết kế lấy từ `plans/reports/agy-261014-1440-crm-ui-redesign.md`, mục 4, giai đoạn 3.

## Task
- **`dashboard.tsx`, `overview.tsx`, `learner-reports.tsx`:** thẻ KPI có xu hướng tăng/giảm; bảng báo cáo chia lưới 2–3 cột, có thanh tỷ lệ.
- **`fees.tsx`, `fees-queue.tsx`, `fee-guide.tsx`:** dải KPI tài chính; form khoản thu và thanh toán đưa vào `Drawer`.
- **`courses.tsx`, `class-detail.tsx`, `session-attendance.tsx`:** bảng thao tác nhanh. Trang khóa học nhóm theo chương trình.
- **`tasks.tsx`:** 3 cột Quá hạn, Hôm nay, Sắp tới.
- **`channel-accounts.tsx`:** form thêm tài khoản kênh đưa vào Modal.
- Không đổi hành vi nghiệp vụ.

## Files được sửa
`apps/crm/src/web/**`, `apps/crm/test/**`.

## Kiểm tra cuối phase
`pnpm -F @abm/crm test`, `typecheck` và `build` đều exit 0.

## Failure Protocol
Giống phase 1.
