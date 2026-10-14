---
title: Đồng bộ lead từ chatbot vào CRM, thêm chương trình/khóa học cho lead
status: in_progress
created: 2026-10-14
mode: advice (Agy gemini-4-argon-high làm, Opus soát)
evidence: ../reports/debugger-261014-1434-chatbot-crm-data-audit.md
---

# Đồng bộ lead từ chatbot vào CRM

## Mục tiêu
- Tạo lead từ chatbot xong thì nhân viên thấy ngay lead đó trong Inbox.
- Một khách không bị tạo thêm lead trùng.
- Lead học viên hiện trong Danh sách lead và Pipeline.
- Mọi lead đều ghi được khách quan tâm hoặc tham gia **chương trình nào, khóa học nào**, từ khóa Free đến trả phí. Khách đóng 199k là khách của khóa 199k.

## Quyết định của chủ dự án (14/10)
- **L-0048:** đóng lead, lý do là trùng L-0047. Đã làm.
- **Khách đã có lead đang mở:** thông tin mới bot trích được ghi thành **ghi chú vào lead đó**, không tạo lead chờ mới.
- **Lead học viên:** hiện trong Danh sách lead và Pipeline.
- **32 lead chờ từ lịch sử OA:** giữ lại để duyệt.
- **Chương trình/khóa học:** không bắt buộc khi tạo lead. Bot điền sẵn nếu nhận ra (ví dụ khách đóng 199k thì chọn chương trình giá 199.000đ). Bắt buộc phải có trước khi chốt thắng lead học viên.
- **Tạo lead từ Inbox:** tự giao hội thoại cho người phụ trách lead và nhắn Lark báo cho họ.
- **Dữ liệu mẫu:** đã xóa ngày 14/10, có sao lưu trước. Giữ [khách A]/L-0047, nhóm KD1/KD2/Phòng KD và Kim Long. Đã xóa 7 tài khoản mẫu.
- **Danh mục chương trình/khóa học:** Opus nạp từ tài liệu huấn luyện chatbot v8. Nhân viên sửa sau trên CRM, quyền sửa hiện là Admin và Giáo vụ.
- **Giao diện:** theo hướng 3. Agy làm thiết kế và code giao diện.

## Mô hình dữ liệu cho chương trình/khóa học
Dùng bảng có sẵn, không tạo bảng mới:
- `product` là **chương trình**, có giá `price_vnd`; giá 0 là Free.
- `course` là **khóa học** thuộc một chương trình.
- `class_group` là lớp.

Lead có thêm hai cột không bắt buộc: `product_id` và `course_id`. Nếu có khóa học thì khóa học đó phải thuộc đúng chương trình đã chọn.

## Phase
| # | Phase | Người làm | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 1 | [Worker: chống trùng, ghi chú vào lead đang mở, chương trình/khóa học, nhận khách cũ, tự giao + Lark](phase-01-worker-lead-sync.md) | Agy | — | pending |
| 2 | [Giao diện hướng 3: khung ứng dụng và Inbox mới, thẻ khách/lead, lead học viên trong Danh sách lead/Pipeline, chọn chương trình](phase-02-web-lead-visibility.md) | Agy | 1 | pending |
| 3 | [Giao diện hướng 3: Lead, Pipeline, hồ sơ khách](phase-03-ui-leads-customers.md) | Agy | 2 | pending |
| 4 | [Giao diện hướng 3: Tổng quan, Học phí, Đào tạo, Công việc, Quản trị](phase-04-ui-operations.md) | Agy | 3 | pending |
| 5 | Deploy eval: chạy migration 0021 trên D1 remote (sao lưu trước), deploy Worker, soát trên trình duyệt | Opus | sau mỗi phase | pending |

Danh mục chương trình/khóa học đã được nạp ngày 14/10 từ bộ kiến thức chatbot v8 (KB02, KB03):
- 11 chương trình, cùng 8 khóa chuyên đề thuộc "Chương trình chuyên sâu".
- Mỗi dòng có audit, mã giao dịch `catalog-v8-20261014`.
- Các chương trình "báo giá riêng" và Offline Workshop tạm để giá 0. Nhân viên sửa lại giá ở trang Sản phẩm.

Hướng giao diện đã chốt ngày 14/10: **hướng 3**, theo `../reports/agy-261014-1440-crm-ui-redesign.md` và bản mẫu `../reports/ui-mockup-261014-inbox.html`.

## Việc vận hành ngoài code (chủ dự án)
- Lark Developer Console: thêm Lâm Mai (hoặc cả công ty) vào phần phạm vi khả dụng (Availability) của app, rồi phát hành phiên bản mới. Lỗi 230013 chỉ hết khi làm việc này.

## Ràng buộc cho người làm (Agy)
- Không commit, deploy, chạy `wrangler --remote` hay bật dev server.
- Không đụng D1 remote, VPS hay GoClaw. Không in secret hay dữ liệu khách.
- Chỉ sửa file được liệt kê trong phase. Trong cây thư mục còn việc khác chưa commit, không được revert.
- Báo cáo ghi vào `plans/reports/agy-261014-<slug>.md`, cuối báo cáo có dòng `Status:`.

## Tiêu chí nghiệm thu
1. Phân loại một lead chờ xong, khung Inbox hiện khách và lead (mã, giai đoạn, người phụ trách, chương trình), kèm đường dẫn.
2. Bấm "Cập nhật CRM" hoặc trích lại trên hội thoại có lead đang mở: không có lead chờ mới, lead đó có thêm một ghi chú.
3. Tạo lead học viên thứ hai cho khách đang có lead học viên mở thì bị chặn với mã `DUPLICATE_SUSPECTED`.
4. L-0047 hiện trong Danh sách lead và Pipeline, lọc được theo pipeline.
5. Chọn được chương trình/khóa học khi tạo hoặc sửa lead. Chốt thắng lead học viên chưa có chương trình thì bị chặn.
6. Tạo lead từ Inbox: hội thoại được giao cho người phụ trách lead, và có lệnh `send_lark` nhắn riêng cho người đó.
7. Lỗi Lark 230013 không thử lại nữa (dừng ngay ở lần đầu).
8. Tên bot trích là đại từ xưng hô ("Chị", "Sếp Tú") không được điền vào tên khách.
9. `pnpm -F @abm/crm test`, `typecheck` và `build` đều đạt.
