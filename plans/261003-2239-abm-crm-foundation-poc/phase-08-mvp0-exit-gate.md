---
phase: 8
title: "MVP0 exit gate review"
status: pending
priority: P1
effort: "0.5-1 ngày"
dependencies: [2, 3, 4, 5, 6, 7]
---

# Phase 08: MVP0 exit gate review

## Goal

Một báo cáo go/no-go cho MVP1 dựa trên bằng chứng: 10 câu exit gate PRD 34.6 có câu trả lời, ADR đã `accepted`, PoC pass, và danh sách việc còn mở. Kèm runbook GoClaw đủ để người khác tiếp quản.

## Files to Create / Modify

- Create: `D:/TQD/CRM/plans/reports/mvp0-exit-gate-<YYMMDD>.md`
- Create: `D:/TQD/CRM/docs/operations/goclaw-runbook.md`
- Create: `D:/TQD/CRM/docs/training/mvp0/` (7 file, xem Task 8.3b)
- Modify: `D:/TQD/CRM/plans/261003-2239-abm-crm-foundation-poc/plan.md` (cập nhật trạng thái phase)

## Tasks

### Task 8.1 — Checklist exit gate
- Steps: trong báo cáo, bảng 10 dòng theo PRD 34.6 (object trung tâm; quan hệ Customer–Contact–Company–Lead–Deal; pipeline MVP; Sale xem dữ liệu nào; giao/chuyển/nhả lead; nguồn sự thật; handover bắt buộc gì; entitlement sinh thế nào; payment thực thu lấy từ đâu; stack có ADR chưa), mỗi dòng có link tới file trả lời và trạng thái `ĐẠT [GATE-PASS]` hoặc `CHƯA ĐẠT [GATE-FAIL]`. Handover và entitlement được phép `ĐẠT — chốt chi tiết trước MVP2` nếu QĐ6/QĐ7 ghi như vậy.
- Verify: `grep -cE 'GATE-(PASS|FAIL)' <báo cáo>` in `10`.

### Task 8.2 — Trạng thái ADR và PoC
- Steps: liệt kê ADR-001..005 với trạng thái; liệt kê kết quả phase 05, 06, 07 (PASS/FAIL/chờ) kèm link báo cáo.
- Verify: `grep -c 'ADR-ACCEPTED' /d/TQD/CRM/docs/adr/*.md | grep -c ':1$'` in `5`. Nếu nhỏ hơn 5: kết luận báo cáo là `NO-GO` hoặc `GO có điều kiện`, ghi rõ ADR nào chưa accepted và vì sao.

### Task 8.3 — Runbook GoClaw
- Target: `docs/operations/goclaw-runbook.md`.
- Steps: viết từ `D:\Goclaw\docs\goclaw-system-overview.md` và kết quả phase 06: vị trí cài đặt, start/stop (PowerShell), backup/restore DB, danh sách patch local và cách build lại, cấu hình kênh Lark, MCP server CRM, credential per-user/per-group (quy trình cấp và thu hồi khi nhân viên nghỉ), hooks, kiểm tra sức khỏe, kế hoạch chuyển sang VPS Linux + Docker Compose trước pilot. Không chứa giá trị secret.
- Verify: `grep -ciE 'backup|restore|revoke|VPS' /d/TQD/CRM/docs/operations/goclaw-runbook.md` in số ≥ `4` (runbook phải có các từ này, có thể kèm chữ Việt) và `grep -ciE 'secret=|token=|sk-' /d/TQD/CRM/docs/operations/goclaw-runbook.md` in `0`.

### Task 8.3b — Tài sản đào tạo MVP0 (PRD 34.4)
- Target: thư mục `docs/training/mvp0/`.
- Steps: tạo các file, nội dung rút từ artefact đã có (decision pack, ERD, ADR, kết quả PoC), viết cho học viên ABM:
  1. `case-brain-first.md`: case "Brain First trước khi Vibe Code" — bối cảnh, các quyết định đã chốt, PoC phát hiện gì (ví dụ lỗi guard D1 chỉ kiểm version), bài học.
  2. `template-prd.md` và `template-erd.md`: khung trống rút từ PRD v2.1 và `erd-v1.md`.
  3. `checklist-data-model-lock.md`, `checklist-role-permission.md`, `checklist-system-of-record.md`: mỗi file ≥ 8 mục `- [ ]`.
  4. `lesson-ai-khong-tu-quyet-schema.md`: bài học "Không để AI tự quyết schema", có ví dụ từ dự án.
- Verify: `cd /d/TQD/CRM/docs/training/mvp0 && ls *.md | wc -l` in `7` và `grep -c -- '- \[ \]' checklist-*.md` mỗi file ≥ `8`.

### Task 8.4 — Kết luận và tư vấn
- Steps:
  1. Ghi `## Kết luận`: `GO`, `GO có điều kiện` (liệt kê điều kiện) hoặc `NO-GO` (liệt kê việc phải làm).
  2. Spawn `kongming` với báo cáo để lấy go/no-go độc lập; dán tóm tắt ý kiến vào mục `## Tư vấn kongming`.
  3. Gửi user báo cáo; ghi `Quyết định user: <GO|NO-GO> — <YYYY-MM-DD> [USER-DECISION]`.
  4. Cập nhật bảng phase trong `plan.md`; commit `docs: add MVP0 exit gate review and GoClaw runbook`.
- Verify: `grep -c 'USER-DECISION' <báo cáo>` in `1`.

### Task 8.5 — Bước tiếp theo
- Nếu GO: lập plan MVP1 bằng `/ak:plan --advice` dựa trên roadmap trong `plan.md`, ERD v1, ADR, ma trận quyền.
- Verify: `no verification needed`.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
