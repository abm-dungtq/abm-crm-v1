# Deploy luồng học viên lên eval (2026-10-05 23:2x)

## Kết quả

Code luồng học viên đã chạy trên `abm-crm-eval`. Dữ liệu cũ còn nguyên. Thanh Hằng đã chuyển sang vai trò Tổ chức. Thanh đã có tài khoản Kế toán.

Còn hai việc phải do người làm:
- cấp mật khẩu tạm cho Hằng và Thanh;
- nhập thử file 200 học viên giả.

## Thông số

| Mục | Giá trị |
|---|---|
| Commit | `1531f586d70143dfffbd54d8be6e693a7497a696` (đã push lên `origin/main`) |
| Phiên bản Worker | `be2f8e11-307e-4129-b5a2-a5f44a8c16ad` |
| Sao lưu toàn bộ D1 | `exports/abm-crm-eval-before-learner-ops-20261005-2322.sql` |
| Mốc Time Travel B0 | `0000003a-00000000-000050fb-2ce2414206bc92bceb9dbf8e7909b15a` |
| Sao lưu bảng người dùng trước khi gán vai trò | `exports/abm-crm-eval-app_user-before-new-roles-20261005-2324.sql` |
| Script gán vai trò | `exports/assign-learner-roles-20261005-2324.sql` |

Cách quay lại dữ liệu (chỉ làm khi user đồng ý):

```
pnpm exec wrangler d1 time-travel restore abm-crm-eval --bookmark=0000003a-00000000-000050fb-2ce2414206bc92bceb9dbf8e7909b15a
```

Cách quay lại code: chạy `pnpm exec wrangler rollback`.

## Kiểm tra bằng máy

**Số dòng trước và sau migration:**

| | u | l | a | t | ac | s | k | c | ap | m |
|---|---|---|---|---|---|---|---|---|---|---|
| Trước | 16 | 0 | 354 | 0 | 0 | 35 | 0 | 0 | 0 | 5 |
| Sau | 16 | 0 | 354 | 0 | 0 | 35 | 0 | 0 | 0 | 11 |

**Diễn tập trên D1 nháp `abm-crm-rehearsal`:**
- Nạp file sao lưu rồi chạy lần lượt 6 migration, tất cả exit 0.
- `foreign_key_check` không trả dòng nào, số dòng khớp như bảng trên.
- D1 nháp đã bị xóa. `wrangler.jsonc` không đổi.

**Trên eval:**
- `migrations apply` chạy đủ 0006 đến 0011.
- `foreign_key_check` không có vi phạm, cả trước và sau migration.
- `org_setting` có đúng 1 dòng `org-abm`.
- Đủ index của `app_user` và `lead`.

**Sau deploy:**
- `/api/health` trả 200.
- Đăng nhập bằng email không tồn tại trả 401.
- `/api/reports/learner` khi chưa đăng nhập trả 401.
- `/api/mcp` khi không có Bearer trả 401.

**Gán vai trò:**
- Hằng trước khi chuyển không còn lead đang mở, khách đang giữ, việc đang mở hay yêu cầu duyệt nào.
- Kết quả:
  - `thanhhangle0197@gmail.com`: `academic`, không phòng ban, không nhóm, đang hoạt động.
  - `dangthanh420@gmail.com`: `accountant`, không phòng ban, không nhóm, đang hoạt động.
- Anh Dũng và anh Đặng Tú giữ vai trò `admin`.

## Việc user cần làm

1. **Cấp mật khẩu tạm.** Đăng nhập Admin, vào **Quản trị → Người dùng**, cấp mật khẩu tạm cho Hằng và Thanh, rồi tự gửi cho hai người. Tài khoản Thanh chưa liên kết Lark; khi cần thì bấm "Liên kết Lark".
2. **Nhập thử 200 học viên.**
   - File: `exports/thu-nhap-200-hoc-vien-gia.csv`. Tên dạng `Thử 001`, số điện thoại dạng `0900000001`.
   - Tạo một doanh nghiệp và hợp đồng đối tác thử đang hiệu lực, rồi mở hợp đồng đó và nhập file.
   - Chọn sale phụ trách là người không đổi vai trò, ví dụ Hoài Thương. Không chọn Hằng.
   - Bấm xem trước, rồi xác nhận.
   - Báo lại cho agent: thành công hay lỗi, và mất bao lâu.
   - Nếu lỗi, agent hạ giới hạn xuống 100 dòng rồi deploy lại.
   - 200 học viên này nằm lại trên eval (user đã đồng ý).

## Danh sách thử theo vai trò

### Sale (ví dụ Hoài Thương)
- [ ] Tạo khách học viên nguồn `partner` mà không gắn hợp đồng. CRM phải báo lỗi.
- [ ] Tạo khách học viên có sản phẩm. Ngày hết hạn giữ khách là 3 tháng lịch. Ví dụ tạo ngày 31/1 thì hết hạn 30/4.
- [ ] Đánh dấu các bước hành trình. Không được nhảy qua bước bắt buộc. Không tick được các bước Chia lớp, Thu học phí khóa, Vào học.
- [ ] Bấm Thắng khi chưa xác nhận nhu cầu. CRM phải từ chối. Thắng được khi đã xong học thử hoặc đã bỏ qua học thử.
- [ ] Mở khách đang do sale khác giữ. Không thấy số điện thoại, không sửa được.
- [ ] Không thấy số tiền thu hay số nợ ở bất kỳ màn nào.

### Leader (Bích Phương hoặc Lâm Mai)
- [ ] Thấy khách của cả nhóm mình, có số điện thoại.
- [ ] Đổi sale cho khách trong nhóm mình được. Khách của nhóm khác thì không.

### Tổ chức (quản lý học viên): Thanh Hằng
- [ ] Sửa danh mục sản phẩm, tạo khóa, lớp, buổi học. Giờ buổi học hiển thị đúng giờ Việt Nam.
- [ ] Gán giáo viên cho lớp. Danh sách chọn có anh Dũng và anh Đặng Tú (Admin).
- [ ] Giữ chỗ cho lead đã thắng. Xác nhận chỗ chỉ được khi khách đã đồng ý mục "Quản lý ghi danh".
- [ ] Sĩ số chỉ đếm học viên đã xác nhận hoặc đang học.
- [ ] Bảo lưu bắt buộc có ngày hết hạn. Học lại thì về đúng trạng thái trước khi bảo lưu.
- [ ] Mỗi lead chỉ giữ chỗ được ở một lớp.

### Giáo viên: anh Dũng và anh Đặng Tú (Admin)
- [ ] "Lớp của tôi" hiện lớp mình dạy ở đầu danh sách.
- [ ] Điểm danh một buổi. Mặc định là "chưa điểm danh". Lần đầu có mặt hoặc đi trễ thì học viên chuyển sang "đang học" và bước "Vào học" xong.
- [ ] Mở cùng một buổi ở hai tab, lưu ở tab cũ. CRM báo tải lại, không ghi đè.
- [ ] Tạo buổi học bù cho một buổi vắng. Chỉ tạo được một buổi bù.

### Kế toán: Thanh
- [ ] Trang chủ chuyển thẳng tới Học phí.
- [ ] Tạo khoản phải thu. Nội dung chuyển khoản dạng `ABM HP000001`.
- [ ] Ghi tiền vào có đúng mã: tự phân bổ. Viết thường `abm hp000001` vẫn khớp.
- [ ] Tiền không mã thì vào hàng đợi, rồi phân bổ tay.
- [ ] Thu đủ học phí khóa thì bước "Thu học phí khóa" xong. Giảm giá ghi bằng khoản điều chỉnh âm.
- [ ] Hủy khoản, thu hồi phân bổ, chuyển khoản phải thu sang lớp mới, xem sổ tiền của học viên.
- [ ] Ghi hoàn tiền: không phân bổ được, hiện trong sổ tiền của học viên.

### Admin
- [ ] Xem báo cáo học viên đủ các khối: pipeline, sĩ số, buổi hôm nay chưa điểm danh, vắng 2 buổi liền, tuổi nợ, tiền theo ngày, giờ dạy.
- [ ] Xử lý yêu cầu xóa dữ liệu cá nhân. Chỉ ẩn tên và số điện thoại, chứng từ tiền giữ nguyên.
- [ ] Đổi sale cho khách bất kỳ.

### Bot Lark
- [ ] Hằng và Thanh hỏi bot thì chỉ dùng được `whoami`.
- [ ] Sale hỏi bot về khách do người khác giữ thì không thấy số điện thoại.
- [ ] Lead B2B và lệnh bot cũ vẫn chạy như trước.

## Câu hỏi còn mở

- Khi xóa dữ liệu cá nhân, có xóa luôn tên trong nội dung chuyển khoản và ghi chú không? Hiện tại vẫn giữ.
- Có cần ô "số tham chiếu ngân hàng" để chặn ghi trùng một lần chuyển khoản không? Hiện tại chưa có.
- Tổ chức và Kế toán có cần nút ghi yêu cầu xóa dữ liệu cá nhân trên màn hình không? API đã cho phép, nhưng chưa có nút.
