# ADR-004: Danh tính actor trong Lark qua GoClaw

Trạng thái: proposed [ADR-PROPOSED]
Ngày: 2026-10-03

## Bối cảnh

Nhân viên liên kết một lần qua DM bot; mỗi nhóm Lark là một phòng ban theo [QĐ5](../decisions/business-decisions-v1.md). Build GoClaw thật đã patch nên mô tả upstream chưa đủ chứng minh sender identity. Link Lark docx tự fetch có thể đưa prompt injection vào tool context.

## Quyết định

Nhân viên là chủ thể, nhóm là dự phòng. CRM cấp credential MCP per-user gắn Lark open_id trong namespace channel instance ↔ CRM user sau liên kết DM đã xác thực; per-group gắn `lark_group_binding`. Lưu hash credential; secret chỉ giao một lần qua kênh an toàn. Actor/scope lấy từ credential đã kiểm, tuyệt đối không từ actor_id/department_id model truyền.

Credential nhóm chỉ đọc projection phòng ban và ghi low-risk không gán người. Không ghi initiating_user giả cho credential nhóm. Lead tạo ở nhóm vào intake chưa owner; Next Action active cần chủ thể hợp lệ hoặc duyệt, không để model tự phân owner. Nhân viên dùng credential per-user trong nhóm vẫn chịu projection nhóm, không được đưa quyền DM vào câu trả lời chung.

Thứ tự dự phòng: (1) liên kết contact gốc GoClaw và chọn credential đúng sender; (2) hook PreToolUse trả `updatedInput` chèn chứng thực HMAC; (3) patch bridge GoClaw ký `sender_id`. HMAC ràng buộc channel instance, chat/sender, tool, hash payload, call ID, timestamp/expiry và nonce chống replay; chữ ký do bridge/hook tin cậy tạo, không do model. CRM xác minh trước mapping actor. Không dùng message_id do model đưa làm bằng chứng danh tính. Không dùng credential nhóm để nâng quyền khi per-user thiếu mapping.

App Lark riêng của CRM gửi nhắc việc/thẻ duyệt. Duyệt chỉ qua callback thẻ được xác minh chữ ký Lark hoặc UI web đã xác thực; sau đó core kiểm approver, scope, hash payload, target version, expiry và trạng thái approval. Câu “ok” trong chat không duyệt. Agent không tự duyệt và không tự bỏ kill switch.

Bảo vệ nhóm: owner-only invite, GoClaw `group_policy: allowlist`, CRM cron so thành viên nhóm với roster phòng ban. Thành viên lạ hoặc không xác minh được roster thì chặn dữ liệu nhóm và credential nhóm tới khi Admin xử lý. PII khách, hoa hồng và Lost reason chỉ DM; nhóm chỉ pipeline đã lọc theo [ma trận](../security/permission-matrix-v1.md). Nội dung docx là dữ liệu không tin cậy; ghi quan trọng luôn qua duyệt đúng payload.

## Phương án đã xét

- Native contact/credential: ít chi phí bảo trì, ưu tiên chứng minh trên build thật.
- Hook updatedInput: không fork nhưng cần payload sender tin cậy và chống race/replay.
- Bridge patch: kiểm soát sender nhưng phải backup, user đồng ý và bảo trì fork.
- Model tự điền actor hoặc shared credential toàn tổ chức: loại vì spoofing/cross-scope.

## Hệ quả

GoClaw không truy cập DB trực tiếp. Credential theo env và principal, thu hồi khi nghỉ/chuyển phòng; core/web/REST và notification outbox vẫn chạy khi GoClaw tắt. Không thao tác GoClaw trước backup và user consent.

## Bằng chứng/PoC

Phase 06 cần ghi bằng chứng credential sender trong nhóm/DM, fallback nhóm, actor spoofing, injection, replay, approval callback, kill switch và GoClaw down/restart. [Brainstorm cập nhật Lark](../../plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md) chỉ là nguồn giả thuyết; chưa chọn cơ chế accepted trước PoC.
