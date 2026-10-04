---
phase: 1
title: Chạy test, typecheck, build và debug lỗi
status: completed
runtime: codex
---

# Phase 01 — Test và debug (ak-test)

## Goal

Biết chính xác trạng thái chất lượng hiện tại và các lỗi thật, có bằng chứng.

## Scope

- Đọc: `apps/crm/**`, `packages/contracts/**`.
- Ghi: chỉ `plans/261004-2139-codebase-debug-optimization/reports/test-debug-report.md`.
- Không sửa code nguồn hay test.

## Steps

1. Chạy skill `ak-test` cho `apps/crm` và `packages/contracts`:
   - `pnpm -F @abm/crm test`
   - `pnpm -F @abm/crm typecheck`
   - `pnpm -F @abm/crm build`
   - `pnpm -r test`

   Nếu có sẵn coverage (`vitest run --coverage`) thì chạy thêm. Thiếu plugin thì ghi "không có coverage", không cài thêm.
2. Với mỗi test fail, lỗi type hoặc cảnh báo build: tìm nguyên nhân gốc và ghi `file:dòng`.
3. Tìm vùng thiếu test ở logic rủi ro cao:
   - phân quyền (`scope.ts`, `leadScope`);
   - lệnh ghi (commands);
   - MCP (`/api/mcp`);
   - approval và outbox;
   - đăng nhập mật khẩu.

   Khi nghi có lỗi, xác nhận bằng một test tạm đặt ngoài repo hoặc bằng truy vấn local. Xóa sau khi xong; không để lại file nào trong repo.
4. Viết báo cáo gồm:
   - số test và thời gian chạy;
   - danh sách lỗi: mức độ, `file:dòng`, cách tái hiện, nguyên nhân, hướng sửa;
   - vùng thiếu test;
   - test chậm hoặc chập chờn.

## Verify

- Báo cáo tồn tại và ghi lại các lệnh đã chạy kèm exit code.
- `git status --short` không có thay đổi nào ngoài file báo cáo.
