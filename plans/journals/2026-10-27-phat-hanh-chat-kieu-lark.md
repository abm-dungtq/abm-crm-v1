# 2026-10-27 — Phát hành chat kiểu Lark: chuỗi, chủ đề, nhóm phòng ban, tạo việc từ chat

## Chuyện gì đã xảy ra
Ngày 26/10 user thấy chat vừa phát hành chưa đúng ý, vì chưa giống Lark. Opus nghiên cứu Lark, lập plan 10 phase và nhờ advisor soát. Advisor cho đi tiếp, kèm danh sách chỗ phải sửa trong plan. User bảo "làm đi + kiểm duyệt bằng advisor rồi push code".

Các phase 01–09 do Claude `fullstack-developer` làm. Thứ tự chạy như sau:
1. Phase 01, rồi phase 02.
2. Phase 03 chạy song song với phase 06.
3. Phase 04+05 chạy song song với phase 07.
4. Phase 08+09 chạy song song với một lượt sửa lỗi sau khi soát code.

Mỗi lượt đều qua typecheck, test và build, rồi được commit riêng. Advisor soát toàn bộ phần thay đổi và cho push.

Ngày 27/10 Opus làm phần phát hành: sao lưu D1, ghi lại bookmark, chạy migration 0031 lên remote, deploy bản `1e0064e6` và kiểm tra.

## Quyết định
- **Đồng bộ nhóm phòng ban khi tải danh sách chat:** chỉ chạy khi một truy vấn kiểm tra nhanh thấy dữ liệu bị lệch, và có try/catch để danh sách không bao giờ lỗi theo. Bản đầu chạy đồng bộ ở mỗi lần tải, tức 5 lệnh ghi mỗi lần, trong khi web tải lại danh sách sau mỗi tin nhắn.
- **Chuỗi trong chat riêng 1-1:** cả hai người đều theo dõi chuỗi. Nếu không, trả lời chỉ nằm trong chuỗi sẽ không đến được người kia.
- **Tạo việc từ thẻ nháp:** máy chủ kiểm lại mọi thứ, gồm nguồn trùng với nguồn lưu trong thẻ nháp, người làm nằm trong nhóm, thẻ nháp chưa bị thu hồi, và mỗi thẻ chỉ tạo việc một lần. Không tin vào nội dung agent viết ra.

## Điều rút ra
- Soát code bắt được một lỗi chi phí mà test không thấy: đồng bộ ở mỗi lần đọc. Test chỉ đếm số truy vấn, không đếm số hàng phải đọc.
- Phòng Kinh doanh chưa có ai ở vai "Trưởng phòng", nên nhóm phòng ban không có trưởng nhóm. Dữ liệu thật khác giả định trong plan.
- Trong phiên này công cụ Bash hay hỏng khi lệnh có dấu nháy, nên git phải chạy qua PowerShell. Ngoài ra lệnh `ak plan phase close` không tìm thấy plan, nên trạng thái phase phải sửa trực tiếp trong `plan.md`.

## Tiếp theo
User báo nhân viên về nhóm phòng ban, duyệt đổi prompt GoClaw nhóm (10.5), rồi kiểm live 10.6. Các bước còn lại của đợt 26/10 (7.4–7.8) vẫn đang chờ.
