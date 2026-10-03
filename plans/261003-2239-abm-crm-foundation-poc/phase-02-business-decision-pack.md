---
phase: 2
title: "Decision pack mục 43 PRD và deliverables business MVP0"
status: pending
priority: P1
effort: "3-5 ngày (phụ thuộc thời gian user trả lời)"
dependencies: [1]
---

# Phase 02: Decision pack mục 43 PRD và deliverables business MVP0

## Goal

Một tài liệu trả lời 11 quyết định mục 43 PRD, các deliverables business MVP0 (PRD 34.2) và 10 câu exit gate (PRD 34.6). Tài liệu phân biệt rõ phần đã chốt với phần đề xuất chờ duyệt, và có dấu duyệt của user.

## Context

- Đọc trước: `docs/source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md` mục 8–19, 21–23, 34, 41, 43; `docs/source-package/design/abm-agentic-crm-design.md` mục "Các quyết định data model cần khóa" và "System of Record"; `plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md` mục "Quyết định user".
- Quyết định đã chốt ghi trong `plan.md` mục "Quyết định đã chốt". Không đổi chúng.
- Executor KHÔNG được tự quyết thay user các mục kinh doanh. Mỗi mục có dòng trạng thái dùng marker ASCII: `Trạng thái: ĐÃ CHỐT [DECIDED]` hoặc `Trạng thái: ĐỀ XUẤT — chờ duyệt [PROPOSED]`.

## Files to Create / Modify

- Create: `D:/TQD/CRM/docs/decisions/business-decisions-v1.md`
- Create: `D:/TQD/CRM/docs/decisions/open-questions.md`

## Tasks

### Task 2.1 — Dựng khung tài liệu
- Goal: file có đủ mục quyết định, deliverables MVP0 và exit gate.
- Target: `docs/decisions/business-decisions-v1.md`.
- Steps: tạo các heading cấp 2 đúng thứ tự: `## QĐ1 Pipeline MVP`, `## QĐ2 Customer Object Model`, `## QĐ3 Unique Identity`, `## QĐ4 Ownership`, `## QĐ5 Role/Permission`, `## QĐ6 Product/Entitlement`, `## QĐ7 Handover`, `## QĐ8 Payment`, `## QĐ9 System of Record`, `## QĐ10 Stack`, `## QĐ11 Migration Scope`, `## QĐ12 Danh mục nguồn Lead`, `## QĐ13 Quy tắc Next Action`, `## QĐ14 Data Distribution Policy`, `## Exit gate MVP0`, `## Phê duyệt`. Mỗi mục QĐ có ba dòng: `Trạng thái:`, `Nội dung:`, `Nguồn:` (link mục PRD/report).
- Success criteria: đủ 16 heading cấp 2.
- Verify: `grep -c '^## ' /d/TQD/CRM/docs/decisions/business-decisions-v1.md` in ra `16`.

### Task 2.2 — Điền các mục đã chốt
- Steps:
  1. QĐ1 `[DECIDED]`: B2B/Inhouse; stage Lead mới → Đã liên hệ → Tiềm năng → Tư vấn → Báo giá → Đàm phán → Chờ chốt → Won/Lost. Lý do Lost và SLA từng stage để `[PROPOSED]` trong cùng mục.
  2. QĐ8 `[DECIDED]`: MISA AMIS Kế toán là nguồn thực thu; bảng kế toán duyệt dùng import/đối soát; CRM chỉ giữ PaymentReference; không xác nhận thu từ chat.
  3. QĐ9 `[DECIDED]`: bảng SoR lấy từ thiết kế mục "System of Record", thêm dòng "Chat nội bộ: Lark là nguồn, CRM giữ timeline/reference; GoClaw giữ session/memory, không phải nguồn nghiệp vụ".
  4. QĐ10 `[PROPOSED]`: chờ ADR ở phase 04; ghi hướng Cloudflare Workers + D1 + R2 + Queues, Hono, Drizzle, React PWA.
  5. QĐ11 `[DECIDED]` một phần: Lark Base không có dữ liệu cần migrate; nguồn Notion/Sheet/Zalo cần user liệt kê (đưa vào câu hỏi).
- Verify: `grep -c 'DECIDED' /d/TQD/CRM/docs/decisions/business-decisions-v1.md` in ra số ≥ `4`.

### Task 2.3 — Soạn đề xuất cho các mục chưa chốt
- Steps (mỗi mục ghi `[PROPOSED]`):
  1. QĐ2: `Account` (doanh nghiệp khách) tách `Organization` (nội bộ ABM); `Contact` là cá nhân, thuộc 0..n Account qua `AccountContact` có vai trò (người quyết định, liên hệ, thanh toán, học viên); `Lead` là nhu cầu đầu vào gắn Contact/Account; `Deal` là cơ hội thương mại tạo khi Lead qualified; Customer 360 là view, không phải bảng riêng.
  2. QĐ3: email và số điện thoại chuẩn hóa (E.164) là tín hiệu trùng, không unique tuyệt đối; mã số thuế unique cho Account khi có; channel identity (Lark open_id) unique theo namespace.
  3. QĐ4: owner là người được giao Lead/Deal; nhả lead khi quá SLA chưa liên hệ (số giờ chờ user); chuyển owner cần Leader duyệt; sale nghỉ thì Leader phân lại hàng loạt có audit; người hỗ trợ có quyền xem và ghi hoạt động, không đổi stage.
  4. QĐ5: tham chiếu `docs/security/permission-matrix-v1.md` (phase 04).
  5. QĐ6 (v0 cho MVP0, chi tiết trước MVP2): Product Master mẫu gồm một sản phẩm user cung cấp (mã, tên, loại, giá niêm yết, version, hiệu lực); Entitlement Model: template gắn product version, OrderLine snapshot, entitlement sinh từ order line khi đủ điều kiện thanh toán theo sản phẩm, có beneficiary, số lượng, hạn, trạng thái theo PRD 15.
  6. QĐ7 (v0 cho MVP0): Handover Schema gồm trường bắt buộc lấy từ PRD 13.3 và 36.6 (liệt kê từng trường), gate Complete khi thiếu trường bắt buộc, change control sau Complete.
  7. QĐ12: danh mục nguồn Lead từ PRD 9.1, user đánh dấu nguồn đang dùng.
  8. QĐ13: Lead/Deal active bắt buộc Owner + Next Action + Deadline; hoàn thành next action phải tạo next action mới trong cùng thao tác, trừ khi chuyển Won/Lost; ngoại lệ có chủ đích (ví dụ tạm hoãn có ngày mở lại).
  9. QĐ14: lead mới vào hàng chờ của phòng ban; Leader phân thủ công ở MVP1; tự động xoay vòng là tùy chọn chờ user.
- Verify: `grep -c 'PROPOSED' /d/TQD/CRM/docs/decisions/business-decisions-v1.md` in ra số ≥ `9`.

### Task 2.4 — Danh sách câu hỏi cho user
- Target: `docs/decisions/open-questions.md`.
- Steps: liệt kê đánh số tối thiểu các câu sau, mỗi câu có dòng `Đề xuất mặc định:` và marker `[Q]` đầu dòng câu hỏi:
  1. Lý do Lost (danh sách) và SLA từng stage.
  2. SLA first contact và khi nào lead bị nhả.
  3. Duyệt mô hình QĐ2 và quy tắc trùng QĐ3.
  4. Chuyển owner: Leader duyệt hay Leader tự làm?
  5. Danh sách phòng ban/nhóm Lark và Leader mỗi phòng.
  6. Nguồn dữ liệu cũ (Notion/Sheet/Zalo) cần migrate ở MVP1 và phần chỉ archive.
  7. Thời hạn lưu audit và dữ liệu CRM (đề xuất audit ≥ 2 năm).
  8. Một sản phẩm mẫu và quyền lợi mẫu cho QĐ6.
  9. Nguồn Lead đang dùng (QĐ12) và cách phân lead (QĐ14).
- Verify: `grep -c '\[Q\]' /d/TQD/CRM/docs/decisions/open-questions.md` in ra số ≥ `9`.

### Task 2.5 — Lấy duyệt của user (bắt buộc người thật)
- Steps:
  1. Gửi user đường dẫn hai file và hỏi từng câu (dùng công cụ hỏi user nếu có).
  2. Cập nhật câu trả lời vào QĐ tương ứng, đổi marker thành `[DECIDED]`.
  3. Ghi trong `## Phê duyệt` dòng `Đã duyệt bởi user: <tên> — <YYYY-MM-DD> [APPROVED]`.
- Success criteria: QĐ1–QĐ9, QĐ11–QĐ14 đều `[DECIDED]`; QĐ10 chờ ADR.
- Verify: `grep -c 'APPROVED' /d/TQD/CRM/docs/decisions/business-decisions-v1.md` in ra `1` và `grep -c 'PROPOSED' /d/TQD/CRM/docs/decisions/business-decisions-v1.md` in ra số ≤ `1`.
- Nếu user chưa trả lời: dừng phase ở trạng thái chờ, không tự điền.

### Task 2.6 — Commit
- Verify: `cd /d/TQD/CRM && git add docs/decisions && git commit -m "docs: add MVP0 business decision pack" && git log -1 --oneline` in ra dòng chứa `business decision pack`.

## Risk

Executor tự điền quyết định kinh doanh. Chặn bằng marker trạng thái và Task 2.5 bắt buộc người thật.

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
