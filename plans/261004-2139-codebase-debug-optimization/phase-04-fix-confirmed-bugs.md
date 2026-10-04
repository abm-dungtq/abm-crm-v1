---
phase: 4
title: Sửa lỗi đã xác nhận kèm test hồi quy
status: pending
runtime: codex
depends_on: [1, 2, 3]
---

# Phase 04 — Sửa lỗi (ak-cook, ak-test, ak-code-review)

## Goal

Sửa các lỗi critical/high đã xác nhận trong ba báo cáo; mỗi lỗi có test hồi quy.

## Input

Trong thư mục `reports/` của plan này:

- `test-debug-report.md`
- `review-worker-api.md`
- `review-web-ui.md`

## Scope

- Được ghi: `apps/crm/src/**`, `apps/crm/test/**`, `packages/contracts/src/**`.
- Được ghi thêm: `reports/fix-log.md` của plan này.
- Không tạo migration mới, trừ khi lỗi bắt buộc phải có. Nếu cần, hỏi coordinator qua Orca trước.

## Steps

1. Lập danh sách lỗi critical/high có trạng thái CONFIRMED.
   - Với lỗi PLAUSIBLE: viết test tái hiện trước.
   - Không tái hiện được thì bỏ qua và ghi lý do.
2. Với mỗi lỗi:
   - viết test fail trước;
   - sửa theo nguyên nhân gốc;
   - chạy lại test đó.
3. Lỗi medium/low:
   - chỉ sửa khi nhỏ, rõ ràng và không đổi contract;
   - còn lại để cho phase 05.
4. Chạy `ak-test` (toàn bộ test, typecheck, build), rồi chạy `ak-code-review` trên diff.
5. Ghi `reports/fix-log.md`:
   - lỗi đã sửa, kèm file và test;
   - lỗi bỏ qua, kèm lý do.

## Verify

- `pnpm -F @abm/crm test` exit 0.
- `pnpm -F @abm/crm typecheck` exit 0.
- `pnpm -F @abm/crm build` exit 0.
- Diff chỉ nằm trong Scope.
