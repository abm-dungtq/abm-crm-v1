# Brainstorm: Admin, tài khoản và phân quyền nhân viên CRM

Ngày 2026-10-04 (Asia/Saigon). Chế độ `--advice`: có ba lượt tư vấn kongming (lựa chọn đăng nhập, go/no-go hợp đồng, giới hạn Workers).

## Quyết định của user

| Chủ đề | Quyết định |
|---|---|
| Đăng nhập web | Mật khẩu. CRM tự tạo mật khẩu tạm; lần đầu đăng nhập phải đổi. Không dùng Lark OAuth hay Cloudflare Access. |
| Người không dùng Lark | Có vài người. Họ chỉ dùng web, không có định danh chat. |
| Admin | 2 người riêng. Admin không xem dữ liệu kinh doanh (giữ đúng ma trận quyền). |
| Danh sách nhân viên | File xuất từ Lark đã có cột phòng ban, nhóm, vai trò. |
| Giao mật khẩu tạm | Màn hình Admin hiện đúng một lần; Admin tự đưa cho nhân viên. Agent AI không bao giờ thấy mật khẩu. |
| Khớp Lark ↔ CRM | Tự động theo email qua Lark contact API (email → open_id). User cấp thêm scope đọc ID người dùng và phạm vi danh bạ toàn công ty. |
| Gói Cloudflare | Giữ gói miễn phí. |
| Mức bảo mật mật khẩu | Vừa phải, vì sản phẩm dùng nội bộ. |

## Hợp đồng

**Outcome**
1. Đăng nhập web bằng email + mật khẩu; bắt buộc đổi mật khẩu tạm; phiên đăng nhập và đăng xuất.
2. Màn hình Admin: nhập file nhân viên (xem trước, kiểm lỗi, cập nhật theo email, chạy lại không tạo trùng); sửa vai trò, phòng ban, nhóm; khóa/mở; cấp lại mật khẩu tạm; xem trạng thái liên kết Lark; liên kết lại thủ công.
3. Liên kết Lark: CRM gọi Lark API đổi email thành `open_id`, lưu cùng trạng thái `linked`, `unmatched`, `ambiguous` hoặc `error`.
4. Định danh chat: credential MCP riêng cho từng người đã liên kết; khóa tài khoản thì thu hồi phiên web và credential chat. Phần này phụ thuộc phase 06 (cơ chế 1 của ADR-004) và **tách thành bước sau**, không nằm trong nghiệm thu đợt đầu.

**Constraints**
- Mức bảo mật mật khẩu vừa phải: user xác nhận sản phẩm dùng nội bộ, không cần bảo mật mật khẩu quá cao (12:50). Chỉ giữ mức tối thiểu:
  - Vẫn băm mật khẩu (PBKDF2-SHA256 qua WebCrypto, salt riêng, số vòng vừa giới hạn CPU của gói miễn phí, lưu số vòng theo dòng). Lý do: nhân viên hay dùng lại mật khẩu ở nơi khác, nên không lưu chữ thô; chi phí thêm rất nhỏ.
  - Mật khẩu tối thiểu 8 ký tự; khóa 5 phút sau 10 lần sai liên tiếp.
- Cookie phiên HttpOnly, Secure, SameSite=Lax, có bảng phiên phía server; phiên sống 7 ngày. Đổi mật khẩu hoặc bị khóa thì thu hồi mọi phiên. Mọi lệnh ghi kiểm header Origin.
- Mật khẩu tạm dùng một lần, hết hạn 48 giờ. Quá hạn thì báo "hết hạn, liên hệ Admin".
- Admin không tự khóa hay tự hạ quyền mình; không khóa được Admin hoạt động cuối cùng.
- Mọi thay đổi của Admin ghi audit qua ghi có bảo vệ ADR-003.
- Chế độ mật khẩu và `DEMO_MODE` loại trừ nhau; `DEMO_MODE` chỉ còn cho bản eval.
- Lark App Secret đặt bằng Wrangler secret, không vào repo. Backup D1 trước migration.
- Email nhập vào được chuẩn hoá chữ thường. Phòng ban hoặc nhóm chưa có trong file thì bị từ chối ở bước xem trước, không tự tạo.

**Non-goals**
Lark OAuth, SSO, quên mật khẩu tự phục vụ qua email (chỉ Admin cấp lại), đồng bộ Lark tự động hằng đêm, nhiều tổ chức, gửi mật khẩu qua bot Lark.

**Acceptance criteria**
- Có test cho: đăng nhập đúng và sai, khóa sau 10 lần sai, bắt buộc đổi mật khẩu tạm, mật khẩu tạm hết hạn, đăng xuất, thu hồi phiên khi đổi mật khẩu hoặc khi bị khóa.
- Bước xem trước khi nhập file từ chối: email trùng, thiếu email, vai trò lạ, phòng ban hoặc nhóm lạ. Nhập lại cùng file không thay đổi gì.
- Người bị khóa nhận 401 trên web.
- Tạo mật khẩu tạm chỉ trả về một lần và không có trong log hay audit.
- Đo CPU đăng nhập trên Worker đã deploy nằm trong giới hạn gói miễn phí.
- Liên kết Lark: email khớp thì `linked`, không khớp thì `unmatched`, và Admin liên kết lại được.
- Định danh chat (bước sau): năm kịch bản phase 06 PASS, và người bị khóa thì credential MCP bị từ chối.

## Trade-offs

- **Mật khẩu** (đã chọn): dùng được cho người không có Lark. Đổi lại phải tự xây phần lưu mật khẩu, khóa tài khoản, cấp lại và giao mật khẩu tạm. Điểm yếu đầu tiên: mật khẩu tạm bị dán vào chat; giảm thiểu bằng hạn 48 giờ, dùng một lần, bắt đổi.
- **Lark OAuth** (không chọn): không có mật khẩu và tự khớp `open_id`, nhưng loại người không dùng Lark.
- **Cloudflare Access OTP** (không chọn): không phải viết mã đăng nhập, nhưng tạo thêm một nơi quản lý danh tính riêng và bị giới hạn 50 chỗ.

Better approaches: Lark OAuth đã được đề xuất kèm bằng chứng (ADR-002 đã định hướng; không có mật khẩu phải giao). User chọn mật khẩu vì có nhân viên không dùng Lark; ghi nhận như một trade-off đã chấp nhận.

## Việc kéo theo

- Viết ADR-006 (đăng nhập bằng mật khẩu) và đánh dấu ADR-002 là superseded. Quyết định rõ `/mcp` có giữ lớp service token hay không.
- Đánh số migration mới sau `0002`: thêm cột vào `app_user` (password hash, salt, số vòng, `must_change_password`, hạn mật khẩu tạm, `lark_open_id`, `lark_link_status`) và tạo bảng `session`, bảng `login_attempt`.

## Rủi ro chính

1. Giới hạn CPU: đăng nhập chạy được ở local nhưng lỗi trên production. Cần đo trên Worker thật trước khi chốt số vòng.
2. Định danh chat phụ thuộc phase 06, chưa được chứng minh trên Lark thật.
3. Mật khẩu tạm có thể bị lộ khi Admin chuyển cho nhân viên (rủi ro còn lại đã chấp nhận).

## Câu hỏi chưa giải quyết

- File Lark xuất ra có những cột nào và tên vai trò ghi thế nào (Sale, Leader…)? Cần một file mẫu đã che dữ liệu thật để viết bước kiểm tra.
- Hai Admin cụ thể là ai, và email của họ?
