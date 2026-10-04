# Orca cook checkpoint — ABM CRM Foundation (phase 01–07)

## Run

- Coordinator/advisor: Claude Opus 5.5 (terminal Orca hiện tại). Quyền duyệt chất lượng phase và trả lời câu hỏi worker dựa trên docs đã có.
- Worker: Codex `gpt-6.1-sol`, effort `medium`, `--worktree current` (D:/TQD/CRM, nhánh main).
- Phạm vi: phase 01 → 07. Phase 08 không nằm trong lượt này.
- Run ID: run_f74b66bd0da4

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

| Phase | Task ID | Kết quả | Commit |
|---|---|---|---|
| 01 | task_d17c7a265f11 | PASS | 0d2b7c7 |
| 02 | task_8327412750e8 | PASS, user duyệt 2026-10-03 | 11cfbbd |
| 03 | task_d40cea11b4bd | PASS, user duyệt 2026-10-03 | 117e461 |
| 04 | task_726794bef62a | PASS; ADR-001/005 accepted | da25460 |
| 05 | task_c9a06e2e470e | PASS remote (race 20/20, restore ~5s); ADR-003 accepted; tài nguyên PoC đã xóa | 0d847e9 |
| 06 | task_a12757e5441c | Local PASS (8 test); 6.3–6.7 live chờ user; ADR-002/004 proposed | 8889c74 |
| 07 | task_46b3e7e3a8cf | Docs PASS; kết luận chờ kế toán | eb584b9 |

Ghi chú vận hành: pnpm 12 cần `allowBuilds` cho esbuild/workerd; test dùng Vitest 4.1.11 + `@cloudflare/vitest-plugin` 1.3.6 (lệch ADR-001, cần cập nhật ADR-001). Worker Orca chết khi phiên điều phối khởi động lại; Codex có lúc chặn khởi động bằng màn hình duyệt hooks.
## Câu hỏi đang chờ user

- Phase 06 live: chọn buổi làm cùng user (backup GoClaw, nhóm Lark CRM-PoC, merge contact, credential, downtime).
- Phase 07: 5 câu hỏi kế toán trong docs/integrations/misa/misa-coverage-v1.md.
- Danh sách phòng ban/Leader (trước plan MVP1) và sản phẩm mẫu (trước MVP2).
