# Phase 03 — ERD và state model

Task: `task_d40cea11b4bd`; dispatch: `ctx_ca258c7db70f`. Hai tài liệu đã hoàn thành, qua review coordinator và được user ABM duyệt ngày 2026-10-03. Coordinator yêu cầu worker handoff thành công; coordinator sở hữu commit và final Verify 3.5.

## Kết quả

- [ERD v1](../../docs/architecture/erd-v1.md): đủ 30 entity MVP1 được yêu cầu, cột chung ULID/timestamps, version/last_txn_id cho 27 bảng mutable, khóa/quan hệ/SQLite constraints và roadmap đủ 12 module.
- [State machines v1](../../docs/architecture/state-machines-v1.md): Lead/Deal QĐ1, Forced Next Action, approval hash/version/expiry guards và outbox unknown/manual reconciliation; mỗi lifecycle có bảng actor/condition/approval.
- Review coordinator yêu cầu bổ sung nonce guarded command; đã thực hiện và kiểm lại. Runtime D1 vẫn cần phase 05, không coi thiết kế là bằng chứng PoC.
- Không viết migration, thay dữ liệu, gọi MISA, đổi GoClaw, deploy hoặc commit. Không sửa plan.md hoặc phase khác.

## Verify

Chạy nguyên lệnh từ phase bằng Git Bash `C:/Users/ABM/AppData/Local/hermes/git/bin/bash.exe -lc`, không đổi logic hay path.

| Task | Output lần cuối | Pass condition | Kết quả |
| --- | --- | --- | --- |
| 3.1 | `DONE` | Chỉ `DONE` | PASS |
| 3.2 | `17` | ≥ 8 | PASS |
| 3.3 | `13` | ≥ 9 | PASS; có đủ 12 dòng module, regex cũng đếm header |
| 3.4 | `4` | Chính xác 4 | PASS |
| 3.5 | `1` cho approval count | `APPROVED` count = 1; git log cuối chứa `ERD v1` | Approval PASS; commit/log Verify do coordinator thực hiện sau handoff, chưa chạy bởi worker |

`git diff --check` không báo lỗi. Kiểm nội dung bổ sung: tất cả entity yêu cầu nằm trong khối Mermaid; active/intake tách biệt; Next Action không lưu deadline độc lập; stage SLA giữ ngày/giờ làm việc; Lost reason chỉ DM; actor/scope server-side; MISA là nguồn thực thu.

## Câu hỏi chưa giải quyết

Không còn câu hỏi cho user trong phase này. Coordinator cần commit và chạy final Verify 3.5 trước khi cập nhật phase hoàn tất; worker không tự sửa status pending thành completed. Retry threshold/lịch làm việc cụ thể/phòng ban/Product Master không tự điền; thuộc deliverable đã chốt trước vận hành/MVP1/MVP2.
