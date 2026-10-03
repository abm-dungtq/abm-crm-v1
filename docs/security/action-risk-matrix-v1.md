# Ma trận action-risk v1

Nguồn: [business-decisions-v1 QĐ3/4/5/13/14](../decisions/business-decisions-v1.md), [PRD 23](../source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md), [permission matrix](permission-matrix-v1.md). Đây là contract chính sách; không tuyên bố các tool đã triển khai hay có approval riêng cho ma trận.

| command | riskLevel | Agent tự làm? | Ai duyệt | Ghi chú |
| --- | --- | --- | --- | --- |
| search_customer | read | Có trong scope | Không cần | Nhóm chỉ projection department; PII chuyển DM |
| get_customer_360 | read | Có trong scope | Không cần | Lọc Contact/Account/Deal theo quyền, không trả full view ra nhóm |
| add_activity | low | Có | Không cần | Idempotent; nhóm không gán người; Support chỉ activity |
| create_next_action | low | Có khi owner/assignment hợp lệ | Không cần | Task engine duy nhất; nhóm không tự gán người; giữ invariant active |
| create_lead | low | Có | Không cần | Kiểm trùng; nghi trùng → DUPLICATE_SUSPECTED, không tự merge; nhóm tạo intake chưa giao |
| update_stage | approval | Không | Owner hoặc Leader đúng scope | Payload/version và Stage Definition, agent cần approval |
| mark_won | approval | Không | Leader đúng scope | Bằng chứng chốt; không đồng nghĩa thực thu |
| mark_lost | approval | Không | Leader đúng scope | Lost reason bắt buộc; reason Khác có giải thích; không gửi reason ra nhóm |
| change_owner | approval | Không | Leader đúng scope | Sale yêu cầu; Leader phân lại khi nghỉ, có audit |
| send_external_message | approval | Không | Owner đúng scope | Duyệt destination/nội dung/version cụ thể; DM nội bộ không phải bypass gửi ra ngoài |
| export_data | approval | Không | BGĐ duyệt cuối; Department Head review scope | Override phase 4.7 theo QĐ5 user; không gửi export ra nhóm |
| toggle_kill_switch | approval + Admin-only | Không | Admin thực hiện bằng UI xác thực | Capability riêng, agent không tự toggle; bật/tắt đều audit |

Mọi read vẫn kiểm actor/capability/scope/channel. Low không là quyền ghi mọi entity. Mọi write idempotent, sửa có expectedVersion; kiểm kill switch trước agent write kể cả approval/retry. Approval không nâng scope hoặc thay validation; core kiểm target, approver active, payload hash, expiry/version và consume cùng mutation. Chat “ok”, raw model input và người có quyền xem không phải phê duyệt. Duyệt qua callback Lark có chữ ký đã xác minh hoặc web UI.

Human command cũng phải kiểm capability/business rule; risk approval của agent không đồng nghĩa thêm người duyệt mọi thao tác người dùng thông thường. Department Head/BGĐ không tự thay Leader ở Won/Lost/owner khi chưa được cấp capability tương ứng. Các command tài chính/contract/entitlement/merge sẽ bổ sung ở bậc tương ứng sau quyết định; agent không được gọi write chưa có contract. Xem [ADR-005](../adr/adr-005-command-contracts.md) và [security baseline](security-baseline.md).
