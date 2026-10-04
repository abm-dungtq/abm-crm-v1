# Kongming counsel: cổng bot CRM (2026-10-04 14:57)

Verdict: hướng A **GO**, kèm các chỉnh sửa bên dưới. Status: DONE_WITH_CONCERNS.

## Bằng chứng và chỉnh sửa bắt buộc

1. **Đường dẫn và middleware**
   - Dùng `/api/mcp`, vì `apps/crm/wrangler.jsonc` có `run_worker_first: ["/api/*"]`. Một `/mcp` trần sẽ rơi vào SPA.
   - Đăng ký route **trước** `app.use('*', originGuard)` (`apps/crm/src/worker/index.ts:27`). Lý do: `originGuard` trả 403 cho POST không có Origin, còn `requireActor` đòi cookie.
   - Route có middleware Bearer riêng. Từ chối request có header Origin (trình duyệt), giống PoC `poc/goclaw-identity/src/index.ts:10-13`. Không bao giờ rơi về cookie.
2. **`actor_kind`**
   - Hiện ghi cứng `'human'` ở 3 chỗ: `guarded-tx.ts:75` (activity), `guarded-tx.ts:81` (audit), `commands.ts:432` (`requested_by_kind`).
   - Thêm `kind: 'human' | 'agent'` vào `Actor` (`env.ts`). Tầng xác thực gán: cookie → human, Bearer → agent.
3. **Idempotency**
   - LLM không gửi key ổn định, nên adapter tự sinh: `mcp:` + sha256(tool + JSON args chuẩn hóa).
   - Khóa chính `(actor_user_id, key)` đã tách theo người dùng.
4. **Version**
   - Công cụ ghi nhận `lead_code`. Adapter đọc `id, version` ngay trước `runCommand`.
   - Khi có tranh chấp thật, `GuardedTx` vẫn trả `STALE_VERSION`.
5. **Kill switch**
   - Bảng `agent_kill_switch(id=1, enabled)`.
   - Với actor kind agent: kiểm trước, và `tx.assert('SELECT enabled = 0 FROM agent_kill_switch WHERE id = 1', [])` trong batch.
   - Mã lỗi `KILL_SWITCH_ON` đã có (409).
6. **Công cụ bot**
   - Không có `decideApproval`: chat không bao giờ là phê duyệt (ADR-004).
   - Không có `releaseLead`.
7. **Ai duyệt**
   - Theo `mayDecideApproval` (`scope.ts:37-41`).
   - Lead ở hàng chờ có `team_id NULL` nên hôm nay không ai duyệt được. Mở rộng: Leader có `department_id` trùng khi `lead.status='queue'`.
   - Leader tự yêu cầu qua bot thì chính Leader xác nhận trên web, và không nhắn tin.
8. **Schema duyệt**
   - CHECK `approval.kind` chỉ có `owner_change | agent_stage_change`, cần thêm `agent_assign`.
   - Hiện chưa có lệnh nào **tạo** `agent_stage_change`. Nhánh áp dụng trong `decideApproval` (`commands.ts:476-480`) đã có.
9. **Tin nhắn Lark**
   - Dùng bảng `outbox` (`tx.event('approval.requested')`). Sau khi commit thì gọi `waitUntil(deliver)`, rồi cập nhật `status sent|failed`, `attempts`, `last_error`, `sent_at`.
   - Lỗi Lark không làm hỏng yêu cầu duyệt.
   - API: `POST /open-apis/im/v1/messages?receive_id_type=open_id`, scope `im:message:send_as_bot`.
   - Mỗi tin tốn 2 subrequest.
   - Lời bot không được khẳng định "đã báo".
10. **Admin toàn quyền ghi**
    - Thêm `admin` vào role của `createLead`, `assignLead`, `logActivity`, `completeTask`, `changeStage`.
    - `assignLead` dùng `actor.teamId` (`commands.ts:309,312`), mà Admin có `teamId` null. Cần tổng quát: team đích = `lead.team_id` với role khác leader. Lead hàng chờ cho phép thành viên team trong `lead.department_id`.
    - `createLead` rơi về phòng ban cũ nhất khi actor không có phòng ban (`commands.ts:250`).
    - `queries.ts:304` `writer`; `queries.ts:315` `permissions.assign`.
    - Bất biến: Admin không bao giờ là owner. Admin ghi thẳng làm yêu cầu duyệt đang chờ thành stale (`commands.ts:463-469`).
11. **Cấp token**
    - Thu hồi token trong cùng batch khóa người dùng (`admin-routes.ts:214` đã làm vậy cho phiên).
    - `loadUser` lọc `status='active'`.

## Hai nhánh quyết định (đã chọn mặc định an toàn)

- Leader tự xác nhận trên web thay vì đẩy lên Head/BGĐ: **mặc định có**.
- Không thêm Admin vào `decideApproval`, vì Admin làm thẳng được: **mặc định không**.

## Rủi ro chính

- Ánh xạ khóa credential GoClaw: nhóm dùng `ou_`, DM dùng `user_id` tenant. Gán sai khóa thì mạo danh mà không báo lỗi.
- Admin ghi thẳng mà AI hiểu sai câu: cần nhật ký rõ, kill switch, và đã tập khôi phục bằng D1 Time Travel.
- Hồi quy bề mặt xác thực ở `/api/mcp`.

## Giả định chưa kiểm

- Bridge GoClaw không tự gọi lại `tools/call` (mức tin trung bình). Key idempotency tự sinh vẫn che được trường hợp này.
