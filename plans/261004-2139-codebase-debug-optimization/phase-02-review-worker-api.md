---
phase: 2
title: Review worker/API và contracts
status: pending
runtime: grok
---

# Phase 02 — Review backend (ak-code-review)

## Goal

Lập danh sách lỗi logic, bảo mật và hiệu năng của Worker Hono + D1 và `packages/contracts`.

## Scope

- Đọc: `apps/crm/src/worker/**`, `apps/crm/migrations/**`, `apps/crm/test/**`, `packages/contracts/**`, `docs/**`.
- Ghi: chỉ `plans/261004-2139-codebase-debug-optimization/reports/review-worker-api.md`.

## Steps

1. Chạy skill `ak-code-review` ở chế độ review toàn codebase (không phải review diff). Tập trung vào:
   - phân quyền và phạm vi dữ liệu theo vai trò (admin, director, head, leader, sale);
   - lệnh ghi: idempotency, `expectedVersion`, kill switch agent, audit;
   - `/api/mcp`, token agent, `originGuard`, approval và outbox Lark;
   - đăng nhập mật khẩu, phiên đăng nhập, khóa tài khoản sau nhiều lần nhập sai;
   - SQL: N+1, thiếu index, truy vấn không giới hạn, giới hạn CPU của gói free;
   - lộ PII trong response, log hoặc audit.
2. Trước khi ghi một phát hiện, kiểm lại trên code: đọc nơi gọi và test liên quan. Ghi rõ CONFIRMED hay PLAUSIBLE.
3. Viết báo cáo:
   - bảng phát hiện gồm mức độ, `file:dòng`, kịch bản lỗi và đề xuất sửa;
   - cuối báo cáo có mục riêng "Cơ hội tối ưu".

## Verify

- Báo cáo tồn tại, và mọi phát hiện đều có `file:dòng` cùng trạng thái xác nhận.
- `git status --short` không có thay đổi nào ngoài file báo cáo.
