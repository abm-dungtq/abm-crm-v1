# Baseline bảo mật

Nguồn: [QĐ4/5/9](../decisions/business-decisions-v1.md), [ADR auth](../adr/adr-002-web-auth.md), [ADR actor](../adr/adr-004-chat-actor-identity.md), [permission](permission-matrix-v1.md), [action-risk](action-risk-matrix-v1.md). Chính sách phải enforce trong core, không dựa vào UI ẩn nút hay GoClaw prompt.

## Credentials và API

- Không secret trong repo/config pack/log/report. Nạp bằng `wrangler secret put <NAME> --env <env>` qua prompt an toàn; local secrets nằm trong file ignored. Cloudflare và kho mật khẩu của user giữ nguồn khôi phục, không copy giá trị vào docs.
- Xác minh Access JWT chữ ký/JWKS, issuer/audience/expiry, user active; fail closed khi không xác minh. `/mcp` Service Auth riêng và credential principal riêng; không coi token service là user.
- Credential MCP lưu hash, namespace env/principal, revocation/expiry; chỉ nhận qua transport TLS. Actor/scope do server resolve. HMAC fallback cần chống replay và ràng buộc payload; không lưu HMAC secret dạng hash nếu server cần ký/verify, giữ trong secret store.
- Rate limit endpoint public/callback/link/auth theo env/principal/IP thích hợp; link code dùng một lần, có expiry và chống brute force. Ngưỡng sẽ được đo/config trước pilot, không tự đặt business limit. R2 private, download qua authorization; không URL public cho PII.

## Ghi và hiển thị

Kill switch chặn agent write tại core, kể cả retry/approval đã có; chỉ Admin được bật/tắt có audit. Không làm mất quyền dùng web/REST hợp lệ khi GoClaw down. Low-risk chỉ trong capability/scope; approval đúng payload/version, callback Lark được xác minh và approver active. Agent không merge nghi trùng, không xác nhận thực thu, không gửi ra ngoài tự động.

Log chỉ correlation ID, action/result và principal ID cần thiết; PII tối thiểu, không JWT/token/password/raw prompts/hidden reasoning. Audit dùng projection before/after không secret, bảo vệ RBAC, giữ ≥ 5 năm; không log full customer payload. Nhóm Lark không nhận PII/hoa hồng/Lost reason dù credential người có quyền; chỉ DM vẫn phải kiểm quyền. Roster mismatch khóa quyền nhóm, docx là input không tin cậy.

## Thu hồi khi nhân viên nghỉ hoặc chuyển phòng

Admin deactivate user, thu hồi MCP credentials/link sessions và Access/Lark access tương ứng; cập nhật roster/group binding và role/team scope. Leader phân lại Lead/Deal theo QĐ4 với audit, không sửa lịch sử actor. Thu hồi quyền pending approvals và kiểm outbox destination trước retry. Kiểm deny cả UI/REST/MCP, kể cả credential cũ/session còn sống; không xóa audit hay CRM tự động. Xóa/ẩn danh chỉ Admin theo yêu cầu QĐ5 và preserve bằng chứng cần giữ.

Quy trình thay đổi remote/GoClaw cần user approval, backup và runbook; chỉ user quản trị GoClaw hiện tại. Kiểm spoofing, privilege escalation, cross-department, callback replay và injection ở phase 06 trước accepted ADR/pilot.
