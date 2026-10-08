---
phase: 10
title: "Triển khai eval và pilot"
status: pending
priority: P1
effort: "1d + 2 tuần pilot"
dependencies: [2, 3, 4, 5, 6, 7, 8, 9]
---

# Phase 10: Triển khai eval và pilot

## Goal

Bản eval `abm-crm-eval` chạy Inbox; sidecar chạy trên máy Windows; GoClaw có ba agent; pilot 2 số Zalo trong 2 tuần có báo cáo trước khi mở rộng, trước khi bật Messenger cho khách và trước khi bật tin định kỳ.

Phase này chạy theo ba đợt. Đợt A sau phase 02–07 (Zalo direct + CRM). Đợt B sau phase 09 (Messenger). Đợt C sau phase 08 và khi báo cáo pilot đạt (bật tin định kỳ). Mỗi đợt chỉ chạy các task có ghi đợt đó.

## Cổng đồng ý của user (bắt buộc)

Mỗi bước dưới đây phải hỏi user và nhận "đồng ý" ngay trước khi chạy. Đồng ý cho bước này không tính cho bước khác.

- Backup và áp migration lên remote.
- Đặt secret Worker.
- Deploy.
- Thay đổi cấu hình GoClaw (agent, provider, kênh, backup DB GoClaw trước).
- Cài Scheduled Task trên Windows.
- Đăng nhập QR số thật.
- Bật `scheduled_sends_enabled`.
- Khôi phục D1.

Không in token, secret, mã QR, cookie Zalo hay nội dung các file `*.local*`, `.env`.

## Files to Create / Modify

- Create: `plans/reports/deploy-261008-<HHmm>-omnichannel-inbox.md` (mỗi đợt một mục)
- Create: `plans/reports/pilot-261008-zalo-inbox.md` (số liệu pilot)
- Create: `docs/guides/inbox-operations.md` (vận hành: kết nối số, tiếp quản, chia việc, tắt khẩn cấp, xử lý số bị khoá)
- Modify: `docs/README.md` (liên kết hướng dẫn)
- Modify: `D:\Goclaw\docs\goclaw-system-overview.md` và `D:\Goclaw\docs\messaging-chatbot.md` (ghi ba agent mới, tắt kênh native, đường gọi từ sidecar)

## Tasks

### Task 10.1 — Backup và migration remote (Đợt A)

- Steps:
  1. Hỏi user đồng ý. Backup D1 remote theo `docs/engineering/deployment-baseline.md` (lệnh export của wrangler); ghi tên file backup vào báo cáo.
  2. `cd apps/crm && npx wrangler d1 migrations apply abm-crm-eval --remote`.
- Verify: lệnh exit 0 và in `0012_inbox.sql` tới migration mới nhất của plan; `npx wrangler d1 execute abm-crm-eval --remote --command "SELECT COUNT(*) AS n FROM customer_bot_switch"` in `n` = 1.

### Task 10.2 — Secret Worker (Đợt A; Đợt B thêm FB)

- Steps: nhắc user tự chạy, agent không thấy giá trị:
  - Đợt A: `npx wrangler secret put BRIDGE_SECRET`, `… LARK_INBOX_CHAT_ID`, `… APP_URL`.
  - Đợt B: `… FB_APP_SECRET`, `… FB_VERIFY_TOKEN`, `… FB_PAGE_TOKENS`.
- Verify: `npx wrangler secret list` có đủ tên ở đợt tương ứng (chỉ so tên).

### Task 10.3 — Deploy (mỗi đợt)

- Steps: hỏi đồng ý; `pnpm -F @abm/crm test && pnpm -F @abm/crm deploy`.
- Verify: `curl -s https://<host eval>/api/health` in `{"ok":true}`; `npx wrangler deployments list` có bản mới nhất.

### Task 10.4 — GoClaw (Đợt A)

- Steps: hỏi đồng ý; backup DB GoClaw theo `D:\Goclaw\docs\goclaw-system-overview.md` mục 6; bằng Web UI GoClaw hoặc API admin:
  1. Tạo agent khách hàng (ví dụ `sale-tu-van`) và agent `crm-extractor`, `group-summarizer` theo `docs/integrations/goclaw-inbox-agents.md`, provider/model `deepseek-flash`; hai agent sau không có tool.
  2. Thêm provider embedding OpenAI và đặt system config `embedding.provider`, `embedding.model = text-embedding-3-small`.
  3. Tạo API key ứng dụng mới cho sidecar (scope `operator.read`, `operator.write`); user lưu vào `apps/zalo-bridge/.env` là `GOCLAW_API_KEY`.
  4. Đảm bảo kênh `zalo_personal` và `facebook` native trong GoClaw đều **tắt**.
- Verify: gọi thử từ máy Windows `POST http://127.0.0.1:18790/v1/chat/completions` với `model = goclaw:crm-extractor` và một transcript mẫu không có dữ liệu thật → HTTP 200 và nội dung parse được JSON.

### Task 10.5 — Sidecar trên Windows (Đợt A)

- Steps:
  1. User điền `apps/zalo-bridge/.env` (`CRM_BASE_URL`, `BRIDGE_SECRET`, `GOCLAW_API_KEY`).
  2. Hỏi đồng ý; chạy `apps/zalo-bridge/scripts/install-startup-task.ps1`; khởi động task.
- Verify: `Get-ScheduledTask -TaskName "ABM Zalo Bridge"` có `State` là `Running` hoặc `Ready`; `apps/zalo-bridge/logs/bridge.log` có dòng poll thành công trong 2 phút.

### Task 10.6 — Kết nối 2 số pilot (Đợt A)

- Steps: admin thêm 2 số trong trang Tài khoản kênh, gắn agent khách hàng; hỏi đồng ý; quét QR bằng điện thoại giữ số; dặn nhân viên không đăng nhập Zalo PC/Web trên hai số này.
- Verify: `SELECT display_name, status FROM channel_account` trên remote: hai dòng `connected`.

### Task 10.7 — Kịch bản kiểm thử thật (Đợt A)

- Steps: dùng số Zalo thử (không phải khách) nhắn vào số pilot và đánh dấu kết quả từng mục vào báo cáo deploy:
  1. Hỏi sản phẩm → bot trả lời trong 1 phút, tin hiện trong Inbox.
  2. Đòi gặp nhân viên → `mode = human`, Lark nhận tin, có người được giao (khi `round_robin`).
  3. Nhân viên trả lời trên web → khách nhận; trả lời từ điện thoại số chung → Inbox hiện "Điện thoại", bot im.
  4. Trả lại AI → bot trả lời biết nhân viên đã nói gì.
  5. Để lại tên + SĐT → lead chờ phân loại xuất hiện; phân loại `b2b` → lead thật.
  6. Bật `customer_bot_switch` → bot im; tắt lại.
- Verify: báo cáo có 6 dòng đều "Đạt". Mục nào không đạt → Failure Protocol.

### Task 10.8 — Pilot 2 tuần (Đợt A)

- Steps: mỗi ngày ghi vào `plans/reports/pilot-261008-zalo-inbox.md`: số hội thoại, số lần handoff, số lần tài khoản `error`/phải quét QR lại, cảnh báo từ Zalo (nếu có), tỉ lệ trích CRM đúng (nhân viên đánh giá).
- Success criteria để mở rộng: không có cảnh báo khoá từ Zalo; số lần phải quét QR lại ≤ 2/số/2 tuần. User quyết định cuối cùng.
- Verify: báo cáo có đủ 14 ngày và dòng kết luận do user xác nhận.

### Task 10.9 — Messenger (Đợt B)

- Steps: sau khi Meta duyệt; cấu hình webhook URL `https://<host eval>/api/channels/facebook/webhook` trong Meta App, subscribe `messages`, `messaging_postbacks`, `message_echoes`; admin thêm Page trong CRM; chạy lại kịch bản 10.7 mục 1–4 qua Messenger.
- Verify: báo cáo có 4 dòng "Đạt".

### Task 10.10 — Bật tin định kỳ (Đợt C)

- Steps: chỉ khi Task 10.8 kết luận đạt; hỏi đồng ý; admin bật `scheduled_sends_enabled`; tạo một lịch cho **một** nhóm, `daily_send_cap` thấp (ví dụ 20), duyệt; theo dõi 1 tuần trước khi thêm nhóm.
- Verify: sau lần chạy đầu, `SELECT status FROM channel_command WHERE dedupe_key LIKE 'schedule:%' ORDER BY created_at DESC LIMIT 1` in `done`.

### Task 10.11 — Tài liệu

- Steps: viết `docs/guides/inbox-operations.md`; cập nhật `docs/README.md`; cập nhật hai tài liệu GoClaw ở mục Files; chuyển ADR liên quan sang `accepted` nếu còn `proposed`.
- `docs/guides/inbox-operations.md` phải ghi rõ (chỉ tên, không ghi giá trị):
  - URL webhook Messenger: `/api/channels/facebook/webhook` (đặt sau domain của Worker khi đăng ký webhook với Meta).
  - Secret của Worker cho Messenger: `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `FB_PAGE_TOKENS` (JSON page id → page token).
  - Biến môi trường của bridge (`apps/zalo-bridge/.env.example`): bắt buộc `CRM_BASE_URL`, `BRIDGE_SECRET`, `GOCLAW_API_KEY`; tùy chọn `GOCLAW_BASE_URL`, `SEND_MIN_DELAY_MS`, `SEND_MAX_DELAY_MS`, `POLL_WAIT_SECONDS`.
- Verify: `grep -c "inbox-operations" docs/README.md` ≥ 1; `grep -cF "<tên>" docs/guides/inbox-operations.md` ≥ 1 cho từng tên ở trên (URL webhook, ba secret FB, bảy biến bridge).

## Rollback

- Tắt bot ngay: bật `customer_bot_switch`.
- Ngừng gửi một số: `send_paused = 1`; ngừng hẳn: lệnh `zalo_logout` từ trang Tài khoản kênh, dừng Scheduled Task.
- Quay lại bản Worker trước: `npx wrangler rollback` (hỏi đồng ý). Migration chỉ thêm bảng/cột nên không cần gỡ; chỉ khôi phục D1 từ backup khi user đồng ý.

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
