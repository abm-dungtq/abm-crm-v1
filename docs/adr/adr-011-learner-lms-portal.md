# ADR-011: Cổng học viên LMS dùng chung D1 với CRM

Trạng thái: accepted
Ngày: 2026-10-17

## Bối cảnh

Học viên ABM cần một trang học riêng: đăng nhập bằng email và mật khẩu do ABM cấp, xem chương trình của lớp mình theo từng phần của cẩm nang HTML, xem video ghi lại buổi Zoom. Học vụ quản lý tài khoản, quyền xem, video và nhập nhân viên doanh nghiệp vào lớp ngay trong CRM. Cẩm nang do giảng viên làm và agent (Claude Code trên máy) đăng lên. Nguồn: [brainstorm](../../plans/reports/brainstorm-261016-1503-lms-learner-portal.md), [plan](../../plans/261016-1602-lms-learner-portal/plan.md).

## Quyết định

- Hai Worker mới: `abm-lms` (trang học + API học viên) và `abm-lms-content` (chỉ phục vụ HTML cẩm nang). Cả hai dùng chung D1 `abm-crm-eval`; **chỉ `apps/crm/migrations` sở hữu schema**. LMS chỉ ghi `learner_session`, `lms_progress` và các cột đăng nhập của `learner_account`.
- Một lớp có một chương trình (`lms_program.class_id` UNIQUE). Quyền xem = ghi danh `confirmed/studying/completed` hoặc cấp tay (`lms_access` mode `grant`), trừ chặn (`block`). Hạn xem lại = buổi học cuối không huỷ + `review_days` ngày (NULL = không giới hạn). Logic nằm ở `@abm/lms-core` (`resolveAccess`), dùng chung cho cả hai app.
- Mật khẩu mặc định chung của tổ chức lưu một bản băm ở `org_setting`; `learner_account.password_hash IS NULL` nghĩa là đang dùng mật khẩu mặc định. Không bắt buộc đổi, chỉ nhắc. Sai 10 lần khoá 5 phút, trả 401 giống sai mật khẩu.
- Nội dung HTML chạy ở origin riêng, không cookie, link ký HMAC hạn 2 giờ, CSP `connect-src 'none'`, iframe sandbox không có `allow-same-origin`. Trang học và cẩm nang chỉ trao đổi mã phần qua `postMessage` (kiểm `event.source`).
- Video dùng Cloudflare Stream với `requireSignedURLs`; Worker LMS tự ký token RS256 hạn 2 giờ.
- Đăng cẩm nang qua `/api/lms-publish` bằng `agent_token` (nhãn `lms-publish`) của user Học vụ/Admin, tôn trọng công tắc tắt ghi của agent.

## Phương án đã xét

- Dùng một LMS mã nguồn mở (Moodle, Canvas…): cần máy chủ và CSDL riêng, đồng bộ tài khoản hai chiều. Loại.
- Trang học nằm trong CRM: lẫn phiên đăng nhập nhân viên và học viên. Loại.
- Băm mật khẩu riêng từng học viên khi nhập: tốn CPU gói miễn phí với file 200 người. Loại, dùng mật khẩu mặc định chung.

## Hệ quả

- Link nội dung/video đã ký không gắn với một học viên; ai có link dùng được tối đa 2 giờ.
- Token agent của bất kỳ Học vụ/Admin nào cũng đăng được cẩm nang.
- Cẩm nang có thể mở popup giữ `window.opener` (tác giả là nhân viên ABM; script cầu nối thêm `noopener` khi bấm link).
- Nhập 200 người vào lớp là một batch D1; gói Free giới hạn 50 truy vấn mỗi lần gọi và chưa rõ batch tính thế nào, cần đo trên hệ thống thật trước khi dùng file lớn.
