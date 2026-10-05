# Kongming soát kế hoạch luồng học viên

Ngày 2026-10-05. Kế hoạch được soát: [plan.md](../261005-1053-learner-ops-upgrade/plan.md).

Kết luận: **GO, sau khi sửa.** Mọi điểm dưới đây đã được sửa vào các file phase.

**Lỗi chặn**
1. Mẫu dựng lại bảng `_new` rồi `RENAME` (giống `0004`) làm hỏng khóa ngoại khi bảng có dữ liệu con. Kongming đã chạy thử trên SQLite 3.50 với `foreign_keys` và `defer_foreign_keys` cùng bật. Đã đổi sang trình tự 5 bước: chép ra bảng backup, xóa bảng, tạo lại, chép dữ liệu vào, xóa backup. Đã thêm test giữ dữ liệu ở phase 01, Task 1.2.
2. Type `GuardedTable` trong `guarded-tx.ts` chỉ nhận 6 bảng. Mỗi phase đã có thêm một bước bổ sung tên bảng mới của mình vào type này.
3. `runCommand` luôn gọi `tx.idempotency`. Hàm này dùng `insertDependent`, mà `insertDependent` cần sẵn một dòng có version. Đã ghi quy tắc "dòng neo" và chỉ rõ dòng neo cho từng lệnh: `recordConsent`, `revokeAllocation`, `moveEnrollmentCharges`, `allocatePayment`.

**Sửa lớn**
- Phase 04 và 05 sửa chung nhiều file, nên đổi sang chạy tuần tự.
- Điều kiện `tx.assert` dùng `COALESCE(SUM(...),0)` và phải đặt sau các câu `INSERT`. Hoàn tiền chỉ ghi lại, không bao giờ phân bổ.
- `updateUserInput` và `admin-users.tsx` được sửa để nhận đủ 8 vai trò.
- Các bước Verify có điều kiện không kiểm được bằng máy đã được thay: Task 1.2, 1.8 và 7.3.
- Ghi rõ trong `plan.md` rằng quy tắc "nguồn Khác bắt buộc ghi chú" không áp dụng, vì QĐ12 không có nguồn "Khác".
- Đã thêm test cho các tình huống còn thiếu:
  - sale khác gắn sản phẩm cho khách đang được giữ;
  - Leader đổi sale của khách thuộc nhóm khác;
  - danh sách khách che số điện thoại;
  - hủy khoản phải thu khi còn phân bổ;
  - có ít nhất một trường hợp dương cho `unmarkedToday` và `debtAging`.
- Đã ghi rõ bảng nào có version và bảng nào chỉ ghi thêm.
