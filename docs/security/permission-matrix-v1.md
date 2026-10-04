# Ma trận quyền v1

Nguồn có hiệu lực: [business-decisions-v1 QĐ4/5/9/13/14](../decisions/business-decisions-v1.md), [PRD 23.1–23.2](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md). Scope MVP1 theo QĐ5 đã duyệt; bảng hiện thực dưới đây không mang dấu user approval riêng. CSKH/Triển khai/Kế toán là [PROPOSED], chốt trước plan MVP2/MVP3; deny mặc định trước khi duyệt/cấp capability. Quyền xem audit nghiệp vụ user duyệt 2026-10-04: Leader theo team, Trưởng phòng theo phòng, BGĐ toàn công ty; Sale và Admin không xem.

## Quy ước

`own` gồm record own/assigned được kiểm trên target; `team`, `department`, `org` ánh xạ scope contract organization, `none` cấm. `R` đọc projection được phép, `W` command nghiệp vụ (không đồng nghĩa delete/merge/export/duyệt); `Approve` duyệt đúng command/payload trong scope. Customer là view Contact/Account, không phải bảng mới. Ownership một Deal không tự cho xem toàn Account. Vai trò nhiều scope chỉ hợp nhất capability đã cấp, không tự nâng scope.

| Vai trò | Customer | Lead | Deal | Task | Activity | Approval | Audit | Export | Admin config |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sale | own R/W | own R/W | own R/W | own R/W | own R/W | own R/yêu cầu; Approve stage/gửi ngoài theo action-risk | none | own yêu cầu; none thực thi | none |
| Leader | team R/W | team R/W; phân/chuyển owner | team R/W | team R/W | team R/W | team R/Approve theo action-risk | team R | team yêu cầu; none thực thi | none |
| Department Head | department R/W | department R/W | department R/W | department R/W | department R/W | department R; Approve export không được cấp | department R | department R/review scope; none duyệt cuối | none |
| BGĐ | org R/W | org R/W | org R/W | org R/W | org R/W | org R/Approve export; không tự duyệt mọi action | org R | org Approve; thực thi qua service có audit | none |
| CSKH [PROPOSED] | own R | own R | own R | own R/W | own R/W | own R/yêu cầu; none Approve | none | none | none |
| Triển khai [PROPOSED] | own R | own R | own R | own R/W | own R/W | own R/yêu cầu; none Approve | none | none | none |
| Kế toán [PROPOSED] | own R reference được giao | none | own R reference được giao | own R/W | own R/W ghi đối soát | own R/yêu cầu; none Approve | none | none | none |
| Admin | org R | org R | org R | org R | org R | org R; none Approve | org R | none duyệt cuối | org R/W; role/config/kill switch |
| Agent nhóm phòng ban | department R projection | department R; W tạo intake low-risk | department R; none W tự động | department R; W nhắc/việc chưa gán người hợp lệ | department R/W low-risk không gán người | department yêu cầu; none Approve | none | none | none |
| Agent cá nhân DM | own/team/department/org R theo principal; none W customer | scope principal R/W create_lead low-risk | scope principal R; W sau approval | scope principal R/W low-risk | scope principal R/W low-risk | scope principal yêu cầu; none Approve | none | scope principal yêu cầu; none tự thực thi | none |

Agent DM không có role rộng mặc định: scope bằng capability giao cho credential và quyền nhân viên hiện tại. Nhóm fallback không tự gán user/owner; create_lead vào intake phòng ban; Next Action cho record active cần người hợp lệ, không bỏ invariant QĐ13. Credential cá nhân dùng trong nhóm vẫn áp projection nhóm. Support chỉ đọc/ghi Activity đúng assignment, không đổi stage/owner. Task W không cấp quyền đổi owner Lead/Deal.

## Bảo mật theo bề mặt

Web áp scope cá nhân/team/department/org. Nhóm Lark trả pipeline mức department đúng binding, ẩn hoa hồng, lý do Lost và dữ liệu cá nhân khách; chỉ DM cho các trường này và vẫn kiểm quyền cá nhân. Không dump Customer 360, audit, approval payload hoặc export ra nhóm; nếu renderer không thể đảm bảo projection thì chuyển DM. Roster không hợp lệ thì chặn nhóm.

## Critical permissions và xung đột nguồn

Merge, archive/delete/ẩn danh, export, discount, payment confirmation, contract, entitlement override, role management và AI write là capability riêng, không suy từ R/W. Chỉ Admin xóa/ẩn danh theo QĐ5; không xóa audit ≥ 5 năm. MISA là nguồn thực thu, Kế toán proposal không cấp quyền CRM tự xác nhận thu. Các quyền chưa chốt ở MVP sau phải duyệt trước triển khai.

Phase 04 task 4.7 ghi Department Head duyệt export, nhưng QĐ5/user chốt BGĐ duyệt. Theo coordinator giữ BGĐ duyệt cuối, Head chỉ review scope. Audit cells đã duyệt 2026-10-04 theo scope lead của từng vai trò. Cùng ngày user đổi quyết định: Admin xem toàn bộ dữ liệu và audit của công ty để kiểm soát công việc, nhưng chỉ đọc; Admin không tạo/sửa lead, ghi hoạt động, đổi stage, hoàn thành việc hay duyệt yêu cầu.

Quản lý người dùng ([ADR-006](../adr/adr-006-password-login.md)) chỉ dành cho Admin: nhập danh sách nhân sự, sửa tên/email/vai trò/phòng ban/nhóm, khóa và mở khóa, cấp mật khẩu tạm, liên kết Lark theo email. Admin không tự đổi vai trò hay tự khóa mình, và hệ thống luôn giữ ít nhất một Admin hoạt động. Quyền này không mở quyền ghi dữ liệu kinh doanh.

## Gate triển khai

Ma trận này cần user review riêng ở phase 08; không ghi [APPROVED] khi chưa có trả lời thật. Sinh allow/deny tests cho từng ô đã cấp; test cross-user/team/department, critical capability, agent projection và REST/MCP parity theo [test strategy](../engineering/test-strategy.md). Danh sách phòng ban/nhóm/Leader bổ sung trước plan MVP1; các role/capability tương lai chốt trước plan tương ứng.
