# Kiểm kê VPS Webapp-Chatbot (phase 1)

Ngày 14/10/2026. Opus làm bằng SSH key `abm_vps_ed25519`. Không in secret, token hay dữ liệu khách. Mọi truy vấn dữ liệu chạy trên bản sao lưu ở máy, không chạy trên DB đang dùng.

## Sao lưu

- Trên VPS: `/root/pre-oa-to-crm-20261014T040950Z.db`, tạo bằng `sqlite3 .backup`, `integrity_check` = `ok`.
- Bản chép về máy: `D:\TQD\CRM\exports\pre-oa-to-crm-20261014T040950Z.db` (6.320.128 byte, git bỏ qua).
- Thư mục `data/` trên VPS còn sẵn các bản cũ (`webapp.db.bak*`, `webapp.db.predeploy-*`) từ tháng 9.

## 1. Caddy

- File `/etc/caddy/Caddyfile`, Caddy v2.11.4, chạy bằng systemd `caddy` (`caddy run --environ --config /etc/caddy/Caddyfile`).
- Site block hiện tại (không có secret):

```caddy
chatbot.abmedu.vn {
	reverse_proxy 127.0.0.1:8787
}
```

- File chỉ có đúng block này. Phase 9 thêm hai khối `handle` cho hai đường dẫn Zalo, đặt trước `reverse_proxy`.

## 2. Tài khoản Zalo OA trong app cũ

| id | OA id | Tên | enabled | agent_enabled | Agent | Có dòng 199k trong override |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | 2515581587601871963 | ABM Ai business master | 1 | 1 | 4 | có |
| 13 | 579745863508352884 | Zalo OA | 0 | 0 | 3 | có |

- **OA đang chạy thật là id 15.** OA 13 đã tắt từ tháng 9, chỉ có 1 hội thoại và 1 tin.
- `settings.zalo_oa_id` trỏ vào OA 15.
- Các kênh khác (không đụng tới): webchat id 1, Facebook id 2 "Học AI Cùng ABM" và id 22 (trang quán cháo, agent tắt).

## 3. Số liệu OA 15

| Mục | Số |
| --- | --- |
| Hội thoại | 47 (42 `ai`, 5 `human`), đều có tên, 45 có avatar |
| Tin nhắn | 507 |
| Tin cũ nhất / mới nhất | 2026-09-03 02:58 / 2026-10-14 03:16 (UTC) |
| Liên hệ (`contact_identities`) | 47 |
| Lead | 14 |
| Bộ nhớ khách (`customer_memories`) | 24 |

Chi tiết tin theo loại:

| Hướng | Người gửi | Loại | Nguồn | Số |
| --- | --- | --- | --- | --- |
| in | customer | text | live | 256 |
| in | customer | image | live | 21 |
| in | customer | image | import | 1 |
| out | ai | text | agent | 220 |
| out | ai | image | agent | 1 |
| out | agent | text | manual | 7 |
| out | agent | text | import | 1 |

## 4. Cách app cũ lưu cấu hình và secret

- Bảng `settings(key, value, encrypted, updated_at)`. Giá trị có `encrypted = 1` được mã hoá AES-GCM, khoá là SHA-256 của `ENCRYPTION_KEY` trong `/root/webapp-chatbot/.env`. Dạng lưu: `base64(iv).base64(ciphertext)` (`src/lib/crypto.ts`).
- Khoá liên quan Zalo:
  - `zalo_app_id`: không mã hoá, dài 18;
  - `zalo_app_secret`: mã hoá, giải mã ra dài 20;
  - `zalo_oa_secret`: mã hoá, giải mã ra dài 20 (dùng để kiểm chữ ký webhook);
  - `zalo_oa_id`, `zalo_oa_name`: không mã hoá;
  - `zalo_oa_token`, `zalo_refresh_token`: mã hoá;
  - `zalo_token_expires`: không mã hoá, giờ Unix;
  - `channel_account:zalo:<oa_id>:token`: mã hoá, bản token theo từng kênh.
- Lần làm mới token gần nhất: 2026-10-13 12:00.
- `.env` chỉ có 4 khoá: `ENCRYPTION_KEY`, `DB_PATH`, `DIST_DIR`, `PORT`.
- Task 1.5 đã chạy thử: script bun giải mã bằng chính helper của app, chỉ in độ dài (18, 20, 20). Thư mục `/root/oa-export/` đã xoá ngay sau đó.

## 5. Cách tắt app cũ khỏi OA mà không đụng Facebook

- **Trả lời tự động:** app cũ kiểm `channel_accounts.enabled = 1 AND agent_enabled = 1` ở mọi bước của agent (`src/lib/agent-runtime.ts`, `agent-recovery.ts`, `agents.ts`). Đặt `agent_enabled = 0` cho **id 15** là bot cũ ngừng trả lời OA. Facebook (id 2) không bị ảnh hưởng. Đặt thêm `enabled = 0` thì kênh tắt hẳn.
- **Làm mới token:** `refreshZaloTokenIfNeeded` (`src/lib/zalo-connect.ts`) chạy mỗi giờ từ `src/cron.ts` (unit có `CRON_ENABLED=1`). Hàm này đọc khoá chung `settings.zalo_refresh_token`, **không** theo từng kênh, và làm mới khi token còn dưới 3 giờ. Muốn tắt mà không tắt cron của Facebook hay TikTok: xoá dòng `settings` có key `zalo_refresh_token` (sau khi sao lưu). Khi không có refresh token, hàm tự bỏ qua.
- **Webhook:** sau khi Caddy chuyển `/webhooks/zalo` sang Worker, app cũ không còn nhận sự kiện OA nữa.
- Không cần dừng service `webapp-chatbot`, vì Facebook và các trang khác vẫn chạy trên nó.

## 6. Bảng chứa lịch sử OA

- `conversations`: `id, channel, channel_account_id, external_id` (user id Zalo của khách), `name, avatar_url, mode, unread, needs_attention, contact_id, last_message_at, created_at, assigned_user_id, human_until, profile_synced_at, lead_draft_json, lead_draft_message_id`.
- `messages`: `id, conversation_id, channel_account_id, external_message_id, direction` (`in`/`out`), `sender` (`customer`/`ai`/`agent`), `type` (`text`/`image`), `content, image_url, platform_created_at, source` (`live`/`agent`/`manual`/`import`), `attachment_data, created_at, delivered_at, seen_at, platform_created_at_raw`.
- Hồ sơ khách: `conversations.name` và `avatar_url`, cùng `contacts` (`name, phone, email, address, note`) nối qua `contact_identities`.
- So với `docs/vps-schema-snapshot.sql`, DB thật đã khác (có 22 migration đã chạy):
  - `messages` có thêm `delivered_at`, `seen_at`, `platform_created_at_raw`;
  - `conversations` có thêm `human_until`, `profile_synced_at`, `lead_draft_json`, `lead_draft_message_id`, và không còn `ai_insight`, `ai_insight_at`.
  
  Script nhập lịch sử phải đọc theo DB thật, không theo file snapshot. `attachment_data` mặc định là `'[]'`, nên chuỗi này không có nghĩa là có tệp.

## Phát hiện thêm

- **Code trên VPS mới hơn bản clone GitHub (commit d7c9819).** Có 14 file khác nhau (+588/−92 dòng), trong đó có `agent-recovery.ts` (guard 199k), `agent-runtime.ts`, `agent-tools.ts`, `knowledge-rerank.ts`, `guide-images.ts` và `staff-echo.ts`. Bản code đang chạy đã chép về `C:\Users\ABM\AppData\Local\Temp\webapp-chatbot-vps-src`. Phase 4 phải chép guard từ **bản VPS này**, không lấy từ bản clone.
- Agent cũ không chỉ có một file hướng dẫn. Agent 4 gồm:
  - hướng dẫn v14 (30.882 byte);
  - override Zalo (8.309 byte, có chính sách 199k ngay dòng đầu);
  - 9 tài liệu kiến thức (khoảng 104 nghìn ký tự), được chia đoạn và tìm theo câu hỏi (FTS + rerank).
  
  Phase 7 phải đưa cả 9 tài liệu này vào agent GoClaw.
- Đã xuất nội dung vào `D:\Goclaw\plans\261014-tu-van-oa\source\` (có `manifest.md`).

## Câu hỏi còn mở

- OA 15 có 14 lead và 24 bộ nhớ khách trong app cũ. Phase 8 hiện chỉ nhập tin nhắn và hồ sơ khách. Có cần nhập cả lead không?
