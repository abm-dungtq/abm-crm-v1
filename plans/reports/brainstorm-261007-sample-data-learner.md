# Brainstorm: dữ liệu mẫu cho eval (B2B cũ + luồng học viên mới)

## Yêu cầu
Tạo loạt dữ liệu mẫu mới hoặc khôi phục dữ liệu mẫu cũ, và thêm dữ liệu cho các phần học viên mới, khớp với dữ liệu cũ.

## Bằng chứng
- Eval đang trống mọi bảng nghiệp vụ (`lead_counter` = 1, `fee_counter` chưa có dòng). Có 9 nhân viên thật đang hoạt động.
- Dữ liệu B2B cũ: 22 lead, 21 doanh nghiệp, 22 liên hệ, 3 duyệt, do `seed/generate-demo-seed.mjs` sinh ra `seed/demo.sql`. `demo.sql` là dữ liệu của test nên không được đổi.
- Các bảng học viên mới (0006 đến 0011) có nhiều quy tắc suy ra: mã `HP%06d`, số dư không lưu, một ghi danh sống mỗi lead, giờ buổi học dạng UTC ISO, mỗi lệnh phải ghi dòng gốc có version.

## Hợp đồng
- **Kết quả:** eval có bộ dữ liệu mẫu đầy đủ: B2B cũ khôi phục, cộng học viên (lead học viên đủ các giai đoạn, hợp đồng đối tác, khóa, lớp, buổi học, ghi danh, điểm danh, khoản phải thu, tiền thu, phân bổ, đồng ý xử lý dữ liệu, một yêu cầu quyền riêng tư). Dữ liệu chủ sở hữu là nhân viên thật.
- **Ràng buộc:** sao lưu D1 và lấy bookmark Time Travel trước khi ghi. Chỉ ghi khi các bảng nghiệp vụ vẫn trống. Mọi dòng mẫu có id bắt đầu `demo-` để xóa sạch được. Id và tên nhân viên thật không vào repo (đọc từ file ngoài, gitignore). Dữ liệu không dùng tên, số điện thoại, email thật.
- **Không làm:** đổi `demo.sql`, đổi schema, thêm màn hình hay API mới, đụng tới mật khẩu hay phiên đăng nhập.
- **Nghiệm thu:** test mới chạy xanh và chứng minh dữ liệu mẫu qua `PRAGMA foreign_key_check`, số dư khớp tổng phân bổ, mỗi lead một ghi danh sống, các lệnh thật chạy được trên dữ liệu đó. Trên eval: số dòng khớp kế hoạch, `foreign_key_check` rỗng, các báo cáo học viên trả dữ liệu.

## Hướng chọn
Sinh dữ liệu học viên bằng chính các lệnh của ứng dụng chạy trong test (không viết tay SQL), rồi xuất các dòng ra file SQL để nạp lên eval. Lý do: mọi quy tắc suy ra được ứng dụng tự giữ, không phải chép lại bằng tay. Phần B2B cũ sinh bằng bộ sinh cũ có thời gian tương đối, gán chủ sở hữu bằng nhân viên thật.
