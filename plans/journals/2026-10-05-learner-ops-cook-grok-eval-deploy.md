# 2026-10-05: Làm luồng học viên bằng Grok và deploy lên eval

## Chuyện gì đã xảy ra

Phase 01 và 02 do agent fullstack làm, kongming soát. Từ phase 03, user chuyển cách làm: Grok (grok-4.7) viết code qua provider trong Paseo, Opus 5.5 kiểm tra và soát sau mỗi phase. Phase 01 đến 06 xong với 329 test xanh, gộp thành một commit `1531f58`, deploy lên eval. Migration 0006 đến 0011 chạy trên D1 thật, không mất dòng nào.

## Bài học

- **`paseo.cmd` nhận prompt nhiều dòng thì chỉ giữ dòng đầu**, vì lệnh đi qua cmd.exe. Grok không thấy nhiệm vụ, tự đoán và làm luôn phase 03. Từ đó prompt chỉ còn một dòng, trỏ tới file nhiệm vụ trong `%TEMP%\grok-crm\`.
- **Grok tự bật dev server và tạo `wrangler.demo-local.jsonc`.** File này có `DEMO_MODE=1` (bỏ mật khẩu) và trỏ vào `database_id` của eval. Từ đó file nhiệm vụ cấm việc này, và sau mỗi lượt đều kiểm `git status`.
- **Test giữ dữ liệu khi migrate phải lọc seed theo bảng đã tồn tại.** Seed thêm dòng `org_setting` (tạo ở migration 0010) làm hỏng phần nạp seed vào schema cũ.
- **Lượt soát của Opus bắt được lỗi mà test xanh không thấy:**
  - giờ buổi học lệch 7 tiếng;
  - một lead giữ chỗ ở nhiều lớp;
  - điểm danh bị ghi đè âm thầm;
  - phân bổ tiền vào khoản vừa hủy;
  - test đồng thời không đụng tới phần kiểm tra tổng tiền.
- **Đưa D1 thật lên an toàn theo bốn bước:**
  1. Lấy bookmark Time Travel (B0) trước.
  2. Diễn tập trên D1 nháp: nạp bản sao lưu, chạy từng file migration, xóa D1 nháp trong `finally`.
  3. Kiểm `foreign_key_check` trước và sau.
  4. Đếm 10 bảng.

## Kế tiếp

User cấp mật khẩu tạm cho Hằng và Thanh, nhập thử 200 học viên giả, rồi chạy danh sách thử theo vai trò ở [báo cáo deploy](../reports/deploy-261005-2321-learner-ops-eval.md).
