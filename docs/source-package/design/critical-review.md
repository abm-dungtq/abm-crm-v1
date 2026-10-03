# Phản biện thiết kế ABM CRM

Ngày: 03/10/2026. Phạm vi: tư vấn, không phải kết quả kiểm thử hay ADR đã duyệt.

## Kết luận

Giữ hướng core ABM riêng trên Cloudflare, học Twenty, GoClaw ngoài Cloudflare và agent ngay từ đầu. Thiết kế hiện là nền để làm ERD/ADR/plan, chưa đủ để cam kết production. Không cắt 12 module hoặc tự đảo các quyết định người dùng.

## Các điểm cần đóng

| Điểm | Rủi ro | Yêu cầu xử lý |
| --- | --- | --- |
| Traceability PRD | Có 12 tên module nhưng thiếu chứng minh từng yêu cầu | Map requirement tới command/state, permission và acceptance test |
| Trusted actor | Shared API key hoặc user ID do model điền không chứng minh nhân viên | Link channel identity với user; delegation, revoke và actor/service audit |
| D1 capacity | Message/audit/reporting cạnh tranh dung lượng và query | Ước lượng data growth, retention và đo workload thật trên D1 |
| D1 conditional writes | Update 0 rows không tự làm batch fail | Domain, audit, outbox chỉ ghi khi mutation thực sự hợp lệ; test stale và rollback |
| Resource booking | Version từng reservation không chặn hai reservation mới trùng | Kiểm conflict và write atomically; test cùng resource/time range |
| Agent tự ghi nhận | Low-risk chưa được định nghĩa theo action/field | Action-risk matrix, nguồn dữ liệu, trạng thái chưa xác minh và sửa sai |
| Forced Next Action | Tạo lead/task riêng hoặc complete task gây thiếu next action | Owner + Next Action + Deadline cho Lead/Deal active; ngoại lệ có chủ đích |
| Approval | Thiếu trải nghiệm duyệt và delegation/escalation | Exact payload/diff, version, expiry, recheck quyền, inbox và stale handling |
| MISA reconciliation | Một khoản thu nhiều order, thu một phần, sửa/hủy chứng từ | Source/version, allocation, precedence, unmatched queue, finance confirmation |
| External send | Timeout sau khi bên ngoài nhận có thể gây gửi lặp | Delivery ledger, correlation, provider idempotency nếu có; unknown outcome cần đối soát |
| Internal chat vs omni | Agent từ đầu có thể chỉ có tool demo | MVP1 có kênh nội bộ thật, identity, source, receipt và human handoff; full omni theo ladder |
| Recovery | Restore dữ liệu không đảo side effects bên ngoài | Reconcile outbox/delivery ledger sau restore; thử DB/files/config/GoClaw recovery |

## Hướng thực hiện

1. Khóa business decisions và ERD/state model theo mục 43 PRD.
2. Làm permission matrix, action-risk matrix, command lifecycle và source precedence.
3. Chứng minh D1 writes/concurrency, GoClaw identity và MISA data coverage bằng PoC dữ liệu cô lập.
4. Xây vertical slice B2B có UI/chat/core policies chung và báo cáo có nguồn.
5. Mở đủ domain theo ladder; không dựng workflow builder hoặc metadata platform ngoài PRD Config-Lite.
6. Chỉ thêm specialist agents, Durable Objects hoặc Workflows khi có use case cần chúng.

## Checklist và bằng chứng thành công

- [ ] Requirement traceability và quyết định mục 43 được ghi rõ.
- [ ] Unauthorized requests bị từ chối trong UI/REST/MCP tests.
- [ ] Conflict/stale command không phát successful event hoặc thay đổi liên quan sai.
- [ ] Queue replay, event sai thứ tự và hai workers không tạo entitlement trùng.
- [ ] Hai booking cùng resource/time không vượt chính sách conflict.
- [ ] Lead/Deal active không thiếu Owner/Next Action/Deadline ngoài ngoại lệ đã định nghĩa.
- [ ] Approval payload/version thay đổi bị yêu cầu duyệt lại; external send unknown không retry mù.
- [ ] PaymentReference được đối soát với finance, có sửa/hủy và allocation tests.
- [ ] Báo cáo khớp nguồn, có as-of/freshness và scope người nhận.
- [ ] CRM dùng được khi GoClaw tắt; restore không replay side effects mù.

## Đánh đổi và còn mở

Core riêng đòi hỏi đội sở hữu nền CRM; all-Cloudflare cần thiết kế theo D1 và đo tải. Nếu PoC không đạt, điều chỉnh indexes/projections/data placement trong Cloudflare; không tự đổi sang external PostgreSQL. Tách DB có chi phí transaction/reporting. Chưa chốt số người dùng/tải, deadline/capacity đội, MISA API entitlement, kênh pilot, RPO/RTO và GoClaw production ops. Không tự đặt target kinh doanh hoặc SLA thay user.
