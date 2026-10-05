# ADR-007: Luồng học viên cá nhân, ba vai trò mới và học phí trong CRM

Trạng thái: accepted
Ngày: 2026-10-05
Thay QĐ8 ([business-decisions-v1](../decisions/business-decisions-v1.md)) cho luồng học viên. Luồng B2B giữ nguyên QĐ1, QĐ4, QĐ8 (với B2B) và QĐ13.

## Bối cảnh

CRM hiện chỉ có pipeline B2B. Đơn vị còn bán khóa học online cho cá nhân, cần tuyển sinh, chia lớp, điểm danh và theo dõi học phí. User chốt ngày 2026-10-05 dùng PRD mới để bổ sung luồng này, không thay B2B, và vẫn chạy trên Cloudflare Workers, D1 và bot Lark.

Nguồn:

- [PRD chức năng CRM bàn làm việc](../source-package/sources/prd-crm-ban-lam-viec-learner-ops-20261005.md)
- [Báo cáo brainstorm đã duyệt](../../plans/reports/brainstorm-261005-1053-learner-ops-prd-upgrade.md)
- [Kế hoạch triển khai](../../plans/261005-1053-learner-ops-upgrade/plan.md)

## Quyết định

- **Pipeline `learner` chạy song song B2B.** Hai pipeline dùng chung bảng `lead`, phân biệt bằng cột `pipeline` (`b2b` hoặc `learner`, mặc định `b2b`). Stage của luồng học viên: `new`, `contacted`, `qualified`, `trial_booked`, `trial_done`, `won`, `lost`, `not_fit`. Lead học viên luôn có owner nên không bao giờ ở trạng thái `queue`, và vẫn giữ Forced Next Action (QĐ13).
- **Ba vai trò mới**, mỗi người một vai: `academic` (hiển thị "Tổ chức (quản lý học viên)"), `teacher` (Giáo viên), `accountant` (Kế toán). Tuyển sinh ứng với `sale` và `leader`, chủ đơn vị ứng với `admin`. Admin được gán làm giáo viên của lớp. Ba vai trò mới không đọc lead B2B và không có công cụ ghi qua bot.
- **Giữ khách 3 tháng lịch.** Sale giữ khách được lưu trên `contact` (`owner_user_id`, `hold_started_at`, `hold_expires_at`). Hết hạn mà khách chưa có lead thắng thì khách về hồ chung, tính ngay lúc đọc, không cần cron. Luồng B2B vẫn dùng hàng chờ và để Leader giao lead.
- **Học phí ghi trong CRM** (PRD mục 9): khoản phải thu, tiền vào và phân bổ. Số dư tính từ các khoản phân bổ. Với luồng học viên, cách này thay QĐ8. MISA chỉ còn dùng để xuất hóa đơn điện tử; kế toán gõ số tham chiếu hóa đơn vào CRM. CRM không gọi cổng thanh toán và không tạo mã QR.
- **Danh mục sản phẩm, sản phẩm gắn trên khách và đồng ý theo mục đích** nằm trong bảng `product`, `customer_product` và `consent`. `consent` chỉ ghi thêm; trạng thái hiện tại là dòng mới nhất của mỗi cặp (khách, mục đích). Không lưu người giám hộ và ngày sinh (user chốt).
- **Hạ tầng:** mọi bảng có version ghi qua `GuardedTx` ([ADR-003](adr-003-d1-guarded-write-pattern.md)). Bảng chỉ ghi thêm (`consent`, `class_teacher`) được ghi cùng một dòng neo có version trong cùng batch. Mọi lệnh đi qua `runCommand` và `COMMANDS` ([ADR-005](adr-005-command-contracts.md)).

## Phương án đã xét

- Thay pipeline B2B bằng pipeline của PRD: bị loại, vì user chốt bổ sung chứ không thay.
- Chạy local như mục 23 của PRD: bị loại, CRM đã chạy trên Cloudflare.
- Giữ MISA là nguồn thực thu cho học viên: bị loại, PRD mục 9 yêu cầu sổ học phí trong CRM.
- Bảng riêng cho lead học viên: bị loại, dùng chung `lead` giữ nguyên bot, báo cáo và Forced Next Action.

## Hệ quả

- `app_user` và `lead` phải dựng lại để đổi ràng buộc CHECK. Migration chép dữ liệu ra bảng backup, xóa, tạo lại rồi chép về; mẫu `_new` rồi `RENAME` làm hỏng khóa ngoại khi bảng đã có dữ liệu con. Có test giữ dữ liệu. Phải sao lưu D1 trước khi áp lên eval.
- Mỗi lệnh phải ghi ít nhất một dòng có version, vì `runCommand` luôn ghi khóa idempotency qua dòng neo.
- Một số mục QĐ8 cho luồng học viên không còn hiệu lực. Tài liệu QĐ8 gốc không đổi; ADR này là nguồn có hiệu lực cho luồng học viên.
- Quyền chi tiết của luồng học viên nằm trong mục "Luồng học viên" của [ma trận quyền](../security/permission-matrix-v1.md).
