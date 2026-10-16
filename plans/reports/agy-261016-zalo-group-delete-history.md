# Báo cáo: "Xoá lịch sử" cho nhóm Zalo đã rời

## Tóm tắt công việc đã thực hiện

1. **Backend (`apps/crm/src/worker/inbox/group-leave.ts`, `apps/crm/src/worker/inbox/inbox-routes.ts`)**
   - Thêm hàm `deleteLeftGroupHistory(db, media, actor, group, now)` trong `group-leave.ts`:
     - Trước khi xoá: đếm số tin nhắn của hội thoại (`messageCount`) và thu thập các khoá ảnh R2 do nhân viên tải lên từ `attachments_json` qua `keyFromCrmMediaUrl` và `ownsMediaKey(actor.organizationId, key)` (bỏ qua các link CDN `zdn`).
     - Thực thi một `db.batch` theo đúng thứ tự an toàn khoá ngoại (FK):
       1. `DELETE FROM zalo_group_member WHERE conversation_id = ?`
       2. `DELETE FROM group_schedule WHERE conversation_id = ?`
       3. `DELETE FROM lead_intake WHERE conversation_id = ?`
       4. `DELETE FROM channel_command WHERE conversation_id = ?`
       5. `DELETE FROM message WHERE conversation_id = ?`
       6. `DELETE FROM conversation WHERE id = ? AND organization_id = ? AND kind = 'group' AND left_at IS NOT NULL`
       7. Ghi `audit_log` với `command = 'inbox.deleteGroupHistory'`, `entity = 'conversation'`, `before_json = { displayName, leftAt, messageCount }`, `after_json = null`.
     - Sau khi batch thành công: xoá best-effort các đối tượng R2 qua `media.delete(keys)` (lỗi R2 không làm hỏng request).
   - Thêm route `DELETE /api/inbox/groups/:id` ngay sau `POST /groups/:id/leave` trong `inbox-routes.ts`:
     - Chỉ cho phép `MANAGER_ROLES` (`leader`, `head`, `director`, `admin`); `sale` nhận `403 FORBIDDEN` (`"Chỉ trưởng nhóm, trưởng phòng, giám đốc hoặc quản trị được xoá lịch sử nhóm"`).
     - Nhóm không thuộc tổ chức hoặc không tồn tại: `404 NOT_FOUND`.
     - Nhóm có `left_at IS NULL` (đang hoạt động hoặc đang chờ rời): `409 CONFLICT` (`"Chỉ xoá được lịch sử nhóm đã rời"`).
     - Thành công: trả `200` `ok({ id })`.

2. **Web (`apps/crm/src/web/api.ts`, `apps/crm/src/web/pages/zalo-groups.tsx`)**
   - Thêm `deleteGroupHistory(id: string)` gọi `DELETE /inbox/groups/${id}` và `canDeleteZaloGroupHistory(role, group)` kiểm tra `Boolean(group && group.leftAt && GROUP_LEAVE_ROLES.includes(role))` trong `api.ts`.
   - Trên trang chi tiết nhóm (`ZaloGroupPage` trong `zalo-groups.tsx`): hiển thị nút `btn btn-danger` `"Xoá lịch sử"` tại khu vực `page-head` khi `canDeleteZaloGroupHistory(actor.role, group)` là `true`.
   - Thêm hộp thoại xác nhận `DeleteGroupHistoryModal` với tiêu đề `"Xoá lịch sử nhóm ${name}?"`, nội dung cảnh báo vĩnh viễn, nút `"Huỷ"` và `"Xoá vĩnh viễn"` (vô hiệu hoá khi đang xử lý), hiển thị `FormError`. Khi thành công: báo toast `"Đã xoá lịch sử nhóm"`, làm mới query nhóm và hội thoại, điều hướng về `/zalo-groups`.

3. **Kiểm thử (`apps/crm/test/inbox-group-leave.test.ts`, `apps/crm/test/web-inbox.test.ts`)**
   - `inbox-group-leave.test.ts`: kiểm tra `403` với `sale`; `404` với tổ chức khác / hội thoại 1-1 / id không tồn tại; `409` với nhóm đang hoạt động và nhóm đang chờ rời; xoá thành công toàn bộ `message`, `zalo_group_member`, `group_schedule`, `channel_command`, `lead_intake` và `conversation`, ghi `audit_log` đúng cấu trúc, giữ nguyên nhóm khác (`grp-2`), xoá ảnh R2 của nhóm bị xoá và giữ nguyên ảnh nhóm khác; tin nhắn mới của cùng thread sau khi xoá tự tạo hội thoại mới.
   - `web-inbox.test.ts`: kiểm tra bảng chân trị `canDeleteZaloGroupHistory` và lời gọi `deleteGroupHistory`.

## Kết quả kiểm tra (chạy từ `apps/crm`)
- `pnpm typecheck`: **PASS** (exit 0)
- `pnpm vitest run test/inbox-group-leave.test.ts test/web-inbox.test.ts`: **PASS** (2 test files passed, 22 tests passed)
- `pnpm test`: **PASS** (44 test files passed, 1 skipped; 566 tests passed, 2 skipped)
- `pnpm build`: **PASS** (exit 0)

Status: DONE
Summary: Đã hoàn thiện API `DELETE /api/inbox/groups/:id`, hàm `deleteLeftGroupHistory` xoá toàn bộ dữ liệu nhóm đã rời cùng ảnh R2 và ghi audit, nút "Xoá lịch sử" kèm hộp thoại xác nhận trên trang chi tiết nhóm Zalo, và vượt qua toàn bộ 566 bài test.
