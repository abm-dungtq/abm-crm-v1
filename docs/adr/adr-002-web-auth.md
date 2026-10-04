# ADR-002: Xác thực web và đường MCP

Trạng thái: superseded by [ADR-006](adr-006-password-login.md) cho đăng nhập web; phần `/mcp` vẫn tham chiếu khi thiết kế xác thực GoClaw.
Ngày: 2026-10-03

## Bối cảnh

Pilot 15–50 nhân viên; Lark là danh bạ nội bộ. PoC cần đăng nhập nhanh nhưng không tin email/header do client tự gửi. Nguồn: [QĐ5/QĐ10](../decisions/business-decisions-v1.md).

## Quyết định

PoC dùng Cloudflare Access OTP email. Worker xác minh chữ ký JWT `Cf-Access-Jwt-Assertion` bằng JWKS của team domain, kiểm issuer, audience ứng dụng, expiry và thuật toán cho phép; từ claim email đã xác minh map sang `user` active. Không tự tạo user hay role từ JWT. Kiểm quyền tại core sau xác thực; không coi Access là RBAC nghiệp vụ.

Trước pilot chuyển sang Lark OAuth; spike 1 giờ kiểm Lark có tương thích Access OIDC không. Nếu tương thích dùng Access OIDC; nếu không, trình thiết kế OAuth/session và bằng chứng cho duyệt, không tự bật auth chưa kiểm. Theo [Cloudflare pricing](https://www.cloudflare.com/plans/zero-trust-services/), gói free tối đa 50 user; pilot chạm trần phải kiểm seat của toàn account trước khi onboarding.

Đường `/mcp` tách khỏi Access policy trình duyệt, có policy Service Auth riêng bảo vệ bằng Access Service Token. Không dùng policy Bypass công khai. Service token xác thực ứng dụng GoClaw, credential MCP per-user/per-group xác định actor theo [ADR-004](adr-004-chat-actor-identity.md). Worker vẫn xác minh Access assertion của service theo audience ứng dụng; token service không thay quyền nhân viên. Mỗi môi trường có application/audience/secrets riêng.

## Phương án đã xét

- Access OTP: phù hợp PoC, cần nhân viên có email nhận OTP.
- Lark OAuth hoặc Access OIDC: phù hợp pilot; cần spike và kiểm mapping danh tính.
- Better Auth: chưa cần cho nhân viên MVP1; chỉ xét khi mở đăng nhập bên ngoài.

## Hệ quả

Core xác thực user active và quyền mỗi request; thu hồi CRM user chặn ngay cả khi Access session còn sống. Từ chối JWT sai audience/issuer/hết hạn, header giả, user không liên kết và service token dùng như user. Không log JWT, service token hoặc email đầy đủ.

## Bằng chứng/PoC

Phase 06 phải chứng minh web/REST/MCP parity, mapping user, JWT negative cases và Service Auth; chưa có runtime evidence nên chưa accepted. Tham khảo [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) và [service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).
