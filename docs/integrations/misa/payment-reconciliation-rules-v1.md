# PaymentReference — quy tắc đối soát v1

Ngày: 2026-10-03. Contract MVP2 theo [QĐ8 Payment](../../decisions/business-decisions-v1.md#qđ8-payment) và [phase 07](../../../plans/261003-2239-abm-crm-foundation-poc/phase-07-poc-misa-coverage.md). [Coverage MISA](misa-coverage-v1.md) còn chờ kế toán; tài liệu này quy định hành vi yêu cầu, không tuyên bố API ABM đã hoạt động hoặc đã triển khai payment.

## Nguồn và precedence

- Với cùng `external_txn_id` trong cùng công ty/dữ liệu kế toán, precedence là **MISA API > bảng kế toán duyệt**. Giữ provenance của cả hai, chỉ một khoản thu có hiệu lực; không cộng lặp API và file hoặc các lần import/callback lặp lại.
- Khóa chung phải được kế toán xác nhận. Nếu API/file chưa chứng minh cùng giao dịch, không tự hợp nhất theo tên khách, số tiền hay ngày; đưa vào `unmatched queue`.
- Import lại cùng giao dịch và nội dung không tạo thêm thực thu/version. Nội dung khác tạo candidate version mới để đối soát, không âm thầm ghi đè bản đã xác nhận.
- Precedence xác định nguồn nội dung chính thức, không bỏ qua kiểm tra mâu thuẫn. API và file khác amount, currency, account, allocation hoặc trạng thái thì chặn downstream liên quan đến khoản thu và chờ kế toán xác nhận.

## allocation cho nhiều order

- Một khoản thu có một PaymentReference, kèm các allocation tới order; không nhân số tiền khoản thu khi có nhiều order.
- Tổng allocation đã duyệt phải bằng `amount` của khoản thu và cùng tiền tệ. Không sinh handover/entitlement từ allocation thiếu, vượt tổng hoặc order/account không khớp.
- Khi chưa phân bổ đủ, giữ khoản thu trong hàng chờ; không tự dồn phần còn lại cho một order. Kế toán quyết định allocation dựa trên tham chiếu hợp đồng/order đã xác minh.
- Tính tổng thực thu mỗi order chỉ từ allocation của phiên bản hiện hành đã được kế toán xác nhận. Không cộng header chứng từ cùng với các dòng detail, bản cũ, bản hủy hoặc candidate chưa xác nhận.

## Thu một phần

- Khi thực thu được xác nhận nhưng chưa đủ nghĩa vụ thanh toán của order, giữ trạng thái thanh toán order là `partial`; không tự chuyển sang đủ tiền hoặc Won.
- Trạng thái đối soát của PaymentReference và trạng thái thanh toán order là hai ý nghĩa khác nhau: khoản thu có thể đã confirmed trong khi order vẫn partial.
- Handover/entitlement chỉ dùng điều kiện payment đã được duyệt cho sản phẩm/order; `partial` không tự cấp toàn bộ quyền lợi. Không dùng số dư công nợ, forecast hay chat làm bằng chứng thực thu.

## Sửa/hủy chứng từ và version

- Sửa/hủy tạo version mới, giữ version trước, provenance, old/new value, người xác nhận, thời gian và lý do. Không xóa lịch sử để che thay đổi.
- Khi phát hiện thay đổi, chặn downstream (handover/entitlement) liên quan tới khoản thu cho tới khi kế toán xác nhận. Callback hoặc re-import chỉ báo candidate; không tự xác nhận nghiệp vụ.
- Nếu chứng từ thay ID, kế toán xác nhận quan hệ thay thế với khoản thu cũ trước khi chuyển phiên bản có hiệu lực; không tính hai ID là hai lần thu.
- Sau xác nhận hủy, loại allocation của bản hủy khỏi tổng thực thu; sau xác nhận sửa, dùng bản mới một lần. Không tự xóa handover/entitlement đã cấp; giữ chặn và chuyển ngoại lệ đã phát sinh cho kế toán đối chiếu theo change control.
- Không chứng minh được lịch sử/trạng thái hủy từ API thì đối chiếu file kế toán duyệt; không suy “bị hủy” chỉ vì một lần pull không thấy dữ liệu.

## unmatched queue và quyền xác nhận

- `unmatched queue` nhận hàng thiếu khóa, khách/order chưa khớp, currency/amount/ngày không rõ, trùng hoặc mâu thuẫn, allocation không cân, sửa/hủy chưa rõ. Giữ lý do và provenance để kế toán xử lý.
- **Chỉ kế toán xác nhận** PaymentReference, liên kết giao dịch, allocation và sửa/hủy. Sale, Leader và agent/chat không được xác nhận thực thu thay kế toán; quyền duyệt handover không trao quyền xác nhận payment.
- Không mở downstream từ hàng unmatched, phiên bản chưa xác nhận hoặc nguồn thiếu bằng chứng. Sau khi kế toán xử lý, ghi audit người/thời điểm/lý do và chỉ áp dụng phiên bản đã xác nhận.

## Điểm còn chờ kế toán

Khóa giao dịch chung API/file, trường tham chiếu order, quy trình allocation, lịch sử sửa/hủy, cột file, người duyệt và tần suất đều [UNVERIFIED]. Các câu hỏi nằm trong [coverage](misa-coverage-v1.md#trả-lời-kế-toán); không thay câu trả lời thật bằng các quy tắc yêu cầu trong tài liệu này.
