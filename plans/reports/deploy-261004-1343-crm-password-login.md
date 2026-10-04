# Deploy eval: đăng nhập mật khẩu và quản lý người dùng

Ngày: 2026-10-04 · Worker `abm-crm-eval` · https://abm-crm-eval.ngulongyquan.workers.dev
Plan: [261004-1300-crm-admin-user-auth](../261004-1300-crm-admin-user-auth/plan.md), phase 05. User đồng ý trong chat trước khi deploy.

## Kết quả

Bản eval chạy chế độ mật khẩu (`AUTH_MODE=password`). Màn hình chọn vai trò demo đã tắt. Admin demo đăng nhập được, đổi được mật khẩu, và mọi kiểm tra nhanh đều đạt.

## Các bước

| Bước | Kết quả |
| --- | --- |
| Backup D1 trước migration | `exports/abm-crm-eval-before-0003-20261004.sql`, 22 dòng `INSERT` lead |
| Migration `0003_user_auth.sql` remote | đã áp |
| Deploy | thành công; deploy lại sau khi chỉnh giới hạn dòng (version `38b8ce67`) |
| Cấp mật khẩu tạm Admin demo (`bootstrap-admin.mjs --remote`) | thành công sau một lần sửa (xem dưới) |
| Đổi mật khẩu Admin demo | 200, 305 ms |
| 20 lần đăng nhập liên tiếp | 20/20 trả 200, trung bình 211 ms |

## Đo giới hạn gói miễn phí

- PBKDF2 giữ **50 000 vòng**: đổi mật khẩu (đường nặng nhất) và đăng nhập đều không vượt CPU.
- Nhập danh sách: xem trước 100 và 200 dòng đều 200; commit 100 dòng (284 ms) và 200 dòng (397 ms) đều 200, kèm cấp mật khẩu tạm. `ROSTER_MAX_ROWS` hạ từ 1000 xuống **200** (mức đã đo); file lớn hơn chia làm nhiều lần.
- 300 tài khoản thử (`@cpu-test.example`) đã bị khóa, xóa mật khẩu rồi xóa hẳn sau khi backup `exports/abm-crm-eval-before-cpu-test-cleanup-20261004.sql`. Các tài khoản này chưa từng đăng nhập. Bảng `app_user` trở về 8 người; audit của lần nhập thử vẫn giữ.

## Kiểm tra nhanh

`GET /` 200 · `/api/auth/mode` = `password` · `/api/demo-users` 403 · `/api/leads` không cookie 401 · header `X-Demo-User` không cookie 401. Với Sale demo Đỗ Ngọc Lan: Admin cấp mật khẩu tạm 200 → đăng nhập 200 → Admin khóa 200 → đăng nhập 401 → Admin mở lại 200.

## Sự cố và cách sửa

`bootstrap-admin.mjs --remote` báo không tìm thấy Admin dù câu lệnh UPDATE đã chạy. Nguyên nhân đã kiểm: với D1 remote, `wrangler d1 execute --file` chạy dạng import và chỉ trả thống kê, không trả dòng kết quả. Script đổi bước kiểm sang `--command`; chạy lại thành công.

## Việc còn chờ

- Kiểm giao diện bằng trình duyệt trên eval (đăng nhập, màn hình Người dùng, đăng xuất): chưa làm, cần user chọn trình duyệt Chrome cho phiên làm việc.
- User tự đặt `LARK_APP_ID`, `LARK_APP_SECRET` bằng `npx wrangler secret put` và bật quyền tra ID theo email cho app Lark.
- User đăng nhập Admin demo, nhập `apps/crm/seed/demo-roster.csv` (kỳ vọng 11 người), bấm "Liên kết Lark cho mọi người".
- Thêm tài khoản Admin thật qua màn hình Người dùng; Admin thật thứ hai chưa có tên.
- Mật khẩu Admin demo nằm trong `apps/crm/.admin-bootstrap.local` (git ignore). Xóa file sau khi user lưu mật khẩu ở nơi riêng.
- Code chưa commit.
