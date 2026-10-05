# Phase 06 — Báo cáo, dữ liệu cá nhân, bot, tài liệu

Ngày: 2026-10-05. Chưa commit.

## Kết quả kiểm

- `pnpm -F @abm/crm test` — exit 0. 24 file, 327 test, tất cả passed.
- `pnpm -F @abm/crm typecheck` — exit 0.
- `pnpm -F @abm/crm build` — exit 0.
- `findstr adr-007 docs\README.md` — 1 dòng.
- Không mở dev server, nên không kiểm trên trình duyệt. Task cấm dev server.

Log test có chữ "failed" trong tên một test cũ đang xanh (`failed keys can retry`) và chữ "failures" ở stderr của test cố ý gây lỗi D1. Dòng tổng kết là `327 passed`. Không có test nào hỏng.

## File của phase này

Thêm:

- `apps/crm/migrations/0011_privacy_requests.sql`
- `apps/crm/src/worker/privacy.ts`
- `apps/crm/src/worker/learner-reports.ts`
- `apps/crm/src/web/pages/learner-reports.tsx`
- `apps/crm/src/web/pages/privacy-requests.tsx`
- `apps/crm/test/learner-reports.test.ts`
- `apps/crm/test/privacy.test.ts`
- `docs/guides/learner-ops-user-guide.md` (44 dòng)

Sửa:

- `packages/contracts/src/index.ts` — lệnh tạo/xử lý yêu cầu và ẩn danh
- `apps/crm/src/worker/commands.ts` — gắn handler
- `apps/crm/src/worker/guarded-tx.ts`, `apps/crm/test/helpers/reset-db.ts` — bảng `privacy_request`
- `apps/crm/src/worker/index.ts` — `GET /reports/learner`, `GET /privacy`
- `apps/crm/src/worker/attendance.ts` — SQL sĩ số dùng chung
- `apps/crm/src/worker/fees.ts` — tìm khách thu tiền bỏ qua hồ sơ đã lưu trữ
- `apps/crm/src/worker/learner-queries.ts`, `apps/crm/src/worker/queries.ts` — che số điện thoại
- `apps/crm/src/worker/mcp-tools.ts`, `apps/crm/src/worker/mcp-routes.ts` — lọc tool theo vai
- `apps/crm/src/web/components/layout.tsx`, `apps/crm/src/web/router.tsx`, `apps/crm/src/web/pages/learner-detail.tsx`
- `apps/crm/src/worker/roster.ts` — alias `Tổ chức`
- `apps/crm/test/mcp-gateway.test.ts`
- `docs/README.md`, `docs/architecture/erd-v1.md`, `docs/guides/staff-roster-template.md`, `docs/security/permission-matrix-v1.md`
- `apps/crm/public/mau-danh-sach-nhan-su.csv`

## Chỗ làm khác spec, và lý do

- `attendance.ts` không nằm trong danh sách file của phase, nhưng buổi chưa điểm danh và màn điểm danh phải dùng cùng một điều kiện sĩ số. Điều kiện được tách thành hàm SQL dùng chung.
- `GET /learners/:id` bỏ lọc `archived_at` để sau khi ẩn danh vẫn mở được hồ sơ và thấy tên "Đã ẩn danh". Danh sách học viên vẫn ẩn người đã lưu trữ.
- Thêm `GET /privacy` (tối đa 500 dòng) vì màn dữ liệu cá nhân không có API thì không liệt kê được yêu cầu.
- Xuất `PRIVACY_REQUEST_KINDS` để màn hình dùng đúng nhãn.
- Thêm alias `to chuc` và `to chuc (quan ly hoc vien)` để file nhân sự ghi "Tổ chức" hoặc "Tổ chức (quản lý học viên)" nhập được. Giữ alias `hoc vu` cũ.
- Hàng quyền dữ liệu cá nhân được sửa cho khớp lệnh: sale, leader, tổ chức và kế toán được ghi yêu cầu; chỉ Admin xử lý và ẩn danh. Ô học phí của Admin đổi thành R/W. Câu đi kèm ghi BGĐ chỉ đọc học phí và chỉ Admin sửa tài khoản ngân hàng.
- Không xóa ghi chú tự do (memo, nhu cầu, ghi chú đồng ý). Đó là mặc định của controller.
- `queries.ts` và `learner-queries.ts` import lẫn nhau. Cả hai chỉ gọi hàm bên trong function. Typecheck và build đều qua.

Không đụng lỗi học phí F1–F8. Không đụng phase 07. Không commit, không deploy.
