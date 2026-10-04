---
phase: 4
title: "Đối chiếu chéo và hợp nhất"
status: pending
priority: P1
runtime: claude
dependencies: [1, 2, 3]
---

# Phase 04: Đối chiếu chéo và hợp nhất

## Goal

Kiểm chứng độc lập từng phát hiện của phase 01–03, loại trùng và báo động giả, xếp mức độ, và đề xuất phạm vi plan sửa.

## Context

- Đầu vào: `plans/261004-1040-multi-agent-test-audit/reports/phase-0{1,2,3}-*.md`, test mới trong `apps/crm/test/`.
- Nguồn đúng: `docs/` (state machine, ERD, ma trận quyền, ADR) và rút gọn có chủ đích trong `plans/261004-1005-crm-mvp1-eval-ui/plan.md`.
- Lệnh: `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`; giao diện chạy local theo phase 03 nếu cần tái hiện lỗi UI.

## Steps

1. Đọc `ak-test` (audit) và ba báo cáo.
2. Chạy lại typecheck + test trên cây kết hợp.
3. Tái hiện từng phát hiện bằng chính bước trong báo cáo; đánh dấu: đã tái hiện / không tái hiện / trùng với ID khác / đúng thiết kế (rút gọn có chủ đích).
4. Kiểm tra chất lượng test mới của 01–02: test có thật sự kiểm hành vi, không trùng lặp, không phụ thuộc thứ tự.
5. Ghi những vùng cả ba agent đều bỏ sót.
6. Đề xuất plan sửa: nhóm lỗi đã tái hiện theo module, thứ tự ưu tiên, test hồi quy cần có.

## Files

- Create: `plans/261004-1040-multi-agent-test-audit/reports/phase-04-consolidated-findings.md`.
- Không sửa mã hay test.

## Acceptance

- Mọi ID từ 01–03 xuất hiện trong bảng hợp nhất với trạng thái và lý do.
- Typecheck + test pass trên cây kết hợp, ghi lệnh và kết quả.
- Có danh sách vùng bỏ sót và đề xuất phạm vi plan sửa.
