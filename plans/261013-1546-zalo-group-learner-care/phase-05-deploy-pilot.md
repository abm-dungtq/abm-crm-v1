# Phase 5: Deploy và thí điểm một nhóm

Người làm: Opus. User đánh dấu người ABM và chọn nhóm thí điểm.

## Thứ tự (bắt buộc)

1. **Kiểm toàn bộ.** Opus tự chạy:
   - `pnpm -F @abm/zalo-bridge test`
   - `pnpm -F @abm/zalo-bridge typecheck`
   - `pnpm -F @abm/crm test`
   - `pnpm -F @abm/crm typecheck`
   Tất cả phải exit 0.
2. **Soát code.** Một agent Opus code-reviewer soát toàn bộ diff. Sửa hết lỗi mức cao trước khi deploy.
3. **Sao lưu D1 eval** bằng `wrangler d1 export abm-crm-eval --remote` vào thư mục backups.
4. **Migration và deploy Worker.**
   - Chạy `wrangler d1 migrations apply abm-crm-eval --remote`, rồi deploy Worker.
   - Phải deploy Worker TRƯỚC khi khởi động lại bridge. Worker cũ không hiểu sự kiện `group_members` và sẽ từ chối cả lô sự kiện.
5. **Khởi động lại bridge.**
   - Kill cây powershell của task "ABM Zalo Bridge", rồi chạy `Start-ScheduledTask`.
   - Kiểm `logs/bridge.log` có `account.reconnected` và không có `group_members_failed` lặp lại.
6. **Kiểm danh sách thành viên.** Bảng `zalo_group_member` có thành viên của nhóm.
7. **User thiết lập trong CRM:**
   - đánh dấu người ABM (gồm nick riêng của anh);
   - bật "Long trả lời trong nhóm" cho đúng một nhóm thí điểm.
8. **Thử thật trong nhóm:**
   - @tag Long → có một câu trả lời trích tin và tag người hỏi;
   - gõ "Long ơi" → có trả lời;
   - trả lời vào tin của Long → có trả lời;
   - tin thường → Long im;
   - người ABM nhắn → Long im;
   - hỏi học phí → mời nhắn riêng;
   - hỏi lịch → nhóm Lark "Test chatbot Goclaw" nhận báo, nhóm vẫn ở chế độ `ai`.
9. **Cập nhật tài liệu.**
   - `docs/integrations/goclaw-inbox-agents.md`: thêm agent nhóm và luật trả lời trong nhóm.
   - ADR-009, nếu đang ghi "bot không trả lời trong nhóm".
   - Cập nhật trạng thái trong plan.
10. **Commit.** Chỉ commit khi user bảo.

## Rollback

- Tắt công tắc bot của nhóm. Cách này tức thì và không cần deploy.
- Nếu Worker lỗi, làm theo đúng thứ tự:
  1. Dừng bridge, hoặc chạy lại bản bridge trước (`git stash` hoặc checkout commit cũ cho `apps/zalo-bridge` và `packages/contracts`).
  2. Sau đó mới chạy `wrangler rollback` cho Worker.
  - Lý do: Worker cũ trả 422 khi gặp sự kiện `group_members`. Khi đó bridge bỏ cả lô sự kiện, mất luôn tin của khách.
  - Migration chỉ thêm cột và bảng nên để nguyên.
