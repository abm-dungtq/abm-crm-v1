---
title: "CRM: inbox đa kênh Zalo cá nhân + Fanpage, chatbot GoClaw"
description: "Thêm Inbox vào ABM CRM gom tin Zalo cá nhân (số chung công ty) và Fanpage, GoClaw deepseek-flash trả lời ở chế độ AI, nhân viên tiếp quản ngay trong CRM, lead chờ phân loại, chia việc, quản lý nhóm Zalo có tin định kỳ và tóm tắt hằng ngày gửi Lark."
status: pending
priority: P1
effort: 14-17d
branch: main
tags: [feature, agent, backend, frontend, database, integration, zalo, messenger, lark]
blockedBy: [261004-1457-crm-bot-gateway, 261004-1300-crm-admin-user-auth]
blocks: []
created: 2026-10-08
---

# Inbox đa kênh và chatbot GoClaw trong ABM CRM

Hợp đồng gốc: [brainstorm-261008-1421-omnichannel-inbox-goclaw.md](../reports/brainstorm-261008-1421-omnichannel-inbox-goclaw.md).
Thiết kế trước đó (phía GoClaw): `D:\Goclaw\plans\reports\brainstorm-261008-1409-zalo-unified-inbox.md`.

Kế hoạch này viết cho executor chạy dưới `--advice`. Mỗi phase có Failure Protocol riêng. Khi một bước Verify không đạt, executor phải dừng; đó là hành vi đúng, không phải bị kẹt.

## Outcome

- Trang Inbox trong CRM hiện tin Zalo cá nhân (dưới 10 số chung công ty) và Fanpage, cập nhật vài giây một lần.
- Mỗi hội thoại có chế độ `ai` / `human` / `paused`. Ở `ai`, GoClaw (`deepseek-flash`) trả lời. Nhân viên bấm Tiếp quản, nhắn từ điện thoại, hoặc agent trả `[HANDOFF: lý do]` thì chuyển `human`, chia cho nhân viên, nhóm Lark nhận thông báo.
- Tên nhân viên được giao hiện trên luồng. Quản lý chia thủ công hoặc bật chia lần lượt.
- Agent trích thông tin khách thành **lead chờ phân loại** (`lead_intake`); nhân viên chọn `b2b` hoặc `learner` thì lệnh có sẵn tạo `contact` + `lead` thật, rồi CRM gắn `contact_point` Zalo ID / Facebook ID. Thông tin mới khác thông tin đã có chỉ được ghi khi nhân viên xác nhận.
- Trang Nhóm Zalo: xem/gửi tin nhóm, lịch tin định kỳ có duyệt và giới hạn, tóm tắt nhóm hằng ngày gửi Lark.

## Quyết định đã chốt (không đảo lại)

Từ user, 2026-10-08:

1. Tích hợp vào repo này, không làm web-app riêng.
2. LLM `deepseek-flash` qua GoClaw cho mọi agent. Embedding OpenAI `text-embedding-3-small` (cấu hình phía GoClaw).
3. Kênh: Zalo cá nhân + Fanpage. Không Zalo OA, không Pancake.
4. Tài khoản Zalo là số chung công ty; nhân viên giữ điện thoại.
5. Nhân viên xem mọi hội thoại. Chia thủ công hoặc lần lượt; handoff tự chia; tên nhân viên trên luồng.
6. Lead do chatbot tạo ở dạng chờ phân loại; nhân viên chọn pipeline.
7. Tin định kỳ gửi vào **nhóm có khách**. Tóm tắt nhóm hằng ngày gửi Lark.
8. Hàng lệnh lease trong D1, không dùng Cloudflare Queues.
9. Máy Windows chạy GoClaw 24/7.

Mặc định đã chọn theo tư vấn kongming (đổi chỉ khi user yêu cầu):

- Worker là nơi duy nhất ghi dữ liệu chuẩn. Sidecar `apps/zalo-bridge` chỉ thực thi: giữ phiên zca-js, đẩy sự kiện, kéo lệnh, gọi GoClaw qua `127.0.0.1`.
- Sidecar chỉ kéo lệnh (long-poll), không mở cổng vào.
- Không dùng Durable Objects; UI polling.
- Mở rộng `contact_point.type` thay vì tạo mô hình khách hàng mới.
- Gọi GoClaw cho trích CRM và tóm tắt nhóm theo kiểu stateless: mỗi lần một `X-GoClaw-User-Id` mới.
- Giới hạn tin/ngày tính theo **tài khoản** trên mọi lệnh gửi.

## Non-goals

- Zalo OA, Pancake, chủ động nhắn 1-1 cho khách lạ.
- App di động riêng, Durable Objects, Cloudflare Queues.
- Sửa mã GoClaw.
- Nhiều tổ chức. Production và MISA.

## Hợp đồng dùng chung giữa các phase

Executor phải dùng đúng tên dưới đây ở mọi phase.

### Bảng mới (migration `0012_inbox.sql`, `0013_contact_point_channels.sql`, `0014_inbox_settings.sql`)

| Bảng | Cột chính |
|---|---|
| `channel_account` | `id`, `organization_id`, `channel` (`zalo`/`facebook`), `external_id`, `display_name`, `agent_key`, `bot_enabled`, `send_paused`, `daily_send_cap`, `quiet_start`, `quiet_end`, `status` (`disconnected`/`qr_pending`/`connected`/`error`), `qr_image`, `qr_expires_at`, `last_seen_at`, `created_at`, `updated_at`; UNIQUE(`channel`, `external_id`) |
| `conversation` | `id`, `organization_id`, `channel_account_id`, `kind` (`direct`/`group`), `external_thread_id`, `contact_id`, `display_name`, `mode` (`ai`/`human`/`paused`), `assignee_user_id`, `assigned_at`, `handoff_reason`, `staff_context_pending`, `ai_lock_until`, `last_message_at`, `last_inbound_at`, `last_staff_reply_at`, `sla_due_at`, `summary_enabled`, `scheduled_opt_out`, `created_at`, `updated_at`; UNIQUE(`channel_account_id`, `external_thread_id`) |
| `message` | `id`, `conversation_id`, `direction` (`in`/`out`), `sender_kind` (`customer`/`bot`/`staff_web`/`staff_phone`/`system`), `sender_external_id`, `sent_by_user_id`, `external_msg_id`, `body`, `attachments_json`, `status` (`received`/`pending`/`sent`/`failed`), `created_at`; UNIQUE(`conversation_id`, `external_msg_id`) |
| `channel_command` | `id`, `kind` (`send_zalo`/`send_messenger`/`run_completion`/`send_lark`/`zalo_login`/`zalo_logout`), `target` (`bridge`/`worker`), `channel_account_id`, `conversation_id`, `payload_json`, `status` (`pending`/`claimed`/`done`/`failed`), `attempts`, `claimed_at`, `lease_expires_at`, `next_run_at`, `result_json`, `dedupe_key` UNIQUE, `created_at`, `updated_at`; INDEX(`target`, `status`, `next_run_at`) |
| `lead_intake` (cột `conversation.last_extracted_at` thêm ở `0015_conversation_extracted_at.sql`) | `id`, `organization_id`, `conversation_id`, `contact_id`, `fields_json`, `status` (`pending`/`classified`/`discarded`), `lead_id`, `classified_by_user_id`, `classified_at`, `created_at`, `updated_at` |
| `inbox_roster` | `user_id` PK, `on_duty`, `last_assigned_at` |
| `group_schedule` | `id`, `conversation_id`, `template_text`, `weekdays_mask`, `time_of_day`, `status` (`draft`/`pending_approval`/`active`/`paused`), `approved_by_user_id`, `approved_at`, `next_run_at`, `last_run_at`, `created_by_user_id`, `created_at`, `updated_at` |
| `inbox_setting` (migration `0014_inbox_settings.sql`) | `id` = 1, `assign_mode` (`manual`/`round_robin`), `sla_minutes`, `scheduled_sends_enabled` (thêm ở `0016_group_controls.sql`, mặc định 0), `updated_by_user_id`, `updated_at` |
| `customer_bot_switch` | `id` = 1, `enabled` (0/1: 1 nghĩa là **tắt** bot khách hàng, cùng nghĩa `agent_kill_switch`), `updated_by_user_id`, `updated_at` |

`contact_point.type` mở rộng thành (`phone`, `email`, `zalo_uid`, `fb_psid`).

### API cho sidecar (mount trước `originGuard`, như `/mcp`)

- `POST /api/bridge/events`: đẩy sự kiện. Header `X-Bridge-Timestamp`, `X-Bridge-Signature` = hex HMAC-SHA256(`BRIDGE_SECRET`, timestamp + "." + body). Lệch giờ quá 300 giây thì từ chối.
- `GET /api/bridge/commands?wait=20`: nhận lệnh `target='bridge'`, có lease **300 giây** (lớn hơn timeout GoClaw 180 giây). Mỗi lệnh trả về kèm `attempts`.
- `POST /api/bridge/commands/:id/result`: trả kết quả kèm `attempts` của lần claim; Worker chỉ áp kết quả khi `UPDATE ... WHERE id = ? AND status = 'claimed' AND attempts = ?` đổi đúng 1 dòng, ngược lại bỏ qua (kết quả cũ của lease đã hết hạn).

### Lệnh và định danh

- `X-GoClaw-User-Id` của hội thoại: `zalo:<channel_account.external_id>:<external_thread_id>` hoặc `facebook:<page_id>:<psid>`.
- Trích CRM: `crm-extract:<uuid>`. Tóm tắt nhóm: `group-summary:<uuid>`.
- Agent GoClaw: agent khách hàng theo `channel_account.agent_key`; `crm-extractor`; `group-summarizer`.
- Lệnh `send_zalo` / `send_messenger` luôn có `payload.messageId` = id dòng `message` `out` tương ứng.
- Sự kiện `account_status: connected` luôn có `accountId` (id CRM) và `accountExternalId` (uid Zalo của số); Worker ghi `channel_account.external_id` từ đó.
- Marker handoff: dòng khớp regex `^\[HANDOFF:\s*(.+?)\]\s*$` (đa dòng).

### Biến môi trường Worker mới

`BRIDGE_SECRET`, `LARK_INBOX_CHAT_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `FB_PAGE_TOKENS` (JSON page_id → token). Tất cả là secret, user tự đặt bằng `wrangler secret put`.

## Phases

| # | Phase | Giai đoạn | Phụ thuộc | Effort |
|---|---|---|---|---|
| 01 | [ADR và điều kiện trước](phase-01-adrs-and-gates.md) | P0 | plan 1457, 1300 xong phase 05 | 1d |
| 02 | [Schema, contracts, dispatcher lease](phase-02-schema-and-dispatcher.md) | P1 | 01 | 2d |
| 03 | [API sidecar và luồng hội thoại trong Worker](phase-03-bridge-api-and-conversation-flow.md) | P1 | 02 | 2d |
| 04 | [Sidecar `apps/zalo-bridge`](phase-04-zalo-bridge-sidecar.md) | P1 | 03 | 2d |
| 05 | [Giao diện Inbox và tài khoản kênh](phase-05-inbox-ui.md) | P1 | 03 | 2d |
| 06 | [Chia việc, SLA, cron](phase-06-assignment-sla-cron.md) | P1–P2 | 03 | 1.5d |
| 07 | [Trích CRM và lead chờ phân loại](phase-07-crm-intake.md) | P2 | 03, 06 | 1.5d |
| 08 | [Nhóm Zalo: tóm tắt và tin định kỳ](phase-08-zalo-groups.md) | P2, P4 | 04, 06 | 2d |
| 09 | [Messenger](phase-09-messenger.md) | P3 | 03, 06; App Review được duyệt | 1.5d |
| 10 | [Triển khai eval và pilot](phase-10-rollout-pilot.md) | P1–P4 | 02–09 | 1d + 2 tuần pilot |

Phase 10 chạy nhiều lần: sau 02–07 cho P1/P2, sau 09 cho Messenger, sau 08 phần tin định kỳ khi có số liệu pilot.

## Acceptance criteria

- `pnpm -F @abm/crm test`, `pnpm -F @abm/crm typecheck`, `pnpm -F @abm/crm build`, `pnpm -F @abm/zalo-bridge test`, `pnpm -F @abm/zalo-bridge typecheck` đều exit 0.
- Kết nối QR từng số Zalo trong CRM; trạng thái hiện trên trang Tài khoản kênh.
- Tin vào/ra, kể cả tin gửi từ điện thoại số chung, có trong Inbox; không trả lời trùng một `external_msg_id`.
- `mode` bền qua khởi động lại; tin `staff_phone` hoặc nút Tiếp quản chuyển `human`; bot không gửi gì ở `human`/`paused`.
- Handoff: hội thoại có `assignee_user_id`, Lark nhận tin trong 1 phút.
- Trả lại AI: lượt GoClaw kế tiếp có tiền tố `[Nhân viên đã trao đổi: ...]`.
- Lead chờ phân loại → chọn pipeline → `lead` tạo bằng `createLead` hoặc `createLearnerLead`; `contact_point` `zalo_uid`/`fb_psid` được gắn; ghi đè trường đã có chỉ khi nhân viên xác nhận.
- Tin định kỳ chỉ chạy khi đã duyệt, tôn trọng giới hạn theo tài khoản, giờ yên lặng, `scheduled_opt_out`, `send_paused`, `customer_bot_switch`.
- Tóm tắt nhóm hằng ngày tới Lark.
- Pilot 2 số Zalo trong 2 tuần có báo cáo số lần bị đá phiên trước khi mở rộng và trước khi bật tin định kỳ.

## Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Zalo khóa số chung (cao nhất ở tin định kỳ) | Pilot, nhịp gửi giống người, cap theo tài khoản, giờ yên lặng, `send_paused`, công tắc |
| Va chạm với plan 1457/1300/1053 | Phase 01 chặn cho tới khi phase 05 của 1457/1300 xong; rebase trước mỗi phase |
| Máy Windows/tunnel rớt | Inbox vẫn đọc được; lệnh `bridge` chờ trong D1 và chạy khi sidecar về |
| App Review Meta chậm | Phase 09 tách riêng, nộp hồ sơ từ phase 01 |
| zca-js đổi giao thức / giấy phép | Phase 04 kiểm giấy phép trước khi cài; adapter tách `zalo-client.ts` |
| PII tập trung | Phạm vi theo role, dùng `consent`/`privacy_request` sẵn có, không log nội dung tin |

## Cổng đồng ý của user

Các việc sau phải hỏi user và nhận "đồng ý" ngay trước khi chạy, mỗi lần riêng: áp migration remote, deploy, đặt secret, thay đổi cấu hình GoClaw, đăng nhập QR số thật, bật tin định kỳ, khôi phục D1. Không in token, secret, mã QR hay nội dung file `*.local*`.
