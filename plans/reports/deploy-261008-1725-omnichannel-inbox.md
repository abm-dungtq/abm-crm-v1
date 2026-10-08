# Deploy 2026-10-08 17:25: inbox đa kênh lên eval (đợt A, phần Worker)

Plan: `plans/261008-1430-omnichannel-inbox-goclaw/phase-10-rollout-pilot.md`. Trình tự và điều kiện bảo vệ: `plans/reports/brainstorm-261008-1710-eval-rollout-sequence.md`.
User đồng ý trong chat ("cook xong thì push lên cloudflare") cho backup, migration remote và deploy. Chưa đổi gì ở GoClaw, chưa cài Scheduled Task, chưa quét QR.

## Kiểm tra chỉ đọc trước khi chạy

| Mục | Kết quả |
|---|---|
| Migration chờ trên eval | 0012–0017 |
| Bản Worker đang chạy | `be2f8e11` |
| Secret (chỉ tên) | `LARK_APP_ID`, `LARK_APP_SECRET` |
| Người dùng đã liên kết Lark | admin 2, leader 2, sale 3, academic 1 |
| `/api/health` eval | `{"ok":true}` |
| GoClaw `/health` | `{"status":"ok","protocol":3}` |

## Task 10.1: diễn tập rồi migration

**Diễn tập trên D1 tạm `abm-crm-rehearsal`:**
- Nạp nguyên file export bị lỗi `{"D1_RESET_DO":true}` ba lần liền, kể cả khi chờ trước. Lần đầu không phát hiện kịp nên đã áp migration lên DB rỗng; lần đó bị loại và D1 tạm được tạo lại.
- Cách đã chạy được: export riêng schema (`--no-data`) và dữ liệu (`--no-schema`). Nạp schema, rồi nạp dữ liệu đã sắp theo thứ tự bảng cha trước bảng con. Bản sắp xếp là file tạm và đã xoá; file backup gốc giữ nguyên.
- Sau khi nạp: số dòng khớp eval (contact_point 92, contact 46, lead 46, app_user 17, activity 154), `d1_migrations` có 11 dòng.
- Áp 0012–0017 đều đạt. `foreign_key_check` rỗng. `contact_point` vẫn 92 dòng, index `contact_point_lookup` còn, ràng buộc CHECK đã có `zalo_uid` và `fb_psid`.
- D1 tạm đã xoá.

**Eval:**
- Backup: `exports/abm-crm-eval-before-0012-20261008-1721.sql` (505 194 byte, 92 dòng `contact_point`). Bookmark time travel ngay trước migration: `00000058-00000000-000050fe-1e36ff7d0a0234d75f630ad2bb7efa2f`.
- Còn có các export cùng ngày: `abm-crm-eval-before-inbox-20261008-1713.sql`, `abm-crm-eval-schema-20261008.sql`, `abm-crm-eval-data-20261008.sql`.
- `migrations apply` đủ 6 file, exit 0. `foreign_key_check` rỗng. Số dòng contact_point 92, contact 46, lead 46, app_user 17 (không đổi). `customer_bot_switch` 1 dòng, `inbox_setting` 1 dòng.

## Task 10.2: cấu hình

- `APP_URL` đặt trong `vars` của `apps/crm/wrangler.jsonc` (commit `3127b52`).
- **Còn chờ user:** tạo nhóm Lark "Inbox", thêm bot vào nhóm, rồi tự chạy `npx wrangler secret put BRIDGE_SECRET` và `npx wrangler secret put LARK_INBOX_CHAT_ID`.
- Khi chưa có hai secret này: bridge trả 401 với mọi request, và thông báo Lark của inbox lỗi `LARK_NOT_CONFIGURED`. Không ảnh hưởng tới các phần khác.

## Task 10.3: deploy

- 455 test đạt, typecheck sạch.
- Lệnh `pnpm -F @abm/crm deploy` lỗi `ERR_PNPM_INVALID_DEPLOY_TARGET` vì pnpm 12 có sẵn lệnh `deploy`. Lệnh đúng là `pnpm -F @abm/crm run deploy`.
- Version `da4b119e-cc42-4131-bac5-023f3704129a`. Cron `* * * * *` và `0 14 * * *` đã đăng ký.
- Smoke: `/api/health` `{"ok":true}`; `GET /` 200; `/api/inbox/conversations` không cookie 401; `/api/bridge/commands` không chữ ký 401; webhook Facebook verify token sai 403; `/api/mcp` không Bearer 401.

## Lưu ý vận hành

- Từ giờ không time-travel restore D1 khi sidecar đã chạy, và không `wrangler rollback` khi Scheduled Task "ABM Zalo Bridge" còn chạy.
- Rollback trước khi có sidecar: `npx wrangler rollback` về `be2f8e11` vẫn an toàn, vì các bảng mới chỉ được thêm vào.

## Việc còn lại của đợt A

1. **User:** nhóm Lark Inbox và hai secret (Task 10.2).
2. **Task 10.4 GoClaw (cần đồng ý riêng):**
   - backup DB GoClaw;
   - tạo agent khách hàng, `crm-extractor`, `group-summarizer`;
   - cấu hình embedding;
   - API key không gắn owner;
   - đặt `rate_limit_rpm` 120 ở DB và `config.json`;
   - gỡ grant `abm-crm-poc`;
   - tắt kênh native.
3. **Task 10.5:** user điền `apps/zalo-bridge/.env`; cài Scheduled Task (cần đồng ý).
4. **Task 10.6:** thêm 2 số Zalo pilot, quét QR (cần đồng ý).
5. **Task 10.7:** chạy 6 kịch bản thật.

## Ghi chú sau rà soát
- `wrangler tail` 75 giây: cron `* * * * *` chạy, outcome `ok`, không có `scheduled_task_error` hay exception.
- Cron mỗi phút hiện không làm gì: các bảng inbox đều rỗng, `/api/bridge/*` trả 401 khi chưa có `BRIDGE_SECRET`, nên không có lệnh nào được tạo và không gọi Lark.
- Mỗi lần `wrangler secret put` tạo ra một version Worker mới. Sau Task 10.2 cần ghi lại version id mới; mốc rollback `be2f8e11` vẫn dùng được.
- `LARK_INBOX_CHAT_ID` là điều kiện bắt buộc trước khi quét QR ở Task 10.6.
- Task 10.4 không phụ thuộc secret của CRM nên có thể chạy song song với Task 10.2. Không đổi `rate_limit_rpm` (việc này khởi động lại GoClaw) khi luồng 1457 đang test.

## Task 10.4: GoClaw (2026-10-08, user đồng ý "cứ làm xong hết")

- Backup: `D:\Goclaw\backups\goclaw-before-inbox-agents-20261008.dump` (pg_dump, 831 mục TOC) và `D:\Goclaw\backups\config.json.bak-20261008-inbox`.
- Agent mới (provider/model `deepseek-flash`, self-evolve tắt):
  - `sale-tu-van`: chỉ có tool `datetime`, bộ nhớ bật.
  - `crm-extractor`, `group-summarizer`: không có tool, bộ nhớ tắt.
  - Prompt lấy từ `docs/integrations/goclaw-inbox-agents.md` và nằm trong `SOUL.md` của từng agent.
- `gateway.rate_limit_rpm`: 20 → 120, sửa ở cả system config và `D:\Goclaw\config.json`. Sau khi khởi động lại GoClaw, giá trị vẫn là 120.
- API key `zalo-bridge`: scope `operator.read` + `operator.write`, không gắn owner. Script ghi thẳng key vào `apps/zalo-bridge/.env` (file bị git bỏ qua), không in ra.
- Grant `abm-crm-poc`: đã có 0 grant từ trước, không cần gỡ. Agent `crm-sales-poc` vẫn giữ grant `abm-crm-main`.
- GoClaw không có kênh native `zalo_personal` hay `facebook`; chỉ có `abm-lark` (feishu) và `tqd` (telegram).
- **Chưa làm:** embedding `text-embedding-3-small`. GoClaw chưa có provider OpenAI, nên user cần tự thêm API key OpenAI trong Web UI GoClaw. Pilot hiện chưa nạp kiến thức nên việc này không chặn.
- Verify: gọi `POST /v1/chat/completions` bằng key sidecar, `model = goclaw:crm-extractor`, transcript mẫu → HTTP 200, JSON có `name`, `phone`, `need`, `interest`, `note`.
- Script dùng để cài đặt: `D:\Goclaw\plans\261008-inbox-agents\setup-inbox-agents.mjs` và `verify-inbox-agents.mjs`.

## Task 10.2 (một phần) và 10.5

- `BRIDGE_SECRET` được sinh ngẫu nhiên, ghi vào `apps/zalo-bridge/.env` và `wrangler secret put` qua stdin (không in). Version Worker mới là `88f78b4c-d4b2-49bd-92b8-5eea8f5d431e` (Secret Change). Hiện có các secret `BRIDGE_SECRET`, `LARK_APP_ID`, `LARK_APP_SECRET`. **Còn thiếu `LARK_INBOX_CHAT_ID`.**
- Scheduled Task: `install-startup-task.ps1` cần PowerShell chạy quyền Administrator và báo `Access is denied` trong phiên agent. Script đã được sửa để báo lỗi thay vì in "Registered" khi đăng ký thất bại.
- Sidecar đang được chạy tạm bằng `start-zalo-bridge.ps1` trong phiên agent. `wrangler tail` thấy `/api/bridge/commands` trả 200 hai lần, log không có `commands.poll_failed`.
