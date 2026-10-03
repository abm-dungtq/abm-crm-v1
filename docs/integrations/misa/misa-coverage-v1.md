# MISA AMIS Kế toán — coverage v1

Ngày khảo sát: 2026-10-03. Trạng thái: CHỜ KẾ TOÁN [UNVERIFIED]. Phạm vi là đọc tài liệu công khai; chưa gọi API, chưa có kết nối ABM, chưa nhận file mẫu, không ghi MISA. Phase 07 không chặn MVP1; payment thuộc MVP2.

Contract: [QĐ8 Payment](../../decisions/business-decisions-v1.md#qđ8-payment). Quy tắc: [đối soát v1](payment-reconciliation-rules-v1.md). Nguồn API bên dưới mô tả khả năng công khai, **không xác nhận khả dụng trên tài khoản ABM**.

## Open API

| Nội dung | Bằng chứng công khai và giới hạn |
| --- | --- |
| Cấp kết nối | MISA cấp `app_id`; quản trị AMIS lấy `access_code` tại Thiết lập/Kết nối ứng dụng/API kết nối. ABM chưa xác nhận người cấp và quyền kết nối [UNVERIFIED]. [Giới thiệu](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#1-1), [FAQ](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#7-1). |
| Xác thực | `POST /api/oauth/actopen/connect`; các hàm nghiệp vụ dùng header `X-MISA-AccessToken`. Chưa thử tài khoản ABM [UNVERIFIED]. [Connect](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-1). |
| Công nợ | `POST /apir/sync/actopen/get_list_acc_obj_debt`, `data_type=0` lấy phải thu, phân trang `skip/take`, đồng bộ thay đổi bằng `last_sync_time`; `get_list_acc_obj_debt_delete` lấy công nợ đã xóa. Đây là số dư theo đối tượng, chưa chứng minh giao dịch thực thu ABM [UNVERIFIED]. [Công nợ](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-6), [công nợ xóa](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-10). |
| Đọc trạng thái thanh toán | `POST /apir/sync/actopen/request_data`, `request_data_type=1`, `list_org_refid`, trả kết quả qua callback. Loại pull được liệt kê là trạng thái thanh toán chứng từ bán hàng; chưa chứng minh liệt kê phiếu thu độc lập hay mọi khoản thu ABM [UNVERIFIED]. [Pull](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-17), [loại pull](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#3-10). |
| Chứng từ thu | Schema có `ba_deposit` và `ca_receipt`; hỗ trợ gửi đề nghị sinh chứng từ không chứng minh endpoint đọc phiếu thu. Chưa tìm thấy endpoint liệt kê toàn bộ phiếu thu trong tài liệu đã khảo sát; coverage đọc thực thu ABM chờ MISA/kế toán [UNVERIFIED]. Không gọi `save/delete`. [Save](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-2), [thu tiền gửi](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#5-12), [phiếu thu](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#5-20). |
| Callback | Đối tác cung cấp `APICallBack`; phân biệt bằng `data_type`, đối chiếu `request_id` khi pull. Tài liệu có chữ ký HMAC-SHA256 và hàm lấy kết quả khi callback lỗi. Không coi callback xử lý đề nghị là chứng cứ thu tiền; chưa xác minh thông báo sửa/hủy phiếu thu ABM [UNVERIFIED]. [Callback](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#6-1), [kết quả lỗi callback](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-16). |
| Giới hạn | Công nợ: `take` tối đa 100; pull: tối đa 500 `list_org_refid`. Chưa thấy quota request/giây hoặc ngày; không suy ra gọi không giới hạn. Quota ABM chờ MISA [UNVERIFIED]. [Phân trang](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-6), [pull](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#2-17). |
| Gói dịch vụ | Tài liệu hướng dẫn liên hệ MISA cấp ứng dụng, có hướng dẫn dùng thử; không nêu ma trận gói thương mại bảo đảm quyền đọc thực thu. Gói ABM bật API, phí và coverage đều chờ xác nhận [UNVERIFIED]. [Giới thiệu](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#1-1), [FAQ](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#7-1). |

## Trả lời kế toán

Coordinator sẽ chuyển bộ câu hỏi tới user/kế toán. Chưa có câu trả lời thật; không dùng câu trả lời suy đoán. Chỉ cần thông tin quyền/cột, không gửi mã kết nối hay token vào tài liệu/chat.

1. Gói AMIS hiện tại có bật Open API không? Ai có quyền cấp kết nối?
   Trả lời: Chờ kế toán [UNVERIFIED].
2. Chứng từ thu ghi tham chiếu order/hợp đồng ở trường nào?
   Trả lời: Chờ kế toán [UNVERIFIED].
3. Một phiếu thu cho nhiều hợp đồng xử lý thế nào? Thu một phần?
   Trả lời: Chờ kế toán [UNVERIFIED].
4. Khi sửa/hủy chứng từ, có lịch sử hoặc mã chứng từ mới không?
   Trả lời: Chờ kế toán [UNVERIFIED].
5. Bảng kế toán duyệt (import) có cột gì, ai duyệt, tần suất?
   Trả lời: Chờ kế toán [UNVERIFIED].

## Mẫu dữ liệu và mapping PaymentReference

**Mẫu thực tế: chưa nhận [UNVERIFIED].** Chưa có đường dẫn file ngoài repo hoặc danh sách cột do kế toán xác nhận. Bảng dưới là mapping ứng viên từ schema công khai và contract CRM, không phải mapping đã kiểm trên file ABM. Không tạo dữ liệu mẫu giả để thay chứng cứ. Khi nhận mẫu đã che tên khách/mã số thuế, giữ ngoài repo và chỉ ghi tên cột cùng kết quả đối chiếu.

Tên trường schema để đối chiếu: `refid`, `refno_finance`, `refno_management`, `account_object_id`, `currency_id`, `total_amount_oc`, `total_amount`, `refdate`, `posted_date`, `created_by`, `modified_date`, `is_posted_finance`, `is_posted_management`. [Schema thu tiền gửi](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#5-12) và [schema phiếu thu](https://actdocs.misa.vn/g1/graph/ACTOpenAPIHelp/index.html#5-20) không xác nhận các cột sẽ xuất hiện trong file/API đọc ABM [UNVERIFIED].

| PaymentReference | Mapping ứng viên / dữ liệu cần nhận | Điều kiện xác nhận |
| --- | --- | --- |
| `source` | Provenance do CRM ghi: MISA API hoặc file kế toán duyệt | Không tin nhãn nguồn tự khai trong hàng import. |
| `source_id` | `refid` nếu nguồn đọc cung cấp; file cần ID ổn định do kế toán cấp | Scope theo công ty/dữ liệu kế toán; số phiếu hiển thị không mặc nhiên duy nhất. |
| `external_txn_id` | Khóa giao dịch thực thu thống nhất giữa API và file | Chờ kế toán xác nhận khóa; không mặc nhiên coi `org_refid` chứng từ bán hàng là ID khoản thu. |
| `amount` | `total_amount_oc` ứng viên cho nguyên tệ; `total_amount` có thể là quy đổi | Xác nhận ý nghĩa, đơn vị, dấu và thuần/chi tiết; không cộng cả header và detail. |
| `currency` | `currency_id` hoặc cột tiền tệ kế toán | Mapping sang mã tiền tệ CRM được xác nhận; không tự mặc định VND. |
| `received_at` | Ngày thực thu kế toán xác nhận; đối chiếu `refdate`/`posted_date` | Không tự dùng ngày hạch toán hoặc thời điểm import làm ngày thực thu. |
| `account_ref` | `account_object_id` / mã khách kế toán → Account | Bảng mapping được xác nhận, không khớp chỉ bằng tên khách. |
| `order_ref` | Cột order/hợp đồng và bảng allocation kế toán | Chờ câu 2–3; không suy từ diễn giải tự do. |
| `confirmer` | Danh tính kế toán xác nhận trong CRM/import | `created_by` của chứng từ chưa chứng minh người duyệt thực thu. |
| `import_batch` | CRM cấp khi tiếp nhận file; giữ provenance lần nhận API riêng | Không nhận batch do chat tự cấp; liên kết được lần import và người duyệt. |
| `version` | CRM tạo phiên bản khi nội dung thay đổi; giữ định danh/revision nguồn nếu có | `modified_date` chỉ là ứng viên phát hiện đổi; chưa chứng minh lịch sử sửa/hủy. |
| `status` | Kết quả đối soát và xác nhận kế toán theo quy tắc v1 | Cờ posted không tự đồng nghĩa `confirmed` hoặc xác nhận điều kiện Order. |

Các điểm cần thử trên mẫu: khóa chung API/file, thu tiền mặt và ngân hàng, một khoản nhiều order, thu một phần, sửa/hủy hoặc thay ID, cột trạng thái, tiền tệ và người duyệt. Chỉ ghi kết quả đã quan sát; hiện tất cả chờ mẫu.

## Kết luận

Chưa xác định — chờ trả lời kế toán và xác nhận gói AMIS có Open API

Đường lui: import file kế toán xuất/duyệt sau khi xác nhận cột, khóa giao dịch, người duyệt và tần suất. Đây là phương án đã chốt ở QĐ8, chưa phải kết luận file ABM đủ dữ liệu. Chỉ chọn API khi quyền ABM và coverage thực thu/đối soát/sửa-hủy có bằng chứng; số dư công nợ hoặc trạng thái chứng từ bán hàng riêng lẻ chưa đủ.

Phase 07 giữ trạng thái chờ; dòng MISA ở exit gate ghi “chờ”. Không chặn phase 08 ngoài dòng đó; chưa triển khai payment MVP2. Commit do coordinator thực hiện sau review.
