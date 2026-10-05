# Brainstorm: thay nhân sự mẫu bằng nhân sự thật trên CRM eval

Ngày 2026-10-05. Có kongming soát (`--advice`), kết luận GO theo cách "khóa tài khoản mẫu rồi nhập người thật".

## Bằng chứng

- Danh bạ Lark xuất ra có 18 người, tất cả thuộc phòng "Abm Club", không có vai trò CRM. File gốc không lưu vào repo. Bản nháp CSV nằm ở `exports/danh-sach-nhan-su-abm-club-nhap.csv` (thư mục bị gitignore).
- Nhóm Lark duy nhất có phần kinh doanh là "ABM | TEAM GV - KD - SUPPORT - TRAO ĐỔI CHUNG". Không tính 2 Admin, nhóm có 8 người: Bích Phương, Hoài Thương, Hằng, Long, Tân, Lâm Mai, Quyên, Kiều Vinh.
- Dữ liệu trên eval gồm 7 tài khoản mẫu (`u-admin` đã khóa, `u-bgd`, `u-head`, `u-hung`, `u-mai`, `u-lan`, `u-huy`). Tài khoản `u-long` đã được dùng lại cho Kim Long. Có 2 Admin thật. Dữ liệu khách hàng mẫu gồm 22 lead, 21 công ty, 22 liên hệ, 76 hoạt động và 3 yêu cầu duyệt.
- Theo `scope.ts`, việc duyệt Won/Lost và đổi owner chỉ do Leader của nhóm quyết định. Theo migration `0003`, mỗi mã Lark (`lark_open_id`) chỉ gắn được với một tài khoản. Theo `admin-routes.ts:201`, đổi email sẽ xóa liên kết Lark cũ.
- Phạm vi danh bạ của app Lark hiện chỉ gồm anh Dũng, nên tra theo email chưa dùng được. Danh sách thành viên nhóm chat thì trả đủ mã Lark (open_id) của cả 18 người, và các mã này thuộc đúng app của bot.

## Quyết định của user

1. Cả 8 người trong nhóm GV-KD-SUPPORT có vai trò Sale.
2. Anh Dũng kiêm Leader.
3. Xóa sạch dữ liệu khách hàng mẫu.
4. Liên kết Lark luôn bằng mã Lark lấy từ danh sách thành viên nhóm chat.

## Hợp đồng

**Kết quả cần đạt:** trên CRM eval chỉ còn người thật và đang hoạt động, cụ thể:
- Admin "Trịnh Quang Dũng" dùng email `dungtq.ceo@gmail.com` và đã liên kết Lark.
- Admin "Đặng Tú" đã liên kết Lark.
- 8 Sale thuộc "Phòng Kinh doanh / Kinh doanh 1", đã liên kết Lark và có trạng thái chờ cấp mật khẩu tạm.
- 1 tài khoản Leader của anh Dũng trong nhóm Kinh doanh 1, dùng email cũ `xaotiensinh@gmail.com`.
- Các tài khoản mẫu bị khóa. Không còn lead, công ty, liên hệ, hoạt động, việc cần làm hay yêu cầu duyệt mẫu.

**Ràng buộc:**
- Sao lưu D1 trước mọi thay đổi.
- Chỉ khóa tài khoản mẫu, không xóa. Có nhiều khóa ngoại trỏ tới `app_user`, và nhật ký kiểm tra (audit log) phải giữ nguyên.
- Mọi thay đổi trên `app_user` đều ghi vào audit_log.
- Agent không đặt mật khẩu cho ai. Mật khẩu tạm do Admin cấp trên web.

**Ngoài phạm vi:**
- 8 người không thuộc nhóm KD (R&D, kế toán, media...).
- CRM chính thức (production).
- Sửa code.
- Sửa phạm vi danh bạ của app Lark.

**Tiêu chí nghiệm thu:**
- Truy vấn D1 cho thấy đúng 11 tài khoản đang hoạt động: 2 Admin, 1 Leader và 8 Sale.
- 10 tài khoản đã liên kết Lark. Tài khoản Leader thì không, xem phần đánh đổi bên dưới.
- Số lead, công ty, liên hệ, hoạt động, việc cần làm và yêu cầu duyệt đều bằng 0.
- Web eval vẫn đăng nhập được và trang Toàn cảnh mở được.

## Đánh đổi

- **Dũng kiêm Leader:** mỗi mã Lark chỉ gắn được một tài khoản. Mã Lark của anh Dũng sẽ gắn với tài khoản Admin, để anh vẫn có toàn quyền qua bot. Vì vậy tài khoản Leader chỉ dùng trên web, và anh sẽ không nhận tin nhắn Lark khi có yêu cầu chờ duyệt. Muốn nhận tin nhắn đó thì phải chuyển mã Lark sang tài khoản Leader, khi đó qua bot anh chỉ còn quyền Leader. Cách này dễ đổi lại về sau.
- **Ghi thẳng mã Lark vào D1:** lấy từ danh sách thành viên nhóm chat, đúng app của bot. Rủi ro gần như không có vì app trùng với GoClaw.

**Cách tốt hơn:** không có. Cách được đề xuất chính là cách user yêu cầu. Cách đổi tên tài khoản mẫu thành người thật đã bị loại, vì 76 hoạt động mẫu sẽ bị ghi dưới tên người thật.

## Cập nhật 10:40: user đổi quyết định, đã thực hiện

User bỏ phương án anh Dũng kiêm Leader và xếp lại như sau:
- Kinh doanh 1: Leader Bích Phương, Sale Hoài Thương.
- Kinh doanh 2: Leader Lâm Mai, Sale Tân và Quyên.
- Long và Vinh làm support kỹ thuật, Thanh làm kế toán, nên không có tài khoản CRM.

Đã chạy trên eval. Bản sao lưu là `exports/abm-crm-eval-before-real-staff-20261005-1045.sql`, script là `exports/real-staff-swap-20261005.sql`.

Kết quả kiểm tra lại:
- Có 7 tài khoản đang hoạt động (2 Admin, 2 Leader, 3 Sale), cả 7 đều đã liên kết Lark.
- 8 tài khoản bị khóa, gồm 7 tài khoản mẫu và Kim Long.
- Lead, công ty, liên hệ, hoạt động, việc cần làm và yêu cầu duyệt đều bằng 0.
- Có 15 dòng audit cho lần thay đổi này.
- Trang web trả về 200. Đăng nhập sai trả về 401.
