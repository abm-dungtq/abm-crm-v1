# Brainstorm: nâng cấp CRM theo PRD "CRM bàn làm việc"

PRD đã chép vào repo: `docs/source-package/sources/prd-crm-ban-lam-viec-learner-ops-20261005.md`.

Ngày 2026-10-05. Có kongming soát (`--advice`) và kết luận GO, kèm bốn chỉnh sửa đã áp dụng vào bản này. PRD gốc là file user tải lên (`prd.md`, 204 dòng). PRD này nhắc tới một `plan.md` không có trong repo.

## Bằng chứng

- PRD mới viết cho trung tâm dạy AI cho học viên cá nhân, học online. Các chức năng gồm: hồ sơ người và đồng ý theo mục đích; danh sách khách; hành trình 8 bước cố định; giữ khách 3 tháng; sản phẩm gắn trên khách; hợp đồng đối tác có bước riêng; khóa, lớp online, buổi học; giữ chỗ, bảo lưu, chuyển lớp; học phí và hàng đợi tiền chưa khớp; điểm danh; báo cáo; yêu cầu về dữ liệu cá nhân.
- CRM hiện tại chạy Cloudflare Workers, D1 và React, có bot Lark qua GoClaw.
  - Có 5 vai trò: sale, leader, head, director, admin.
  - Pipeline B2B có 7 stage cộng Won/Lost, kèm SLA tính theo ngày làm việc (QĐ1).
  - Lead vào hàng chờ phòng ban và Leader giao cho Sale (QĐ4).
  - Có 8 nguồn đang dùng (QĐ12).
  - Theo QĐ8, MISA AMIS là nguồn thu chính thức và CRM chỉ giữ PaymentReference.
- PRD mới đi ngược QĐ1, QĐ4 và QĐ8, và ghi "chỉ chạy local". User đã chọn cách xử lý từng điểm ở phần dưới.

## Quyết định của user (2026-10-05)

| Vấn đề | Chọn |
|---|---|
| PRD thay thế hay bổ sung | **Bổ sung** luồng học viên cá nhân. Pipeline B2B, lead cũ và lệnh bot giữ nguyên. |
| Nơi chạy | **Giữ Cloudflare cùng bot Lark.** Bỏ mục 23 "chỉ chạy local" của PRD. |
| Học phí | **Ghi học phí trong CRM** theo PRD §9. Phần tiền của QĐ8 cho luồng học viên được thay, MISA chỉ còn dùng để xuất hóa đơn. Cần ghi ADR mới. |
| Vai trò | **Giữ Leader và thêm 3 vai trò:** Học vụ, Kế toán, Giáo viên. Tuyển sinh tương ứng Sale, chủ đơn vị tương ứng Admin, Leader vẫn duyệt như hiện nay. |
| Giữ khách (luồng học viên) | **Theo PRD:** sale giữ khách 3 tháng lịch, hết hạn mà chưa thắng thì khách về hồ chung để sale khác nhận. Luồng B2B giữ hàng chờ, Leader giao lead và SLA. |
| Người giám hộ dưới 16 tuổi | **Bỏ.** Không lưu ngày sinh, không bắt buộc người giám hộ. Vẫn giữ đồng ý theo từng mục đích. |
| Nguồn | **Giữ 8 nguồn đã chốt** ở QĐ12. Giữ quy tắc của PRD: nguồn Đối tác bắt buộc gắn hợp đồng đang hiệu lực, nguồn Khác bắt buộc ghi chú. |
| Nhập học viên theo đối tác | **Có:** nhập danh sách học viên từ file vào một hợp đồng đối tác. |

Các mục còn lại trong phần "Chỗ còn trống" của PRD giữ đúng như PRD đã chọn: mục 1, 2, 4, 5, 6, 7, 10 đến 22.

## Hợp đồng

**Kết quả cần đạt:** CRM eval có thêm luồng học viên cá nhân chạy song song với luồng B2B.
- Tuyển sinh tạo khách, gắn sản phẩm, đi hành trình 8 bước và giữ khách 3 tháng.
- Học vụ mở khóa, lớp và buổi học, xác nhận chỗ, bảo lưu, chuyển lớp.
- Giáo viên điểm danh lớp được giao.
- Kế toán ghi học phí, phân bổ tiền và xử lý hàng đợi tiền chưa khớp.
- Admin xem báo cáo theo PRD §11.
- Bot Lark tôn trọng các quyền mới, kể cả việc sale khác không thấy số điện thoại khi khách đang được giữ.

**Ràng buộc:**
- Dùng chung một codebase, D1 và cách ghi có kiểm soát (ADR-003).
- Sao lưu D1 trước mỗi migration.
- Giữ Cloudflare gói miễn phí.
- Không phá lead B2B, các lệnh MCP hiện có và quyền Leader.
- Mỗi người chỉ có một vai trò.
- Số tiền tính bằng đồng, kiểu số nguyên.

**Ngoài phạm vi:**
- Toàn bộ danh sách "Cố ý không có" của PRD, trừ mục "Đưa lên máy chủ" vì CRM đã chạy trên máy chủ.
- Thay pipeline B2B.
- Chạy local.
- Người giám hộ.
- Đồng bộ MISA.

**Tiêu chí nghiệm thu:**
- Mỗi mục PRD được giữ lại có test ở backend cho quyền và quy tắc. Ví dụ:
  - Ngày hết hạn giữ khách tính theo giờ Việt Nam, và rơi về ngày cuối tháng khi tháng sau thiếu ngày.
  - Không nhảy cóc qua bước bắt buộc.
  - Số học viên của lớp chỉ đếm người đã xác nhận và đang học.
  - Số dư tính từ các khoản phân bổ.
  - Giáo viên và tuyển sinh không thấy số tiền.
- Các test hiện có vẫn qua.
- Deploy eval và chạy thử được từng vai trò.

## Đánh đổi

- **Thêm luồng thay vì thay thế:** an toàn cho dữ liệu cũ và bot. Đổi lại, phải có trường loại pipeline trên lead và hai bộ quy tắc, nên ma trận quyền và test dày hơn.
- **Ghi học phí trong CRM:** PRD đầy đủ, kế toán làm trọn trong một chỗ. Đổi lại, CRM trở thành nơi ghi sổ tiền của luồng học viên, nên cần audit chặt và sao lưu đều.
- **Giữ khách 3 tháng song song với Leader giao lead:** hai quy tắc sở hữu khác nhau, phải tách rõ theo loại pipeline.

**Cách tốt hơn:** không có cách nào tốt hơn hướng user đã chọn. Kongming đề xuất làm luồng mới thay vì đổi tên stage, và đã áp dụng.

## Thứ tự gợi ý (để ak-plan quyết định)

1. Nền tảng: loại pipeline, các vai trò mới, ma trận quyền, hồ sơ người và đồng ý, danh mục sản phẩm. Ghi ADR cho học phí và vai trò.
2. Luồng tuyển sinh: danh sách khách, hành trình 8 bước, giữ khách 3 tháng và hồ chung, sản phẩm trên khách, hợp đồng đối tác cùng việc nhập file.
3. Học vụ: khóa, lớp, buổi học, giữ chỗ, bảo lưu, chuyển lớp.
4. Giáo viên: điểm danh, học bù.
5. Kế toán: khoản phải thu, ghi thu, phân bổ, hàng đợi tiền chưa khớp, nội dung chuyển khoản, số tham chiếu hóa đơn.
6. Báo cáo, yêu cầu về dữ liệu cá nhân, cập nhật công cụ cho bot.

## Rủi ro

- Phạm vi lớn so với đội nhỏ, vì phải thêm 6 khối mới. Cần chia phase và có điểm deploy eval sau mỗi phase.
- Ngân sách CPU của gói miễn phí, nhất là ở báo cáo và phần phân bổ tiền.
- Quyết định 2026-10-04 cho bot trả đủ dữ liệu cá nhân trong nhóm. Với luồng học viên, việc này phải bị giới hạn bởi quy tắc giữ khách.
