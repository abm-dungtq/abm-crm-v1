---
phase: 1
title: "Đúng nghiệp vụ và API"
status: completed
priority: P1
runtime: claude
dependencies: []
---

# Phase 01: Đúng nghiệp vụ và API

## Goal

Dùng `ak-test` (audit suite hiện có, chạy test, rồi bổ sung test cho khoảng trống) để tìm lỗi nghiệp vụ trong command, read model và giờ làm việc của CRM.

## Context

- Nguồn đúng: `docs/architecture/state-machines-v1.md`, `docs/architecture/erd-v1.md`, `docs/security/permission-matrix-v1.md`, `docs/adr/` (ADR-003, ADR-005), `plans/261004-1005-crm-mvp1-eval-ui/plan.md` (rút gọn có chủ đích — không coi là lỗi).
- Mã: `packages/contracts/src/index.ts`, `packages/contracts/src/working-time.ts`, `apps/crm/src/worker/{commands,queries,scope,guarded-tx}.ts`.
- Test hiện có: `apps/crm/test/commands.test.ts` (20 test, Vitest + `@cloudflare/vitest-plugin`, D1 thật trong workerd, seed `apps/crm/seed/demo.sql`).
- Lệnh dự án (chạy từ `D:/TQD/CRM`): `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`, `pnpm -F @abm/contracts typecheck`.

## Góc kiểm tra

1. State machine stage: chỉ tiến một bước, Won chỉ từ closing, Lost cần lý do (`other` cần ghi chú), lead đã đóng không đổi được nữa.
2. Liên hệ lần đầu: `first_contact_at` chỉ do hoạt động loại liên hệ đặt; SLA 4 giờ làm việc; nhả lead sau 24 giờ làm việc.
3. Forced Next Action: mọi lead đang mở luôn có đúng một việc tiếp theo mở; hoàn thành việc đó bắt buộc tạo việc mới.
4. Giờ làm việc: 08:00–17:30 +07:00, thứ 2–6; biên đầu/cuối ngày, cuối tuần, qua nửa đêm UTC.
5. Duyệt: đổi owner và đề xuất stage của agent; stale khi `lead.version` đổi; ai được duyệt.
6. Read model: dashboard, tasks bucket (quá hạn/hôm nay/sắp tới theo giờ VN), search, accountDetail theo phạm vi vai trò.
7. Kiểm trùng: chuẩn hoá số điện thoại (84→0, khoảng trắng, dấu), email hoa/thường, mã số thuế, tên công ty.
8. Tiền: số nguyên đồng, không âm, giới hạn lớn.

## Files

- Create: `apps/crm/test/domain-*.test.ts` (một hoặc nhiều file, chỉ test pass trên mã hiện tại).
- Create: `plans/261004-1040-multi-agent-test-audit/reports/phase-01-domain-api-correctness.md`.
- Không sửa file nào khác.

## Steps

1. Đọc `ak-test` và `references/practical-principles-for-setting-up-and-running-tests.md`.
2. Chạy suite hiện có, ghi kết quả.
3. Audit suite hiện có (`ak-test audit` cho phạm vi trên): test yếu, thiếu nhánh lỗi.
4. Với mỗi góc kiểm tra, viết test hoặc lệnh tái hiện. Hành vi đúng → thêm test pass. Hành vi sai → ghi phát hiện kèm lệnh tái hiện, không commit test đỏ.
5. Chạy lại typecheck + test.

## Report format

Mỗi phát hiện: ID `D-xx`, mức độ (critical/high/medium/low), `file:line`, mô tả, bước tái hiện (lệnh hoặc đoạn test), mong đợi vs thực tế, nguồn quy tắc (docs). Cuối báo cáo: test đã thêm, kết quả lệnh, những gì chưa kiểm tra và lý do.

## Acceptance

- `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm test` pass.
- Báo cáo đủ định dạng; mỗi góc kiểm tra 1–8 có kết luận (đạt / lỗi / chưa kiểm tra + lý do).
