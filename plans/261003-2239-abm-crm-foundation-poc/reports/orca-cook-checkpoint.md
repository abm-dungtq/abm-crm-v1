# Orca cook checkpoint — ABM CRM Foundation (phase 01–07)

## Run

- Coordinator/advisor: Claude Opus 5.5 (terminal Orca hiện tại). Quyền duyệt chất lượng phase và trả lời câu hỏi worker dựa trên docs đã có.
- Worker: Codex `gpt-6.1-sol`, effort `medium`, `--worktree current` (D:/TQD/CRM, nhánh main).
- Phạm vi: phase 01 → 07. Phase 08 không nằm trong lượt này.
- Run ID: (ghi sau run-create)

## Thứ tự thực thi

| Wave | Phase | Phụ thuộc | Ghi chú |
|---|---|---|---|
| 1 | 01 Khởi tạo repo | — | tuần tự |
| 2 | 02 Decision pack | 01 | Task 2.5 cần user thật duyệt |
| 3 | 03 ERD + state | 02 | Task 3.5 cần user duyệt; song song với 07 |
| 3 | 07 PoC MISA | 02 | chỉ đọc docs, không ghi MISA |
| 4 | 04 ADR + ma trận | 02, 03 | |
| 5 | 05 PoC D1 | 01, 04 | Cloudflare login/remote cần user đồng ý; song song với 06 |
| 5 | 06 PoC GoClaw | 01, 04 | backup trước; downtime do user chọn |

Tối đa 2 worker song song; file ownership tách theo thư mục.

## Project execution guide (cho worker)

- Đọc phase file được giao và `plan.md` mục "Quyết định đã chốt"; không mở lại quyết định đó.
- Không commit. Coordinator commit sau khi duyệt. Không sửa `plan.md` hay status phase khác.
- Không in secret/token/JWT/API key; dùng `[redacted]`. Không commit `.env*`, `.tokens.local`.
- Không sửa MISA, không deploy production, không đổi GoClaw khi chưa backup và chưa có user đồng ý.
- Markdown chỉ trong `plans/` hoặc `docs/`.
- Bước cần người thật (duyệt QĐ, duyệt ERD, `wrangler login`, tạo tài nguyên Cloudflare remote, thao tác GoClaw, câu trả lời kế toán): gửi Orca `ask` cho coordinator, rồi dừng ở trạng thái chờ; không tự điền.
- Failure Protocol trong phase: thay vì tự spawn kongming, gửi `ask`/escalation cho coordinator kèm lệnh và output đầy đủ.
- Kết thúc: `worker_done` với `--outcome succeeded|failed`, liệt kê file đã sửa và kết quả từng Verify.

## Trạng thái phase

| Phase | Task ID | Dispatch | Kết quả | Commit |
|---|---|---|---|---|
| 01 | | | pending | |
| 02 | | | pending | |
| 03 | | | pending | |
| 04 | | | pending | |
| 05 | | | pending | |
| 06 | | | pending | |
| 07 | | | pending | |

## Câu hỏi đang chờ user

(trống)
