# Kiểm kê dữ liệu mẫu trên CRM eval (abm-crm-eval), 14/10/2026

Chỉ đọc D1 remote. Bản này không in số điện thoại, token hay mật khẩu.

## Cách nhận diện dữ liệu mẫu
- Dữ liệu mẫu được nạp bằng `apps/crm/seed/load-eval-demo.mjs`, từ hai file `seed/b2b-demo.sql` và `seed/learner-demo.sql`.
- Id mẫu bắt đầu bằng `demo-`. Ngoại lệ có id cố định: `org-abm`, `dep-kd`, `team-kd1`, `team-kd2` và 7 user mẫu (`u-admin`, `u-bgd`, `u-head`, `u-hung`, `u-lan`, `u-mai`, `u-huy`). Cả 7 user này đều đã bị khóa và không còn dòng thật nào trỏ tới họ, chỉ còn 27 phiên đăng nhập.
- Script dọn có sẵn: `seed/cleanup-demo.sql`. Script xóa mọi dòng `demo-%` và các dòng con của chúng. Nó giữ nguyên user, team, conversation, message và channel.

## Số dòng chính (tổng / mẫu / thật)
| Bảng | Tổng | Mẫu | Thật |
|---|---|---|---|
| lead | 48 | 46 | 2 (L-0047, L-0048) |
| contact | 47 | 46 | 1 |
| contact_point | 94 | 92 | 2 |
| account | 21 | 21 | 0 |
| account_contact | 21 | 21 | 0 |
| activity | 158 | 154 | 4 |
| task | 41 | 39 | 2 |
| lead_step | 208 | 192 | 16 |
| audit_log | 532 | 157 | 375 |

- **Toàn bộ là mẫu:** enrollment 8, payment 4, payment_allocation 2, charge 4, course 3, product 3, class_group 4, class_session 11, class_teacher 4, attendance 6, trial_booking 3, consent 12, customer_product 7, approval 3, partner_contract 3, privacy_request 1.
- **Toàn bộ là thật:** conversation 51, message 540, lead_intake 34, channel_account 2, channel_command 84, zalo_group_member 29, zalo_oa_credential 1.

## Sau khi chạy `cleanup-demo.sql` (dự kiến)
- **Còn lại:** 1 contact, 2 lead, 4 activity, 2 task, 16 lead_step, 34 lead_intake, 51 conversation, 540 message, 17 app_user, 2 team.
- **Bộ đếm:** `lead_counter` = 49, và `fee_counter` bị xóa.
- **Nạp lại mẫu:** `load-eval-demo.mjs` sẽ không chạy lại được nữa, vì đã có dữ liệu thật.

## Khóa ngoại cần lưu ý
- Chỉ có 3 khóa xóa dây chuyền (CASCADE):
  - `zalo_oa_credential` và `zalo_staff_member` theo `channel_account`;
  - `zalo_group_member` theo `conversation`.
- Vì vậy không được xóa tay `channel_account` hoặc `conversation`.
- Các khóa ngoại khác không có cascade. Xóa sai thứ tự sẽ báo lỗi chứ không âm thầm xóa thêm dòng nào.

## Điểm cần chủ dự án quyết
1. Kim Long (`u-long`): id kiểu dữ liệu mẫu, đang khóa. Báo cáo 05/10 ghi là người thật.
2. 7 user mẫu: chỉ khóa (theo quyết định 05/10) hay xóa hẳn?
3. Dũng: DB ghi là `admin` không thuộc team, còn báo cáo 05/10 ghi "kiêm Leader".
4. Giữ `org-abm`, `dep-kd`, `team-kd1/2` không? Các mục này đang được user thật dùng.
5. Giữ [khách A] và L-0047/L-0048 (tạo từ chat ngày 14/10) không?
6. 302 dòng audit `importRoster` ngày 04/10 trỏ tới user không còn tồn tại. Chưa rõ nguyên nhân.

Status: DONE_WITH_CONCERNS
Summary: Dữ liệu mẫu nhận diện được bằng tiền tố `demo-`, và `seed/cleanup-demo.sql` xóa sạch phần này mà giữ dữ liệu thật. Còn 6 điểm cần chủ dự án quyết.
