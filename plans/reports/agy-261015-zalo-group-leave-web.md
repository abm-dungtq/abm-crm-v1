# Báo cáo giao diện Web: Nút "Rời nhóm" cho nhóm Zalo

## Tóm tắt công việc đã thực hiện

1. **Cập nhật kiểu dữ liệu và API (`apps/crm/src/web/types.ts`, `apps/crm/src/web/api.ts`)**
   - Bổ sung `leftAt: string | null` và `leaveRequestedAt: string | null` vào `ZaloGroup`, cùng kiểu kết quả `LeaveZaloGroupResult`.
   - Thêm hàm `leaveGroup(id)` gọi `POST /api/inbox/groups/:id/leave`.
   - Bổ sung các hàm hỗ trợ trạng thái rời nhóm (`groupLeaveState`, `canLeaveZaloGroup`, `groupLeavePollMs`, `groupLeftNotice`).

2. **Nút "Rời nhóm", hộp xác nhận và trạng thái nhóm (`apps/crm/src/web/pages/zalo-groups.tsx`)**
   - Hiển thị nút "Rời nhóm" (`btn btn-danger` viền đỏ) trên trang chi tiết nhóm cho các vai trò quản lý (`leader`, `head`, `director`, `admin`), ẩn khi nhóm đã rời (`leftAt !== null`).
   - Khi `leaveRequestedAt` đã có và `leftAt` đang `null`: hiển thị nhãn `Đang rời nhóm…`, vô hiệu hoá nút "Rời nhóm" và tự động hỏi lại danh sách nhóm mỗi 5 giây cho đến khi có `leftAt` hoặc xoá `leaveRequestedAt`.
   - Hộp xác nhận `Modal` với tiêu đề `"Rời nhóm <tên nhóm>?"`, nội dung cảnh báo đầy đủ, hai nút `"Huỷ"` và `"Rời nhóm"` (danger), hiển thị lỗi qua `FormError`, báo toast `"Đã gửi yêu cầu rời nhóm"` và làm mới truy vấn khi thành công.
   - Trên danh sách nhóm (`ZaloGroupsPage`): giữ hiển thị các nhóm đã rời với dòng làm mờ (`row-muted`) và nhãn `"Đã rời"` (cùng nhãn `"Đã rời"` ở phần đầu trang chi tiết nhóm).

3. **Khoá ô nhập tin nhắn và thông báo đã rời (`apps/crm/src/web/components/inbox-thread.tsx`, `apps/crm/src/web/styles.css`)**
   - Bổ sung prop `readOnlyReason?: string | null` vào `InboxThread` để hiển thị thông báo `"Nick đã rời nhóm này lúc <thời gian>. Lịch sử tin nhắn vẫn được giữ."` ở đầu luồng tin nhắn và thay thế ô nhập tin nhắn (composer) bằng thông báo này khi nhóm đã rời.

4. **Kiểm thử (`apps/crm/test/web-inbox.test.ts`)**
   - Bổ sung test kiểm tra phân quyền vai trò được rời nhóm, trạng thái `active`/`leaving`/`left`, chu kỳ hỏi lại 5 giây khi đang rời, định dạng câu thông báo theo giờ Việt Nam và lời gọi API `leaveGroup`.

## Kết quả kiểm tra
- `pnpm -F @abm/crm typecheck`: **PASS** (exit 0)
- `pnpm -F @abm/crm build`: **PASS** (exit 0)
- `pnpm -F @abm/crm test`: **PASS** (43 test files passed, 555 tests passed, exit 0)

Status: DONE
Summary: Đã hoàn thiện nút "Rời nhóm", hộp thoại xác nhận, nhãn trạng thái "Đang rời nhóm…" / "Đã rời", tự động hỏi lại mỗi 5 giây khi đang rời và khoá ô chat kèm thông báo trên trang Nhóm Zalo. Toàn bộ typecheck, build và test đều đạt.
