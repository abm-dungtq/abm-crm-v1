# 2026-10-05: Lập kế hoạch luồng học viên từ PRD mới

## Chuyện gì đã xảy ra

User gửi PRD "CRM bàn làm việc", viết cho trung tâm dạy học viên cá nhân. PRD này đến từ một nguồn khác: nó nhắc tới một `plan.md` không có trong repo, ghi "chỉ chạy local" và không nhắc gì tới Lark. Trong khi đó CRM hiện chạy trên Cloudflare, có bot Lark và pipeline B2B. PRD đi ngược QĐ1, QĐ4, QĐ8 và QĐ12.

## Quyết định

User chọn **bổ sung** chứ không thay thế. Cụ thể:
- Vẫn dùng Cloudflare và bot Lark.
- Học phí ghi trong CRM. Với luồng học viên, cách này thay QĐ8.
- Giữ Leader và thêm 3 vai trò: Học vụ, Giáo viên, Kế toán.
- Luồng học viên giữ khách 3 tháng.
- Bỏ người giám hộ.
- Dùng 8 nguồn lead của QĐ12.
- Có nhập học viên từ file vào hợp đồng đối tác.

Chi tiết nằm trong [báo cáo brainstorm](../reports/brainstorm-261005-1053-learner-ops-prd-upgrade.md).

## Bài học kỹ thuật

- **Dựng lại bảng có dữ liệu con trên D1/SQLite.** Mẫu `_new` rồi `RENAME` (giống migration `0004`) làm `COMMIT` lỗi khóa ngoại khi bảng cha có dòng con, kể cả khi đã bật `defer_foreign_keys`. `0004` chạy được chỉ vì `approval` không có bảng con. Trình tự an toàn là: chép ra bảng backup, xóa, tạo lại, chép vào. Test phải nạp seed **trước** migration mới để bắt lỗi này, vì migration chạy trên DB rỗng không lộ lỗi.
- **Mọi lệnh phải ghi ít nhất một dòng có version.** `runCommand` luôn gọi `tx.idempotency`, mà hàm này cần một dòng có version (dòng neo). Lệnh nào chỉ ghi bảng append-only thì phải bump version của một dòng neo.

## Kế tiếp

Kế hoạch có 7 phase, ước tính 12-13 ngày: [plan.md](../261005-1053-learner-ops-upgrade/plan.md). Chạy bằng `/ak:cook --advice`.
