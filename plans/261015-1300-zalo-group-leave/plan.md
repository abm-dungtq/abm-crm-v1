# Nút "Rời nhóm" cho nhóm Zalo

Status: deployed, chờ owner thử · Owner: Opus (giám sát) · Executors: Grok 4.7 (Worker + bridge), Gemini 4 Argon (giao diện)

## Mục tiêu
Trong trang Nhóm Zalo, quản lý bấm "Rời nhóm" thì nick Zalo cá nhân của công ty rời nhóm đó thật trên Zalo. CRM ghi nhận nhóm "Đã rời".

## Quyết định mặc định (Opus chọn, owner có thể đổi)
- **Quyền:** `MANAGER_ROLES` (leader, head, director, admin). Sale không thấy nút.
- **Xác nhận:** bắt buộc có hộp xác nhận trước khi rời.
- **Cách rời:** gọi zca-js `leaveGroup(groupId, silent=true)`.
- **Sau khi rời:**
  - Nhóm vẫn trong danh sách với nhãn "Đã rời", lịch sử giữ nguyên.
  - Bot trả lời, tin định kỳ, tóm tắt hằng ngày và mọi lệnh gửi đang chờ của nhóm đều dừng.
  - Ô chat bị khóa.
- **Vào lại:** nếu sau này có tin mới từ nhóm đó (nick được mời lại), xoá trạng thái đã rời.

## Hợp đồng giữa Worker và giao diện
- Migration `0023_zalo_group_leave.sql`: `conversation.left_at TEXT`, `conversation.leave_requested_at TEXT`.
- `POST /api/inbox/groups/:id/leave`
  - Chỉ `MANAGER_ROLES`; vai khác nhận 403. Nhóm không thuộc tổ chức nhận 404.
  - Nhóm đã rời nhận 409 `CONFLICT`.
  - Thành công trả `ok({ id, leaveRequestedAt })`.
  - Lặp lại khi đang chờ thì trả lại kết quả cũ, không tạo lệnh mới.
- Lệnh bridge `leave_zalo_group`, payload `{ threadId }`.
  - Thành công: Worker ghi `left_at`, tắt bot của nhóm, huỷ lệnh đang chờ của nhóm.
  - Thất bại hẳn: xoá `leave_requested_at` và để lại ghi chú hệ thống trong nhóm.
- Mỗi nhóm trong `GET /api/inbox/groups` có thêm `leftAt: string | null` và `leaveRequestedAt: string | null`.
- Gửi tin vào nhóm đã rời nhận 409.

## Phase
| # | Việc | Người làm | File | Trạng thái |
|---|------|-----------|------|------------|
| B | Migration, route, lệnh bridge, dừng gửi, test | Grok | `migrations/`, `src/worker/**`, `apps/zalo-bridge/**`, `packages/contracts`, test | xong 15/10 |
| W | Nút "Rời nhóm" + hộp xác nhận, nhãn "Đã rời", khoá ô chat | Gemini | `src/web/**` | xong 15/10 |
| R | Soát code, sao lưu D1, chạy migration remote, deploy, khởi động lại bridge | Opus | — | xong 15/10: typecheck, CRM 563 + bridge 114 test, build đạt; sao lưu D1 (`exports/abm-crm-eval-before-0023-20261015.sql` + bookmark time-travel); migration 0023 remote; eval bản `17fa59f3`; bridge khởi động lại |

## Bổ sung 16/10: "Xoá lịch sử" nhóm đã rời
- Owner yêu cầu xoá hẳn lịch sử nhóm đã rời (thay quyết định "giữ lịch sử" ở trên, nhưng chỉ khi quản lý bấm).
- `DELETE /api/inbox/groups/:id`: chỉ `MANAGER_ROLES`; nhóm chưa rời nhận 409. Xoá thành viên, lịch gửi, lead_intake, lệnh, tin nhắn, hội thoại trong một batch, ghi audit `inbox.deleteGroupHistory`, xoá ảnh R2 của nhân viên (best effort).
- Giao diện: nút "Xoá lịch sử" trên trang chi tiết nhóm đã rời, có hộp xác nhận "Xoá vĩnh viễn".
- Người làm: Agy Gemini; Opus soát. Typecheck, 566 test, build đạt. Sao lưu D1 `exports/abm-crm-eval-before-group-delete-20261016.sql`; deploy bản `72f531e1`.
