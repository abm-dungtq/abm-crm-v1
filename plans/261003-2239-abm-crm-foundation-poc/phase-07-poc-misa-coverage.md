---
phase: 7
title: "PoC MISA coverage (song song, không chặn)"
status: waiting
priority: P2
effort: "2-3 ngày (phụ thuộc kế toán)"
dependencies: [2]
---

# Phase 07: PoC MISA coverage

## Goal

Biết chắc ABM lấy dữ liệu thực thu từ MISA AMIS Kế toán bằng cách nào (Open API hay file kế toán xuất), dữ liệu có những trường nào, và quy tắc đối soát cho trường hợp một khoản thu nhiều order, thu một phần, sửa/hủy chứng từ. Phase này không chặn MVP1 (MVP1 không có payment); kết quả phục vụ MVP2.

## Context và ràng buộc

- Không truy cập DB MISA, không ghi sổ, không thay đổi gì trong MISA. Chỉ đọc tài liệu và dữ liệu mẫu kế toán cung cấp.
- Dữ liệu mẫu phải được kế toán khử nhận dạng (che tên khách, mã số thuế) hoặc chỉ dùng cấu trúc cột; không commit dữ liệu thật.
- Tài liệu: https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html.

## Files to Create / Modify

- Create: `D:/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md`
- Create: `D:/TQD/CRM/docs/integrations/misa/payment-reconciliation-rules-v1.md`

## Tasks

### Task 7.1 — Đọc tài liệu Open API
- Steps: liệt kê trong `misa-coverage-v1.md` mục `## Open API`: cách cấp `app_id`/mã kết nối, endpoint đọc chứng từ thu/công nợ, callback, giới hạn gọi, điều kiện gói dịch vụ. Mỗi ý có link nguồn.
- Verify: `grep -c 'actdocs.misa.vn' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` in số ≥ `1`.

### Task 7.2 — Hỏi kế toán (người thật)
- Steps: gửi user bộ câu hỏi, ghi câu trả lời vào mục `## Trả lời kế toán`:
  1. Gói AMIS hiện tại có bật Open API không? Ai có quyền cấp kết nối?
  2. Chứng từ thu ghi tham chiếu order/hợp đồng ở trường nào?
  3. Một phiếu thu cho nhiều hợp đồng xử lý thế nào? Thu một phần?
  4. Khi sửa/hủy chứng từ, có lịch sử hoặc mã chứng từ mới không?
  5. Bảng kế toán duyệt (import) có cột gì, ai duyệt, tần suất?
- Verify: mục có 5 câu trả lời; nếu chưa có, phase ở trạng thái chờ (không chặn phase 08 ngoài dòng MISA ghi "chờ").

### Task 7.3 — Mẫu dữ liệu và mapping
- Steps: với file mẫu đã khử nhận dạng (lưu ngoài repo), ghi danh sách cột và mapping sang `PaymentReference` (source, source_id, external_txn_id, amount, currency, received_at, account_ref, order_ref, confirmer, import_batch, version, status).
- Verify: `grep -c 'PaymentReference' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` in số ≥ `1`.

### Task 7.4 — Quy tắc đối soát
- Target: `payment-reconciliation-rules-v1.md`.
- Steps: viết quy tắc: precedence MISA API > bảng kế toán duyệt cho cùng `external_txn_id`; không cộng lặp; allocation một khoản cho nhiều order có tổng = số tiền; thu một phần giữ trạng thái `partial`; sửa/hủy chứng từ tạo version mới, chặn downstream (handover/entitlement) cho tới khi kế toán xác nhận; hàng không khớp vào `unmatched queue`; chỉ kế toán xác nhận.
- Verify: `grep -cE 'precedence|allocation|unmatched' /d/TQD/CRM/docs/integrations/misa/payment-reconciliation-rules-v1.md` in số ≥ `3`.

### Task 7.5 — Kết luận và commit
- Steps: mục `## Kết luận` ghi một trong: `API khả dụng`, `Chỉ import file`, `Chưa xác định — chờ <việc>`; commit `docs: add MISA coverage and reconciliation rules`.
- Verify: `grep -c '## Kết luận' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` in `1`.

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

## Execution checkpoint — 2026-10-03

- Task 7.1: DONE — [coverage](../../docs/integrations/misa/misa-coverage-v1.md) có nguồn chính thức cho kết nối, công nợ/pull, callback, giới hạn phân trang và các điểm gói ABM chưa xác minh. Không gọi API MISA.
- Task 7.2: PENDING-HUMAN — năm câu hỏi có `Trả lời: Chờ kế toán [UNVERIFIED]`, không phải năm câu trả lời đã nhận. Coordinator đã xác nhận chưa có câu trả lời và sẽ chuyển bộ câu hỏi tới user; phase giữ chờ theo nhánh Verify được cho phép.
- Task 7.3: mapping ứng viên đã ghi đủ 12 trường PaymentReference theo tài liệu công khai; đối chiếu mẫu thực tế PENDING-HUMAN vì chưa nhận file khử nhận dạng ngoài repo. Không tạo mẫu giả hoặc lưu dữ liệu thật trong repo.
- Task 7.4: DONE — [quy tắc đối soát](../../docs/integrations/misa/payment-reconciliation-rules-v1.md) có precedence, chống cộng lặp, allocation, partial, version sửa/hủy, chặn downstream, unmatched queue và quyền xác nhận kế toán.
- Task 7.5: kết luận DONE theo phương án chờ; commit NOT RUN, coordinator chịu trách nhiệm commit sau review theo Project execution guide.

Coordinator trả lời Orca ask cho task `task_46b3e7e3a8cf`, dispatch `ctx_9713a01e3b52`: hoàn thiện tài liệu từ nguồn công khai, đánh dấu câu trả lời và coverage ABM chưa xác minh, kết luận đúng chuỗi chờ bên dưới; worker báo succeeded cho phần được cho phép, không tự điền câu trả lời.

Kết luận: `Chưa xác định — chờ trả lời kế toán và xác nhận gói AMIS có Open API`. Phase này không chặn phase 08 ngoài dòng MISA ghi “chờ”. Không sửa status phase khác hoặc plan.md.

### Verify đã chạy

Các lệnh chạy nguyên văn bằng Git Bash trên Windows; chưa có kiểm tra nào bị thay bằng dữ liệu giả.

| Task | Verify | Output / kết quả |
| --- | --- | --- |
| 7.1 | `grep -c 'actdocs.misa.vn' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` | `9`, exit 0 — PASS ≥ 1. |
| 7.2 | Kiểm mục có năm câu trả lời; nếu chưa có giữ phase chờ | 0 câu trả lời thật, 5 câu hỏi chờ — PENDING-HUMAN; nhánh giữ chờ đã áp dụng. |
| 7.3 | `grep -c 'PaymentReference' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` | `2`, exit 0 — PASS ≥ 1; chưa chứng minh mapping trên mẫu. |
| 7.4 | `grep -cE 'precedence|allocation|unmatched' /d/TQD/CRM/docs/integrations/misa/payment-reconciliation-rules-v1.md` | `15`, exit 0 — PASS ≥ 3. |
| 7.5 | `grep -c '## Kết luận' /d/TQD/CRM/docs/integrations/misa/misa-coverage-v1.md` | `1`, exit 0 — PASS = 1; commit NOT RUN. |

### Việc còn chờ

Kế toán trả lời năm câu hỏi, xác nhận quyền/gói API và cung cấp mẫu đã khử nhận dạng ngoài repo để kiểm mapping. Coordinator review và commit; không coi phase hay coverage thực thu ABM đã hoàn tất.
