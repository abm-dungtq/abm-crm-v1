# Seed và config pack

Config pack versioned trong Git, tách khỏi secret và dữ liệu thật. Đây là cấu trúc dự kiến khi triển khai; không tạo seed hoặc config production trong phase tài liệu.

| Phần | Nội dung và nguồn |
| --- | --- |
| manifest | version, schemaVersion, environment, checksum; lịch sử thay đổi |
| branding | Tên, màu, asset reference đã duyệt |
| roles/scopes | Role, capability và scope từ [ma trận](../security/permission-matrix-v1.md), deny mặc định |
| pipeline/stages/lost-reasons | Stage Definition và Lost reason QĐ1 |
| SLA/calendar | First contact 4 giờ làm việc; stage 3/7/7/5/10/7 ngày, khung 08:00–17:30 Asia/Ho_Chi_Minh; lịch ngày nghỉ chờ user |
| product-types/entitlement-types | Type/model v0 QĐ6; mẫu thật chờ trước MVP2 |
| notification-rules | Owner → Leader escalation, DM/group projection, dedupe/destination typed |
| lark-department-bindings | Nhóm Lark ↔ phòng ban/Leader, roster; danh sách thật chờ trước MVP1 |
| lead-sources | Active/inactive và manual distribution QĐ12/QĐ14; Round Robin tắt MVP1 |

Nguồn giá trị: [business decisions](../decisions/business-decisions-v1.md). Không bịa phòng ban/người/sản phẩm/lịch ngày nghỉ. Validate Zod schema từ packages/contracts, references, uniqueness, stage ordering, scope và environment trước apply; reject toàn pack nếu lỗi. Áp config có version, preview diff, quyền Admin, backup trước thay DB, audit trong batch và lưu version áp dụng để rollback có kiểm soát.

Seed chỉ dùng dữ liệu tổng hợp local/staging và namespace test, không dùng customer/email/credential thật. Seed không đồng nghĩa migration; không seed/reset production. Config rollback không tự reverse mutation nghiệp vụ hoặc khôi phục database. Xem [environments](environments.md), [deployment](deployment-baseline.md).
