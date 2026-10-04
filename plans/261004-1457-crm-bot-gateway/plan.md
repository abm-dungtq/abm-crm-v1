---
title: "CRM: cổng bot MCP qua GoClaw/Lark, Admin toàn quyền ghi"
description: "Thêm /api/mcp trong Worker CRM để nhân viên đọc/ghi CRM qua bot Lark đúng danh tính, mở quyền ghi nghiệp vụ cho Admin trên web và bot, nhắn Leader qua Lark khi có yêu cầu duyệt."
status: in-progress
priority: P1
effort: 4-5d
branch: main
tags: [feature, agent, mcp, auth, backend, frontend, database]
blockedBy: []
blocks: []
created: 2026-10-04
---

# Cổng bot cho CRM chính

Hợp đồng gốc: [brainstorm-261004-1450-crm-bot-gateway.md](../reports/brainstorm-261004-1450-crm-bot-gateway.md).
Tư vấn kongming: [kongming-261004-1457-crm-bot-gateway-counsel.md](../reports/kongming-261004-1457-crm-bot-gateway-counsel.md).

Kế hoạch này viết cho executor chạy dưới `--advice`. Mỗi phase có Failure Protocol riêng. Khi một bước Verify không đạt, executor phải dừng; đó là hành vi đúng, không phải bị kẹt.

## Outcome

- Nhân viên đã liên kết Lark nhắn bot DungTQ_Agent (GoClaw) để đọc và ghi CRM `abm-crm-eval`.
  - CRM nhận danh tính chỉ từ token riêng của từng người.
  - Phạm vi đúng như web.
  - Nhật ký ghi `actor_kind='agent'`.
- Admin có quyền ghi nghiệp vụ trên web và bot: tạo lead, ghi hoạt động, hoàn thành việc, đổi giai đoạn/Won/Lost, giao lead.
- Qua bot, Admin làm thẳng. Người khác thì lệnh có `agentNeedsApproval` chỉ tạo yêu cầu duyệt:
  - Đổi giai đoạn thông thường: Sale phụ trách hoặc Leader xác nhận trên web. **Không nhắn Leader.**
  - Won/Lost, chuyển người phụ trách, giao lead: CRM nhắn riêng Lark cho Leader của nhóm (trừ người yêu cầu). Leader duyệt trên web.
- Bot trả đủ dữ liệu theo quyền người hỏi, kể cả SĐT, email, lý do Lost.
- Kill switch chặn mọi lệnh ghi qua bot, kể cả của Admin. Web không bị ảnh hưởng.

## Quyết định đã chốt (không đảo lại)

Từ user, 2026-10-04:

1. Admin toàn quyền ghi trên web và bot (đảo commit `9e27f66`).
2. Admin qua bot làm thẳng. Sale/Leader qua bot phải xin duyệt.
3. Đổi giai đoạn thông thường không cần Leader. Các nhóm đã có Leader.
4. Bot trả đủ PII theo quyền.

Mặc định đã chọn theo tư vấn (đổi chỉ khi user yêu cầu):

- Leader tự yêu cầu qua bot thì Leader tự xác nhận trên web, không đẩy lên Head/BGĐ.
- Không thêm Admin vào `decideApproval`, vì Admin làm thẳng được.
- Admin không bao giờ là owner lead.
- Cấp token bằng script cục bộ. Script sinh token, chỉ ghi hash lên D1 và đẩy token sang GoClaw. Không ai thấy token.

## Non-goals

- Lark OAuth đăng nhập web.
- Sửa mã GoClaw.
- Công cụ bot cho `decideApproval` hay `releaseLead`.
- Gửi lại tin Lark theo lịch (cron).
- Production và MISA.
- Dữ liệu nhân sự thật (chỉ dữ liệu demo).

## Phases

| # | Phase | Phụ thuộc | Trạng thái |
|---|---|---|---|
| 01 | [Admin ghi nghiệp vụ trên web](phase-01-admin-business-write.md) | — | completed |
| 02 | [Nền tảng agent: schema, Actor.kind, kill switch, token](phase-02-agent-foundation.md) | 01 | pending |
| 03 | [Endpoint `/api/mcp` và công cụ bot](phase-03-mcp-endpoint-tools.md) | 02 | pending |
| 04 | [Nhắn Leader qua Lark khi có yêu cầu duyệt](phase-04-lark-approval-dm.md) | 03 | pending |
| 05 | [Triển khai eval, nối GoClaw, chạy kịch bản](phase-05-rollout-live-test.md) | 04 | pending |

Các phase chạy tuần tự trên `main`, vì cùng sửa `commands.ts`, `index.ts`, `env.ts`, contracts và migration.

## Acceptance criteria (toàn kế hoạch)

**Lệnh kiểm**

- `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck` và `pnpm -F @abm/crm build` đều exit 0. Test cũ vẫn xanh, trừ các test có kỳ vọng "Admin bị 403 khi ghi": các test đó được đổi có chủ đích ở phase 01.

**Có test cho**

- Bảo vệ `/api/mcp`:
  - không Bearer → 401;
  - cookie phiên mà không Bearer → 401;
  - Bearer kèm header Origin → 403;
  - token đã thu hồi hoặc người dùng bị khóa → 401.
- Danh tính và phạm vi:
  - `whoami` đúng người;
  - lead ngoài phạm vi → "không tìm thấy";
  - hoạt động ghi qua bot có `actor_kind='agent'` và đúng `actor_user_id`.
- Gọi lặp cùng tham số trả kết quả cũ, không tạo hoạt động thứ hai.
- Sale đổi giai đoạn qua bot:
  - lead không đổi;
  - có approval `agent_stage_change`;
  - không có outbox nhắn Leader.
- Sale xin Won/Lost, chuyển người phụ trách, giao lead: có approval và outbox `approval.requested` cho Leader.
- Admin đổi giai đoạn/Won qua bot: lead đổi ngay; audit `actor_kind='agent'` với Admin.
- Kill switch bật:
  - mọi lệnh ghi qua bot → `KILL_SWITCH_ON`, kể cả Admin;
  - web vẫn ghi được.
- Gửi Lark lỗi: approval vẫn `pending`, outbox `failed`.
- Các dòng outbox tạo trước khi deploy giữ nguyên trạng thái, không bị gửi tin.
- Admin không bao giờ thành owner.
- Leader khác nhóm vẫn bị chặn giao lead sau khi tổng quát hóa `assignLead`.

**Trên eval đã deploy**

- Kịch bản A/B/C trong [hướng dẫn test](../../docs/guides/lark-crm-e2e-test.md) đạt.
- CPU `tools/call` p99 < 10 ms qua ít nhất 50 lần gọi.
- Đã tập khôi phục D1 một lần.

**Bảo mật**

- Token không xuất hiện trong chat, log, audit, tài liệu hay git.

## Rủi ro

- **Gán sai khóa credential trong GoClaw** (nhóm: `ou_…`; DM: `user_id` tenant nếu đã merge) sẽ mạo danh mà không báo lỗi. Script phải kiểm mỗi khóa ứng đúng một người.
- **Admin ghi thẳng khi AI hiểu sai câu.** Biện pháp:
  - công cụ bắt buộc `lead_code`;
  - adapter đọc lại lead trước khi ghi;
  - audit rõ;
  - kill switch;
  - đã tập khôi phục.
- **PII trong nhóm Lark:** user chấp nhận. Hướng dẫn nhân viên phải nói rõ.
- **Sửa CHECK `approval.kind` cần dựng lại bảng `approval` trên D1.** Phải backup trước, và kiểm số dòng trước/sau.
- **Phụ thuộc user:**
  - đặt secret `LARK_APP_ID`/`LARK_APP_SECRET`;
  - cấp scope `im:message:send_as_bot`;
  - nhập `demo-roster.csv`;
  - liên kết Lark.

## Câu hỏi chưa giải quyết

- Chưa kiểm khóa credential GoClaw khi nhắn riêng (DM) mà contact **chưa merge**: là `ou_…` hay khóa khác. Phase 05 kiểm trên log trước khi cấp hàng loạt.
