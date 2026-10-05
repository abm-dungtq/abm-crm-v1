# PRD chức năng — CRM bàn làm việc

Bản này để đọc và chỉ chỗ thiếu. Nó không phải hợp đồng code. Cách làm nằm ở [plan.md](./plan.md).

Đơn vị dạy AI cho cá nhân và cho người đi làm tại doanh nghiệp. Học online. Nhân viên dùng một app nội bộ trên máy local. Học viên không tự đăng nhập.

## Ai dùng

| Vai | Việc chính |
|---|---|
| Chủ đơn vị | Toàn bộ bàn làm việc, tạo nhân viên, xóa dữ liệu cá nhân |
| Tuyển sinh | Khách hàng, nguồn, hành trình, hợp đồng đối tác, chăm sóc. Đây là sale trên hồ sơ |
| Học vụ | Khóa, lớp online, chia lớp, bảo lưu, chuyển lớp, điểm danh |
| Kế toán | Học phí, chuyển khoản, hàng đợi tiền chưa khớp. Không đổi chỗ trong lớp |
| Giáo viên | Điểm danh lớp được giao. Chỉ thấy tên học viên |

Mỗi người đúng một vai. Không có vai thứ sáu. Sale trên một khách hàng là một tuyển sinh.

## 1. Vào làm

Nhân viên đăng nhập bằng email và mật khẩu do chủ đơn vị cấp. Không có trang tự đăng ký, không có quên mật khẩu tự gửi. Đổi mật khẩu thì phiên cũ hết hiệu lực.

## 2. Hồ sơ người

Một sổ người cho học viên, người giám hộ và nhân viên. Tuyển sinh tạo và sửa. Không lưu giấy tờ tùy thân, ảnh, hay số tài khoản ngân hàng.

Đồng ý theo từng mục đích: quản lý ghi danh, thu học phí, điểm danh, liên hệ marketing, dùng hình ảnh. Hai mục sau mặc định tắt. Không có dòng đồng ý nghĩa là chưa đồng ý.

Tuổi không rõ, hoặc dưới 16 theo giờ Việt Nam, thì phải có người giám hộ mới lưu hồ sơ và mới xác nhận chỗ. Marketing không được đánh "không cần đồng ý".

## 3. Danh sách khách hàng

Khách hàng là người đã có lead và chưa bị lưu trữ. Một người nhiều lead thì danh sách hiện lead mới nhất.

Ba cột luôn hiện, không nằm sau nút mở rộng: tên sale đang gắn, trạng thái, khóa học. Hồ chưa có sale thì cột sale ghi "Chưa gắn".

Trạng thái là stage của lead mới nhất, hiện bằng chữ: mới, đang liên hệ, đủ điều kiện, đã hẹn học thử, đã học thử, thắng, mất, không phù hợp.

Khóa học hiện tên khóa của các ghi danh chưa kết thúc. Chưa có ghi danh thì hiện tên sản phẩm đang gắn, để sale vẫn thấy khách đang quan tâm khóa nào.

Sale tìm được khách bằng một ô gõ tên hoặc số điện thoại, và bằng bộ lọc sale, trạng thái, khóa học. Bộ lọc khóa học dùng đúng tên đang hiện ở cột khóa học. Mặc định sale chỉ thấy khách mình đang giữ. Có thể chuyển sang hồ chung. Sale không lọc ra sổ của sale khác. Chủ đơn vị thấy mọi khách và lọc được theo từng sale.

Các cột khác vẫn có: điện thoại, nguồn, hợp đồng, ngày hết giữ.

Nguồn chỉ có bốn giá trị nhân viên tự chọn:

| Nguồn | Quy tắc |
|---|---|
| Facebook | Không gắn đối tác. App không kéo lead từ Facebook |
| Đối tác | Bắt buộc chọn một hợp đồng đào tạo đang hiệu lực |
| Sale | Không gắn đối tác |
| Khác | Bắt buộc ghi chú nguồn |

## 4. Hành trình học viên

Mỗi lead có một checklist cố định. Nhân viên không tự thêm bước. Mẫu nằm trong code. Lead cũ không đổi khi sửa mẫu.

| Bước | Bắt buộc | Ai xong việc |
|---|---|---|
| Ghi nhận | Có | Tự xong khi tạo lead |
| Liên hệ | Có | Tuyển sinh đánh dấu, lead sang đang liên hệ |
| Xác nhận nhu cầu | Có | Tuyển sinh đánh dấu, lead sang đủ điều kiện |
| Học thử | Không | Xong khi buổi học thử hoàn tất, hoặc bỏ qua kèm lý do |
| Chốt ghi danh | Có | Tự xong khi lead sang thắng |
| Chia lớp | Có | Tự xong khi học vụ xác nhận chỗ |
| Thu học phí khóa | Có | Tự xong khi các khoản học phí khóa đã thu đủ |
| Vào học | Không | Tự xong lần đầu điểm danh có mặt hoặc đi trễ |

Không nhảy cóc bước bắt buộc. Tuyển sinh không tự tick chia lớp, thu tiền, vào học.

Mỗi khách hàng có một sale. Người tạo lead là sale đó, trừ khi chủ đơn vị chỉ người khác. Mọi lead đang mở của khách hiện cùng sale.

Sale giữ khách 3 tháng lịch, tính theo giờ Việt Nam. Ngày không có trong tháng thì lấy ngày cuối tháng. Ví dụ nhận ngày 31 tháng 1 thì hết hạn ngày 30 tháng 4, cùng giờ.

Trong 3 tháng, sale khác không sửa hồ sơ và không thấy số điện thoại. Chủ đơn vị vẫn thấy, và được đổi sale. Đổi sale thì tính lại 3 tháng.

Hết hạn mà khách chưa có lead thắng thì hồ sơ trở về hồ chung. Sale khác bấm nhận. Đã thắng thì không nhả, kể cả sau 3 tháng.

## 5. Sản phẩm trên khách

Có một danh mục sản phẩm: tên, mô tả, giá đồng, còn bán hay đã tắt. Học vụ và chủ đơn vị sửa danh mục. Tuyển sinh chỉ được xem.

Trên từng khách, sale đang giữ gắn một hoặc nhiều sản phẩm còn bán. Gỡ khỏi khách thì sản phẩm biến khỏi danh sách đang gắn, nhưng dòng cũ vẫn còn trong sổ. Gắn lại được.

Gắn sản phẩm không mở lớp, không giữ chỗ, và không tạo khoản học phí. Sale khác không gắn sản phẩm khi khách còn trong 3 tháng.

Lead thắng chỉ khi đã xác nhận nhu cầu, và học thử đã xong hoặc đã bỏ qua. Có người phụ trách và có hồ sơ người. Nút giữ chỗ chỉ xuất hiện sau đó, và mới tạo ghi danh chờ. Ghi danh chờ chưa tính vào số học viên của lớp.

Lý do mất hoặc không phù hợp: giá, lịch, đối thủ, không phản hồi, không hợp, khác. Chọn khác thì phải ghi chú.

Nhật ký chăm sóc chỉ là ghi tay: cuộc gọi, gặp, tin nhắn tự gõ, ghi chú. App không gửi Zalo, SMS, email.

## 6. Hợp đồng của đối tác lớn

Đối tác lớn là một doanh nghiệp. Doanh nghiệp có thể có nhiều hợp đồng đào tạo. Mỗi hợp đồng có hành trình riêng: nhân viên tự thêm các bước, đặt tên, và đánh dấu xong trên đúng hợp đồng đó. Hợp đồng khác không dùng chung các bước này.

Hợp đồng đang soạn, đã xong, hoặc đã hủy thì không nhận học viên. Chỉ hợp đồng đang hiệu lực mới gắn được vào lead nguồn đối tác.

Doanh nghiệp không phải người trả và không đứng tên hóa đơn. Không có hoa hồng. App không lưu file hợp đồng.

Màn doanh nghiệp mở từng hợp đồng và danh sách học viên của hợp đồng đó.

## 7. Khóa và lớp online

Sản phẩm là thứ được báo giá. Khóa học chỉ để mở lớp, và mỗi khóa thuộc một sản phẩm. Lớp là một lần mở online của khóa: tên, lịch, ghi chú buổi. Không có sĩ số tối đa, không có cơ sở, không có phòng. Khóa không có giá riêng. Đổi giá sản phẩm không đổi khoản đã tạo. Màn lớp chỉ đếm số học viên đã xác nhận và đang học.

Ghi chú buổi là chỗ dán link học. App không kết nối Zoom và không lưu bài giảng.

Buổi có loại thường, học thử, học bù. Hủy lớp hoặc hủy buổi là đổi trạng thái, không xóa lịch sử.

Giáo viên được gán theo lớp. Một lớp có thể nhiều giáo viên. Giáo viên chỉ mở lớp của mình.

Số học viên trên lớp đếm ghi danh đã xác nhận và đang học. Chờ, bảo lưu, đã chuyển, đã học xong, đã rút, đã hủy không cộng vào số đó. Không có mức tối đa.

## 8. Chia lớp, bảo lưu, chuyển lớp

Giữ chỗ chỉ từ lead đã thắng, đúng học viên đó. Người trả là chính học viên. Không có ô chọn người trả khác.

Xác nhận chỗ thì kiểm tra giám hộ khi tuổi yêu cầu. Lớp không có sức chứa tối đa, nên không từ chối vì đã có người. Hai học viên khác nhau cùng vào một lớp thì cả hai được nhận.

Bảo lưu bắt buộc ngày hết hạn, không còn tính vào số học viên của lớp, không xóa học phí. Hết hạn không tự mất chỗ và không tự mất tiền. Có danh sách quá hạn để người nhắc. Học lại thì về đúng trạng thái trước khi bảo lưu.

Chuyển lớp đóng ghi danh cũ, mở ghi danh mới, giữ lịch sử. Học vụ chỉ chuyển chỗ. Kế toán chuyển giá trị tiền bằng việc riêng. Phần đã thu không bị đòi thêm. Chưa có khoản thì không sinh bút toán giả.

Tuyển sinh chỉ hủy ghi danh đang chờ của lead mình phụ trách.

## 9. Học phí

Kế toán ghi học phí, tiền cọc, học liệu, điều chỉnh, hoàn tiền. Số là đồng, không có số lẻ. App không trừ tiền hộ và không gọi cổng thanh toán.

Cách ghi nhận: chuyển khoản hoặc tiền mặt. Màn hướng dẫn hiện tài khoản đơn vị, số còn lại, và nội dung chuyển khoản do server sinh. Không tạo ảnh QR, không nhập sao kê.

Tiền chưa khớp nội dung nằm trong hàng đợi. Một khoản có thể trả cho nhiều học viên. Số dư được tính từ phân bổ, không phải ô nhân viên gõ.

Học phí khóa thu đủ thì bước thu học phí của lead được đánh dấu. Chưa thu vẫn được học. Vắng mặt không đổi số nợ. Gói buổi có trong sổ nhưng điểm danh không trừ buổi.

Hóa đơn điện tử không được ký trong app. Kế toán gõ số tham chiếu khi đã xuất bên ngoài. Thu tiền không tự đánh dấu đã xuất hóa đơn.

Giáo viên và tuyển sinh không xem số tiền.

## 10. Điểm danh

Giáo viên điểm danh buổi của lớp mình: chưa điểm danh, có mặt, vắng, có phép, đi trễ. Mặc định là chưa điểm danh, không phải vắng.

Học bù là một buổi mới, nối với lần vắng. Lần vắng gốc vẫn còn.

Điểm danh không đổi học phí. Có mặt hoặc đi trễ lần đầu thì đánh dấu bước vào học.

## 11. Báo cáo và dữ liệu cá nhân

Chủ đơn vị xem: pipeline, số học viên theo lớp, chưa điểm danh hôm nay, chuỗi vắng từ hai buổi, tuổi nợ, tiền vào theo ngày, giờ dạy. Giờ dạy không phải lương. Số học viên theo lớp là số đếm, không có mức tối đa.

Tuyển sinh xem thêm đếm theo nguồn và theo hợp đồng. Học vụ không thấy tên doanh nghiệp trong báo cáo đó. Giáo viên chỉ thấy điểm danh và giờ của lớp mình, không thấy tiền, không thấy số học viên của cả trung tâm.

Nhân viên nội bộ ghi yêu cầu truy cập, sửa, rút đồng ý, hoặc xóa hồ sơ. Học viên không tự gửi. Xóa hồ sơ thì ẩn tên và số điện thoại, giữ chứng từ tiền.

## Cố ý không có trong bản này

- Trang cho học viên hoặc phụ huynh
- LMS, bài tập, điểm, chứng chỉ
- Kho bài giảng và kết nối Zoom hoặc Facebook
- Gửi Zalo, SMS, email
- Cơ sở, phòng, điểm danh sinh trắc
- Doanh nghiệp đứng ra trả tiền, hoa hồng đối tác, lương, file hợp đồng
- Cổng thẻ, SePay, PayFS, sao kê tự động, QR NAPAS
- Ký hóa đơn điện tử
- App mobile, nhiều đơn vị thuê chung một phần mềm
- Đưa lên máy chủ

## Chỗ còn trống

Những dòng dưới là chỗ bản này đang đoán, hoặc đã chọn hộ. Chúng là phần cần bạn soi.

### Đang giả định, bạn chưa chốt

1. Tiền vào chủ yếu bằng chuyển khoản tay và tiền mặt. Chưa nhập sao kê. Chưa biết tài khoản nào là tài khoản thật.
2. Hóa đơn chỉ là số kế toán gõ sau khi xuất ở chỗ khác. Chưa biết nhà cung cấp hóa đơn.
3. Học viên có thể dưới 16 tuổi. Không có ngày sinh thì vẫn đòi người giám hộ. Với lớp AI cho người đi làm, quy tắc này có thể thừa.
4. Bảo lưu không có hạn mức ngày sẵn. Nhân viên tự nhập ngày. Hết hạn không tịch thu phí.
5. Đủ năm vai ở trên. Giáo viên không thấy điện thoại. Nếu giáo viên cần số điện thoại để vào Zoom, thì bản này thiếu.
6. Không có sổ nộp sở. Chưa có cột chuyên ngành.

### Đã chọn hộ, dễ là chức năng bạn đang hình dung

7. Các bước hành trình học viên vẫn là mẫu cố định. Bạn chưa liệt kê tên bước của học viên. Bước của đối tác lớn thì đã theo từng hợp đồng.
8. Nguồn chỉ có Facebook, đối tác, sale, khác. Chưa có website, TikTok, học viên cũ giới thiệu, hội thảo, hay file Excel.
9. Không có nhập danh sách. Doanh nghiệp gửi nhiều học viên thì tuyển sinh phải tạo từng người.
10. Không gộp hồ sơ trùng số điện thoại.
11. Danh sách khách hàng chỉ hiện lead mới nhất của một người. Sale gắn trên cả khách, nên mọi lead đang mở dùng cùng một sale.
12. Không có hạn xử lý cho từng bước học viên. Mốc 3 tháng chỉ để nhả sale.
13. Hết 3 tháng không tự chuyển cho sale kế tiếp. Hồ sơ về hồ chung, sale khác phải tự nhận.
14. Hợp đồng không lưu file. Không có bảng đối soát xuất ra. Không có hoa hồng.
15. Doanh nghiệp có hợp đồng, nhưng từng học viên vẫn là người trả. Nếu công ty phải đứng tên thanh toán, bản này chưa làm.
16. Buổi học được tạo từng buổi. Không có lịch lặp theo thứ.
17. Link học chỉ là một ô chữ trên lớp hoặc trên buổi. Không có phòng Zoom riêng, không có mật khẩu buổi, không có điểm danh tự lấy từ Zoom.
18. Học thử được bỏ qua. Không bắt buộc trước khi chốt.
19. Chưa thu tiền vẫn vào lớp được. Bước thu học phí chỉ là dấu trên hành trình.
20. Chuyển lớp và chuyển tiền là hai việc, hai người. Học vụ chuyển chỗ xong, kế toán mới chuyển giá trị.
21. Gói buổi có trong sổ tiền nhưng không bị trừ khi điểm danh.
22. Nhật ký có loại "gặp", dù học online là chính.
23. App chỉ chạy local. Chưa có máy chủ, HTTPS, hay bản sao lưu.

Đánh dấu số nào là thiếu thật. Số nào giữ nguyên thì kế hoạch không đổi.
