# Mẫu danh sách nhân sự để nhập vào CRM

File mẫu: [`apps/crm/public/mau-danh-sach-nhan-su.csv`](../../apps/crm/public/mau-danh-sach-nhan-su.csv). Sau khi triển khai, Admin cũng tải được file này từ màn hình Người dùng.

## Cách điền

1. Mở file mẫu bằng Excel. Giữ nguyên dòng tiêu đề, xóa 5 dòng ví dụ.
2. Mỗi nhân viên một dòng, gồm 5 cột:

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| Họ tên | Có | Tên hiển thị trong CRM. |
| Email | Có | Email công ty, trùng với email trong Lark để bot nhận ra người đó. Mỗi email chỉ xuất hiện một lần. |
| Phòng ban | Theo vai trò | Viết giống hệt nhau cho mọi người cùng phòng, ví dụ luôn là "Phòng Kinh doanh". |
| Nhóm | Theo vai trò | Nhóm thuộc phòng ban ở cột trước, ví dụ "Kinh doanh 1". |
| Vai trò | Có | Một trong: `Sale`, `Leader`, `Trưởng phòng`, `BGĐ`, `Admin`. |

3. Cột Phòng ban và Nhóm điền theo vai trò:

| Vai trò | Phòng ban | Nhóm |
|---|---|---|
| Sale, Leader | Bắt buộc | Bắt buộc |
| Trưởng phòng | Bắt buộc | Để trống |
| BGĐ, Admin | Để trống | Để trống |

4. Lưu lại bằng **File → Save As → CSV UTF-8 (Comma delimited)**. Nếu Excel lưu với dấu chấm phẩy thay dấu phẩy, CRM vẫn đọc được.

## Lưu ý

- Admin chỉ quản lý tài khoản và cấu hình, không xem dữ liệu khách hàng. Nên có 2 Admin. Người cần xem dữ liệu kinh doanh dùng tài khoản BGĐ riêng.
- Phòng ban hoặc nhóm chưa có trong CRM sẽ được tạo mới sau khi Admin xác nhận ở bước xem trước.
- Nhập lại cùng file không tạo trùng: CRM so theo email và chỉ cập nhật thông tin đã đổi. Người không có trong file không bị khóa tự động.
- Người không dùng Lark vẫn điền bình thường. Họ chỉ dùng CRM trên web.
- Lark tìm người theo ô **Email liên hệ** trong hồ sơ Lark của nhân viên, không theo hộp thư doanh nghiệp của Lark. Nếu CRM báo "Không tìm thấy" với một nhân viên có dùng Lark, kiểm ô Email trong hồ sơ Lark của họ có trống hoặc khác email trong file không.
- File thật chứa thông tin cá nhân: gửi riêng cho người phụ trách, không lưu vào repo.
