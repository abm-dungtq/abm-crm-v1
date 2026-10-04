---
title: "CRM: đăng nhập mật khẩu, Admin quản lý người dùng, liên kết Lark theo email"
description: "Thay chế độ chọn người dùng demo bằng đăng nhập mật khẩu, thêm màn hình Admin nhập danh sách nhân sự và liên kết Lark theo email, triển khai trước với dữ liệu demo."
status: in-progress
priority: P1
effort: 3-4d
branch: main
tags: [feature, auth, backend, frontend, database]
blockedBy: []
blocks: []
created: 2026-10-04
---

# Đăng nhập, Admin và phân quyền người dùng

Hợp đồng gốc: [brainstorm-261004-1246-crm-admin-user-auth.md](../reports/brainstorm-261004-1246-crm-admin-user-auth.md). Kế hoạch này viết cho executor dưới `--advice`. Mỗi phase có Failure Protocol riêng; dừng khi một bước Verify không đạt là hành vi đúng, không phải bị kẹt.

## Outcome

- Nhân viên đăng nhập web bằng email và mật khẩu. Mật khẩu tạm do CRM tạo, Admin xem đúng một lần, hết hạn sau 48 giờ; lần đầu đăng nhập bắt buộc đổi. "Dùng một lần" nghĩa là mật khẩu tạm hết hiệu lực ngay khi người dùng đổi mật khẩu thành công (đăng nhập lại bằng mật khẩu tạm trước khi đổi vẫn được, trong hạn 48 giờ).
- Admin nhập danh sách nhân sự từ file CSV (xem trước, xác nhận), sửa vai trò, phòng ban, nhóm, khóa/mở tài khoản, cấp lại mật khẩu tạm và liên kết Lark theo email.
- Bản eval (https://abm-crm-eval.ngulongyquan.workers.dev) chạy chế độ mật khẩu với **dữ liệu demo**. Danh sách nhân sự thật sẽ nhập sau, theo [mẫu](../../docs/guides/staff-roster-template.md) đã có.

## Quyết định đã chốt (không đảo lại)

Đăng nhập bằng mật khẩu, không dùng Lark OAuth hay Cloudflare Access. Có 2 Admin. Admin không xem dữ liệu kinh doanh. Khớp Lark theo email. Giữ Cloudflare gói miễn phí. Mức bảo mật mật khẩu vừa phải vì sản phẩm dùng nội bộ: mật khẩu tối thiểu 8 ký tự, khóa 5 phút sau 10 lần sai, phiên đăng nhập 7 ngày.

Khác với brainstorm: phòng ban và nhóm chưa có sẽ **được tạo mới** khi Admin xác nhận nhập file, vì file nhân sự là nguồn phòng ban/nhóm. Không tự tạo âm thầm: bước xem trước liệt kê rõ những gì sẽ tạo.

## Non-goals

Lark OAuth/SSO, tự đặt lại mật khẩu qua email, đồng bộ Lark tự động theo lịch, nhiều tổ chức, gửi mật khẩu qua bot, nhập file Excel `.xlsx` (chỉ CSV), và định danh chat qua credential MCP từng người (bước sau, phụ thuộc phase 06 của [foundation PoC](../261003-2239-abm-crm-foundation-poc/plan.md)).

## Phases

| # | Phase | Phụ thuộc | Trạng thái |
|---|---|---|---|
| 01 | [Lõi đăng nhập: schema, mật khẩu, phiên](phase-01-auth-core.md) | — | completed |
| 02 | [API Admin: nhập danh sách, quản lý người dùng](phase-02-admin-user-api.md) | 01 | completed |
| 03 | [Liên kết Lark theo email](phase-03-lark-email-link.md) | 02 | completed |
| 04 | [Giao diện: đăng nhập, đổi mật khẩu, màn hình Người dùng](phase-04-web-auth-admin-ui.md) | 02, 03 | completed |
| 05 | [Tài liệu và triển khai eval với dữ liệu demo](phase-05-docs-demo-deploy.md) | 04 | in-progress |

Các phase chạy tuần tự trên `main`, vì cùng sửa `apps/crm/src/worker/index.ts`, `env.ts` và migration.

## Acceptance criteria (toàn kế hoạch)

- `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm build` đều exit 0. Test cũ vẫn xanh.
- Có test cho: đăng nhập đúng/sai, khóa sau 10 lần sai, mật khẩu tạm hết hạn, bắt buộc đổi mật khẩu, đăng xuất, thu hồi phiên khi đổi mật khẩu hoặc bị khóa, nhập file (xem trước, lỗi, tạo, cập nhật, chạy lại không đổi gì), chặn Admin tự khóa mình, giữ ít nhất một Admin hoạt động, liên kết Lark (khớp, không khớp, lỗi).
- Mật khẩu tạm và mật khẩu thật không xuất hiện trong `audit_log`, `idempotency_key`, log Worker hay output của agent.
- Bản eval đã deploy: 20 lần đăng nhập liên tiếp đều trả 200 (không lỗi vượt CPU); người bị khóa nhận 401.

## Rủi ro

- Giới hạn CPU của gói miễn phí với PBKDF2: số vòng được chốt bằng đo trên Worker thật ở phase 05.
- Liên kết Lark cần user cấp thêm scope cho app; trước khi có scope, mọi người ở trạng thái `error` hoặc `unlinked`, không chặn đăng nhập.
- CRM phải dùng **cùng app Lark** với GoClaw (bot DungTQ_Agent), vì `open_id` khác nhau giữa các app.

## Câu hỏi chưa giải quyết

- Tên và email của 2 Admin thật (cần trước khi nhập danh sách thật, không chặn bản demo).
