# ADR-006: Đăng nhập web bằng email và mật khẩu

Trạng thái: accepted
Ngày: 2026-10-04
Thay thế phần đăng nhập web của [ADR-002](adr-002-web-auth.md).

## Bối cảnh

CRM dùng nội bộ, người dùng là nhân viên công ty. Một số nhân viên không dùng Lark thường xuyên, nên đăng nhập bằng Lark OAuth hay Cloudflare Access OTP gây khó cho họ. User chốt mức bảo mật vừa phải cho sản phẩm nội bộ. Danh sách nhân sự được xuất từ Lark (họ tên, email, phòng ban, nhóm, vai trò) và Admin nhập vào CRM. Nguồn: [brainstorm](../../plans/reports/brainstorm-261004-1246-crm-admin-user-auth.md).

## Quyết định

- `AUTH_MODE=password` bật đăng nhập email và mật khẩu. Khi biến này có giá trị, mọi đường demo (`X-Demo-User`, `/api/demo-users`) tắt. Giá trị sai cũng tắt demo, không mở lại. `DEMO_MODE=1` chỉ dùng cho test và local khi `AUTH_MODE` trống.
- Mật khẩu băm PBKDF2-SHA256 qua WebCrypto, salt 16 byte, lưu số vòng theo từng người. Số vòng cho mật khẩu do người dùng đặt là `PASSWORD_ITERATIONS` trong `apps/crm/src/worker/password.ts`. workerd không cho quá 100 000 vòng; gói miễn phí giới hạn khoảng 10 ms CPU mỗi request, nên số vòng được đo trên Worker đã deploy.
- Mật khẩu tạm do CRM tạo: 12 ký tự ngẫu nhiên (khoảng 69 bit), hạn 48 giờ, hết hiệu lực khi người dùng đổi mật khẩu. Mật khẩu tạm băm 1 vòng (`TEMP_PASSWORD_ITERATIONS`), vì độ ngẫu nhiên đã đủ mạnh và một lần nhập danh sách có thể cấp hàng chục mật khẩu trong một request. Admin xem mật khẩu tạm một lần trên màn hình rồi tự gửi cho từng người; mật khẩu không vào audit, log hay bảng idempotency.
- Khi đang dùng mật khẩu tạm, chỉ `GET /api/me`, `POST /api/auth/change-password` và `POST /api/auth/logout` được phép; mọi API khác trả `PASSWORD_CHANGE_REQUIRED`.
- Sai mật khẩu 10 lần (đăng nhập hoặc đổi mật khẩu) khóa tài khoản 5 phút. Bộ đếm tăng trong một câu SQL nên nhiều request song song không vượt giới hạn.
- Phiên: cookie `abm_session` HttpOnly, Secure, SameSite=Lax, 7 ngày. D1 chỉ lưu SHA-256 của token trong bảng `user_session`. Đổi mật khẩu, cấp mật khẩu tạm hoặc khóa tài khoản thu hồi mọi phiên của người đó.
- Mọi POST/PATCH ở chế độ mật khẩu phải có header `Origin` trùng origin CRM.
- Admin đầu tiên nhận mật khẩu tạm bằng `apps/crm/scripts/bootstrap-admin.mjs`; script ghi mật khẩu vào file `apps/crm/.admin-bootstrap.local` (bị git ignore) và không in ra.
- Lớp xác thực `/mcp` cho GoClaw vẫn theo [ADR-004](adr-004-chat-actor-identity.md) (credential từng người), không dùng phiên web. CRM lưu `lark_open_id` lấy từ Lark theo email để bot nhận ra người nhắn; open_id chỉ đúng với app Lark của bot GoClaw.

## Phương án đã xét

- Lark OAuth: bị loại vì có nhân viên không dùng Lark và cần spike tương thích.
- Cloudflare Access OTP: bị loại vì mỗi lần đăng nhập phải nhận mã qua email và giới hạn 50 seat của gói miễn phí.
- Gửi mật khẩu tạm qua email hoặc Lark tự động: hoãn; Admin tự gửi là đủ cho số người hiện tại.

## Hệ quả

- Số vòng PBKDF2 phụ thuộc gói Cloudflare. Nâng gói thì tăng được số vòng; mật khẩu cũ vẫn dùng được vì số vòng lưu theo từng dòng.
- Admin chịu trách nhiệm cấp và gửi mật khẩu tạm; quên mật khẩu thì Admin cấp lại.
- Đăng nhập không phân biệt "email không tồn tại" và "sai mật khẩu" bằng thông báo, nhưng thời gian phản hồi và mã 423 khi bị khóa vẫn có thể lộ việc email tồn tại. Chấp nhận được với mức bảo mật nội bộ đã chốt.
- Client không phải trình duyệt (script, GoClaw) gọi API web phải gửi `Origin`.
- Bảng `user_session` chưa có việc dọn phiên hết hạn; cần thêm khi số phiên lớn.
