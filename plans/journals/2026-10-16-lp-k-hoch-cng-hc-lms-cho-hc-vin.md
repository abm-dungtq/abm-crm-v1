---
title: Lập kế hoạch cổng học LMS cho học viên
date: 2026-10-16
summary: Plan 8 phase cho LMS dùng chung D1 với CRM; kongming GO-with-fixes đã áp dụng
---

# Lập kế hoạch cổng học LMS cho học viên

## What happened
- Lập plan `plans/261016-1602-lms-learner-portal/` (8 phase, chế độ --advice, mỗi phase có Failure Protocol).
- Red-team kongming: GO-with-fixes. Đã sửa: tsconfig lms-core cần DOM lib; lọc lead partner ở rollup dashboard; script token đăng bài không thu hồi token GoClaw; postMessage dùng '*' + kiểm event.source vì iframe sandbox có origin rỗng; CSP trang học đặt ở public/_headers; khoá tài khoản trả 401.
- Lỗi nhỏ: heredoc bash chứa python bị lỗi dấu nháy, chuyển sang file script viết bằng Write.

## Decision
- Chạy tuần tự 01→08 vì phase 02–05 cùng sửa commands.ts, index.ts, contracts.
- Nhập nhân viên doanh nghiệp vẫn ở trang Đối tác với vai trò hiện có.

## Next steps
- User xác nhận 4 mặc định trong Validation Log (người nhập, Stream, phiên 30 ngày, director chỉ xem).
- Chạy `/ak:cook plans/261016-1602-lms-learner-portal/plan.md --advice`; Agy làm 01–07, Opus làm 08.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
