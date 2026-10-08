---
phase: 9
title: "Messenger vào Inbox"
status: pending
priority: P2
effort: "1.5d"
dependencies: [3, 6]
---

# Phase 09: Messenger vào Inbox

## Goal

Tin Messenger của Fanpage vào cùng Inbox; bot và nhân viên trả lời qua Graph API; tôn trọng cửa sổ 24 giờ và tag `HUMAN_AGENT`.

## Điều kiện bắt đầu

- Meta đã duyệt `pages_messaging` (Advanced Access). Chưa duyệt thì chỉ làm Task 9.1–9.6 và thử bằng tài khoản có vai trò trên app; không bật cho khách thật.
- Kênh `facebook` native của GoClaw phải tắt (phase 10 kiểm), để không có hai nơi trả lời cùng Page.

## Quy tắc (executor không được đổi)

1. `GET /api/channels/facebook/webhook`: trả `hub.challenge` khi `hub.mode = subscribe` và `hub.verify_token = FB_VERIFY_TOKEN`; ngược lại 403.
2. `POST /api/channels/facebook/webhook`: xác minh `X-Hub-Signature-256` = `sha256=` + hex HMAC-SHA256(`FB_APP_SECRET`, raw body), so sánh hằng thời gian; sai → 401. Đúng → xử lý rồi trả 200 nhanh (dùng `background`).
3. Bỏ `delivery`, `read`. Tin `is_echo`: nếu `mid` trùng tin `out` đã gửi thì bỏ; nếu không (nhân viên trả lời trong Meta Business Suite) → coi như `staff_phone` theo quy tắc 4 của phase 03 (`sender_kind = 'staff_phone'` hiển thị "Meta Business Suite").
4. `channel_account` cho Page: `channel = 'facebook'`, `external_id = page_id`; token Page lấy từ `FB_PAGE_TOKENS[page_id]`. Hội thoại: `external_thread_id = psid`, `userId GoClaw = 'facebook:' + page_id + ':' + psid`.
5. Gửi: lệnh `send_messenger` `target = 'worker'`, xử lý trong `processWorkerCommands`: `POST https://graph.facebook.com/<phiên bản>/me/messages?access_token=...` với `messaging_type = 'RESPONSE'` khi `now - last_inbound_at < 24h`; nếu quá 24h và người gửi là nhân viên và chưa quá 7 ngày → `messaging_type = 'MESSAGE_TAG'`, `tag = 'HUMAN_AGENT'`; quá 7 ngày hoặc bot gửi quá 24h → `failCommand` lỗi `OUTSIDE_WINDOW`, tin `failed`, UI hiện "Quá thời hạn trả lời của Messenger". Phiên bản Graph API ghi trong một hằng số, executor đọc tài liệu Meta hiện hành để chọn.
6. Văn bản > 2000 ký tự → cắt theo dòng thành nhiều tin.

## Files to Create / Modify

- Create: `apps/crm/src/worker/inbox/facebook-webhook.ts`
- Create: `apps/crm/src/worker/inbox/facebook-send.ts`
- Create: `apps/crm/test/inbox-facebook.test.ts`
- Modify: `apps/crm/src/worker/index.ts` (mount `/channels/facebook` trước `originGuard`, cạnh `/bridge`)
- Modify: `apps/crm/src/worker/inbox/worker-commands.ts` (`send_messenger`)
- Modify: `apps/crm/src/worker/inbox/conversation-flow.ts` (chọn `send_messenger` khi `channel = 'facebook'`, nếu phase 03 chưa làm)
- Modify: `apps/crm/src/worker/inbox/inbox-routes.ts` (admin thêm Page: `POST /inbox/accounts` nhận `channel: 'facebook'`, `externalId`)
- Modify: `apps/crm/src/web/pages/channel-accounts.tsx` (form thêm Page; không có QR)

## Tasks

### Task 9.1 — Webhook

- Target files: `facebook-webhook.ts`, `index.ts`.
- Steps: hiện thực quy tắc 1–4, đưa tin vào cùng hàm ingest của phase 03 (tách một hàm `ingestMessage` dùng chung nếu cần, không chép logic).
- Verify: Task 9.4.

### Task 9.2 — Gửi

- Target files: `facebook-send.ts`, `worker-commands.ts`.
- Steps: hiện thực quy tắc 5–6; lỗi Graph trả mã → `failCommand` với mã lỗi Graph, không log token.
- Verify: Task 9.4.

### Task 9.3 — Tài khoản Page

- Target files: `inbox-routes.ts`, `channel-accounts.tsx`.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 9.4 — Test

- Target files: `apps/crm/test/inbox-facebook.test.ts`.
- Steps (mock `fetch` cho Graph):
  1. Verify token đúng → trả challenge; sai → 403.
  2. Chữ ký sai → 401; đúng → tin vào Inbox, `run_completion` được tạo với `userId` `facebook:<page>:<psid>`.
  3. Gửi trùng webhook (cùng `mid`) → một tin.
  4. Echo của tin bot vừa gửi → không thêm tin; echo lạ → `staff_phone`, `mode = 'human'`.
  5. Bot gửi khi `last_inbound_at` 25 giờ trước → `OUTSIDE_WINDOW`; nhân viên gửi cùng lúc → request có `tag = 'HUMAN_AGENT'`.
  6. `delivery`/`read` → không có tin.
- Verify: `pnpm -F @abm/crm test -- inbox-facebook` exit 0.

### Task 9.5 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `typecheck`, `build`; commit `feat(crm): bring facebook messenger into the inbox`.
- Verify: ba lệnh exit 0.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.
