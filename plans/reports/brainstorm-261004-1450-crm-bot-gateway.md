# Brainstorm: cổng bot cho CRM chính

Ngày: 2026-10-04. Yêu cầu: "triển khai cổng bot cho CRM, admin có toàn quyền lưu dữ liệu CRM chính".

## Quyết định của user (2026-10-04)

1. Admin có toàn quyền ghi dữ liệu nghiệp vụ trên **cả web và bot**. Quyết định này đảo ngược "Admin chỉ xem" của commit `9e27f66`.
2. Việc rủi ro cao (đổi giai đoạn, Won/Lost, đổi người phụ trách, giao lead):
   - Admin nhắn bot thì CRM làm ngay. Audit ghi người làm là Admin, kênh là bot.
   - Sale/Leader nhắn bot thì CRM chỉ tạo yêu cầu duyệt. CRM gửi tin nhắn riêng trên Lark tới Leader để xin duyệt. Leader duyệt trên web.
   - Bổ sung 14:59: các nhóm đã có Leader. Đổi giai đoạn thông thường (không phải Won/Lost) không cần Leader. Sale phụ trách lead tự xác nhận trên web, đúng luật `mayDecideApproval` hiện có, và CRM không nhắn Leader. Chỉ Won/Lost, chuyển người phụ trách và giao lead mới nhắn riêng cho Leader của nhóm.
3. Bot trả đủ dữ liệu theo quyền của người hỏi, kể cả SĐT, email và lý do Lost. User chấp nhận rủi ro: hỏi trong nhóm thì cả nhóm thấy.
4. User muốn dùng `/ak-advise` để kiểm soát quá trình triển khai.

## Contract

**Outcome:** nhân viên đã liên kết Lark nhắn bot DungTQ_Agent (GoClaw) để đọc và ghi dữ liệu CRM chính (`abm-crm-eval`) đúng tên mình và đúng phạm vi quyền web của mình. Admin ghi được mọi dữ liệu nghiệp vụ trên web và bot. Yêu cầu duyệt tạo qua bot được báo tới Leader bằng tin nhắn riêng Lark.

**Constraints:**

- Định danh chỉ lấy từ token riêng của từng người (ADR-004). Không tin tên hay `acting_user` trong câu chat. GoClaw không gửi thông tin nhóm/DM hay người gửi sang MCP (`bridge_tool.go`).
- Lệnh ghi qua bot đi qua cùng pipeline với web: role → schema → idempotency → handler → GuardedTx (ADR-003, ADR-005). Ghi `actor_kind='agent'`.
- Token lưu dạng hash trong D1. Không in token ra chat, log hay tài liệu.
- Phải có khóa khẩn cấp (kill switch) chặn mọi lệnh ghi qua bot.
- Phải sao lưu trước khi đổi schema D1 hoặc cấu hình GoClaw. Deploy và gửi tin Lark thật cần user đồng ý.
- Giữ gói Cloudflare miễn phí.

**Non-goals:**

- Không bỏ bước duyệt cho Sale/Leader.
- Không làm Lark OAuth đăng nhập web (ADR-006 giữ mật khẩu).
- Không sửa mã nguồn GoClaw.
- Không đụng MISA hay production.

**Acceptance criteria:**

- A, B (đã liên kết) hỏi `whoami` trong nhóm và nhắn riêng: CRM trả đúng người.
- C (chưa liên kết) không thấy công cụ CRM, hoặc bị từ chối.
- B ghi hoạt động cho lead trong phạm vi: hoạt động có người ghi là B và `actor_kind='agent'`. B hỏi lead ngoài phạm vi: bot trả "không tìm thấy".
- Sale nhờ bot đổi giai đoạn: lead không đổi; có yêu cầu duyệt `agent_stage_change`; Leader nhận tin riêng Lark; Leader duyệt trên web thì lead đổi.
- Admin nhờ bot đổi giai đoạn hoặc Won/Lost: CRM làm ngay; audit ghi Admin và kênh agent.
- Admin tạo và sửa lead, ghi hoạt động trên web.
- Khi bật kill switch: mọi lệnh ghi qua bot bị chặn; lệnh trên web không bị ảnh hưởng.
- Test Vitest cho quyền, phạm vi, idempotency và kill switch đều xanh.

## Các hướng đã so sánh

| Hướng | Dựa vào giả định | Hỏng trước khi |
| --- | --- | --- |
| **A. `/mcp` trong Worker CRM** (khuyên dùng) | Worker gánh được JSON-RPC MCP trong giới hạn CPU gói free | Một lệnh MCP vượt ~10 ms CPU; cách đo: thử trên eval |
| B. Worker MCP riêng gọi API CRM | Có cách tin cậy giữa hai Worker | Phải chép quyền và phạm vi sang Worker thứ hai, hai nơi lệch nhau |
| C. Một khóa chung và header tên người gửi | GoClaw gửi người gửi thật | GoClaw không gửi; giả mạo được. ADR-004 đã loại |

Better approaches: none. Hướng A tái dùng đúng pipeline lệnh và truy vấn mà web đang dùng (`apps/crm/src/worker`), nên quyền trên web và bot khớp nhau.

## Thiết kế đề xuất (hướng A)

- Bảng D1 mới `agent_token(id, user_id, token_hash, created_at, revoked_at, last_used_at)`. Cần migration và backup trước khi chạy.
- `/api/mcp` (hoặc `/mcp`) nhận `Authorization: Bearer <token>`, tra hash, dựng `Actor` từ `app_user`. Người dùng bị khóa thì token cũng bị khóa.
- Công cụ đọc: `whoami`, tìm lead, xem chi tiết lead, việc của tôi, tổng quan. Dữ liệu trả theo phạm vi và quyền web của người hỏi, kể cả PII (quyết định 3).
- Công cụ ghi: `log_activity`, `create_lead`, `complete_task`, `change_stage` (Won/Lost), `assign_lead`, `request_owner_change`.
  - Admin: chạy thẳng.
  - Người khác: lệnh có `agentNeedsApproval` thì tạo approval.
- `GuardedTx` nhận `actor_kind` thay vì luôn ghi `'human'`.
- Mở quyền ghi cho Admin trên web: thêm `admin` vào role của `COMMANDS` và vào `writer` trong `queries.ts`; bỏ chặn UI trong `layout.tsx` và `leads.tsx`. Cập nhật lại permission matrix.
- Báo Leader qua Lark:
  - Worker gọi Lark IM API bằng `LARK_APP_ID`/`LARK_APP_SECRET` (đã có trong Env) tới `lark_open_id` của Leader.
  - Cần scope gửi tin của bot (`im:message:send_as_bot`).
  - Gửi lỗi không làm hỏng yêu cầu duyệt; ghi trạng thái gửi.
- Kill switch: cờ trong D1 (hoặc secret). Chỉ Admin bật/tắt trên web.
- Script cục bộ cấp token cho người đã liên kết Lark, rồi đẩy vào GoClaw theo hai khóa: `ou_…` (tin trong nhóm) và `user_id` tenant (tin riêng). Dựa trên `connect-goclaw-users.mjs`. Không in token.

## Rủi ro còn mở

- **PII trong nhóm:** do quyết định 3, ai hỏi trong nhóm thì cả nhóm thấy SĐT/email khách mà người hỏi được xem. Nên ghi vào hướng dẫn cho nhân viên.
- **Admin ghi thẳng qua bot:** AI hiểu sai câu thì ghi sai ngay, không có bước chặn. Cần audit rõ, có thể hoàn tác thủ công, và có kill switch.
- **Phụ thuộc việc của user:**
  - đặt secret Lark và cấp scope gửi tin;
  - nhập `demo-roster.csv`;
  - chạy liên kết Lark để có `lark_open_id`.
- **Khóa tin nhóm theo `ou_`:** GoClaw tra credential trong nhóm theo open_id thô. Mỗi nhân viên cần hai bản ghi credential trong GoClaw.
- **CPU gói free:** chưa đo tải MCP trên eval.

## Bước tiếp

User chạy `/ak-advise` với báo cáo này để duyệt hướng và kiểm soát triển khai. Sau đó `/ak:plan --advice` rồi `/ak:cook`.
