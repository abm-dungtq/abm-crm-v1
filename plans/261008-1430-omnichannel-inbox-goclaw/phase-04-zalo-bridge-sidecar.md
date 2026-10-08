---
phase: 4
title: "Sidecar apps/zalo-bridge"
status: pending
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 04: Sidecar `apps/zalo-bridge`

## Goal

Một service Node 22 trên máy Windows giữ phiên Zalo cá nhân cho từng `channel_account`, đẩy sự kiện lên Worker, kéo lệnh, gửi tin với nhịp giống người, gọi GoClaw cục bộ, và tự khởi động khi Windows khởi động lại.

## Nguyên tắc (executor không được đổi)

- Sidecar không quyết định nghiệp vụ: không xét chế độ, không chia người, không lọc khách. Chỉ thực thi lệnh và báo sự kiện.
- Không mở cổng nghe nào. Chỉ gọi ra Worker (`CRM_BASE_URL`) và GoClaw (`GOCLAW_BASE_URL`, mặc định `http://127.0.0.1:18790/v1`).
- Không log nội dung tin nhắn, cookie, token, mã QR. Log chỉ id, loại sự kiện, mã lỗi.
- Phiên Zalo lưu ở `apps/zalo-bridge/.sessions/<accountId>.json`, thư mục này phải nằm trong `.gitignore`.
- Xử lý tuần tự theo hội thoại: hai lệnh của cùng `conversationId` không chạy song song.

## Files to Create / Modify

- Create: `apps/zalo-bridge/package.json` (`name: @abm/zalo-bridge`, `type: module`, scripts `start`, `test`, `typecheck`)
- Create: `apps/zalo-bridge/tsconfig.json`
- Create: `apps/zalo-bridge/src/config.ts` (đọc biến môi trường, kiểm tra bắt buộc)
- Create: `apps/zalo-bridge/src/crm-client.ts` (ký HMAC, `pushEvents`, `pollCommands`, `postResult`)
- Create: `apps/zalo-bridge/src/zalo-client.ts` (adapter duy nhất chạm vào zca-js)
- Create: `apps/zalo-bridge/src/account-manager.ts` (vòng đời phiên từng tài khoản, reconnect có backoff)
- Create: `apps/zalo-bridge/src/goclaw-client.ts` (`POST /chat/completions`)
- Create: `apps/zalo-bridge/src/command-runner.ts` (hàng đợi theo hội thoại, nhịp gửi)
- Create: `apps/zalo-bridge/src/main.ts`
- Create: `apps/zalo-bridge/test/*.test.ts`
- Create: `apps/zalo-bridge/scripts/install-startup-task.ps1`, `apps/zalo-bridge/scripts/start-zalo-bridge.ps1`, `apps/zalo-bridge/scripts/check-syntax.ps1`
- Create: `apps/zalo-bridge/src/goclaw-session-cleanup.ts`
- Create: `apps/zalo-bridge/.env.example` (chỉ tên biến, không giá trị thật)
- Modify: `.gitignore` (thêm `apps/zalo-bridge/.sessions/`, `apps/zalo-bridge/.env`)

## Tasks

### Task 4.1 — Kiểm tra zca-js trước khi cài

- Goal: biết giấy phép và phiên bản hiện hành.
- Steps:
  1. Chạy `npm view zca-js version license repository.url time.modified`.
  2. Nếu license không phải giấy phép mã nguồn mở cho phép dùng thương mại (MIT, Apache-2.0, BSD, ISC) hoặc gói không cập nhật quá 6 tháng: STOP, báo user (đây là cổng quyết định, không tự đổi thư viện).
  3. Đọc README của gói để lấy API: đăng nhập QR, đăng nhập bằng cookie/imei/userAgent đã lưu, listener tin nhắn (có cờ tin của chính mình), gửi tin vào thread user/nhóm, lấy danh sách nhóm. Ghi tên hàm thật vào chú thích đầu `zalo-client.ts`.
- Verify: lệnh `npm view` exit 0 và license thuộc danh sách trên.

### Task 4.2 — Khung package

- Steps:
  1. Tạo `package.json` với `zca-js` (phiên bản ở Task 4.1, ghim chính xác), `zod`, `@abm/contracts: workspace:*`; dev: `typescript`, `vitest`, `tsx`.
  2. Scripts: `start: tsx src/main.ts`, `test: vitest run`, `typecheck: tsc --noEmit`.
  3. `pnpm install` ở gốc repo.
- Verify: `pnpm -F @abm/zalo-bridge typecheck` exit 0 (với `main.ts` tạm `export {}`).

### Task 4.3 — Config

- Target files: `src/config.ts`, `.env.example`.
- Steps: biến bắt buộc `CRM_BASE_URL`, `BRIDGE_SECRET`, `GOCLAW_API_KEY`; tùy chọn `GOCLAW_BASE_URL`, `SEND_MIN_DELAY_MS` (mặc định 1500), `SEND_MAX_DELAY_MS` (4000), `POLL_WAIT_SECONDS` (20). Thiếu biến bắt buộc → thoát mã 1 với thông báo tên biến (không in giá trị).
- Verify: test `config.test.ts`: thiếu `BRIDGE_SECRET` → ném lỗi chứa chữ `BRIDGE_SECRET`; `pnpm -F @abm/zalo-bridge test -- config` exit 0.

### Task 4.4 — CRM client

- Target files: `src/crm-client.ts`.
- Steps:
  1. Ký đúng hợp đồng: `X-Bridge-Timestamp` (giây Unix), `X-Bridge-Signature` = hex HMAC-SHA256(secret, timestamp + '.' + body).
  2. `pushEvents(events)` gửi tối đa 100 sự kiện mỗi lần, lỗi mạng thử lại 3 lần cách 2/4/8 giây rồi giữ trong hàng đợi bộ nhớ để gửi ở vòng sau.
  3. `pollCommands()` gọi `GET /api/bridge/commands?wait=<POLL_WAIT_SECONDS>`.
  4. `postResult(id, result)`.
- Verify: test `crm-client.test.ts` kiểm chữ ký với vector cố định (tính bằng `node:crypto`) và kiểm `pushEvents` cắt 250 sự kiện thành 3 request (mock `fetch`); exit 0.

### Task 4.5 — Adapter zca-js và quản lý tài khoản

- Target files: `src/zalo-client.ts`, `src/account-manager.ts`.
- Steps:
  1. `zalo-client.ts` export interface `ZaloSession { send(threadId, threadKind, text): Promise<{ msgId: string }>; listGroups(): Promise<{ threadId, name }[]>; onMessage(cb); close() }` và hàm `loginWithQr(onQr)` / `loginWithSaved(file)`. Chỉ file này import `zca-js`.
  2. `account-manager.ts`: khi nhận lệnh `zalo_login` → `loginWithQr`, đẩy sự kiện `qr` (ảnh dạng data URL) rồi `account_status: connected` kèm `accountId` (từ lệnh) và `accountExternalId` (uid Zalo của chính số đó, lấy từ API của zca-js) và `group_list`; mọi sự kiện `message` mang `accountExternalId` đó; lưu phiên vào `.sessions`. Khi khởi động, đăng nhập lại mọi phiên đã lưu. Mất kết nối → backoff 5s, 10s, 20s… tối đa 5 phút; sau 10 lần thất bại → `account_status: error`.
  3. Tin đến: chuẩn hoá thành sự kiện `message`. Tin `fromSelf`: giữ 3 giây, nếu `msgId` nằm trong tập id do sidecar vừa gửi thì gắn `commandId` tương ứng. Nếu zca-js không trả `msgId` khi gửi thì vẫn gửi sự kiện không có `commandId`; Worker có cách nhận echo dự phòng theo nội dung (phase 03 quy tắc 4).
  4. `zalo_logout` → đóng phiên, xoá file phiên, `account_status: disconnected`.
- Verify: test `account-manager.test.ts` với `ZaloSession` giả: (a) tin `fromSelf` có id trong tập đã gửi → sự kiện có `commandId`; (b) không có → không có `commandId`; (c) 10 lần lỗi kết nối → sự kiện `error`. Exit 0.

### Task 4.6 — GoClaw client

- Target files: `src/goclaw-client.ts`.
- Steps: `complete({ agentKey, userId, text })` gọi `POST {GOCLAW_BASE_URL}/chat/completions` với `Authorization: Bearer GOCLAW_API_KEY`, `X-GoClaw-User-Id: userId`, body `{ model: 'goclaw:' + agentKey, messages: [{ role: 'user', content: text }], stream: false }`, timeout 180 giây, **không tự retry** (API không có idempotency key). Trả `choices[0].message.content`; rỗng → lỗi.
- Verify: test với `fetch` giả: header đúng, body đúng, rỗng → ném lỗi; exit 0.

### Task 4.7 — Command runner

- Target files: `src/command-runner.ts`, `src/main.ts`.
- Steps:
  1. Vòng lặp: `pollCommands` → đưa từng lệnh vào hàng theo `conversationId` (lệnh không có hội thoại chạy ngay).
  2. `run_completion` → `goclaw.complete` → `postResult(id, { attempts, ok: true, text })`; lỗi → `postResult(id, { attempts, ok: false, error })`. `attempts` lấy từ lệnh đã nhận; mọi `postResult` khác cũng gửi kèm `attempts`.
  3. `send_zalo` → chờ ngẫu nhiên giữa `SEND_MIN_DELAY_MS` và `SEND_MAX_DELAY_MS`, cắt text thành đoạn ≤ 2000 ký tự theo ranh giới dòng (không trim từng đoạn, để echo của mỗi đoạn trùng nguyên các dòng của tin gốc — Worker nhận echo theo dòng nguyên), gửi lần lượt, ghi `msgId` vào tập đã gửi kèm `commandId`, `postResult({ ok: true, externalMsgId })` với id của đoạn đầu.
  4. `zalo_login` / `zalo_logout` → `account-manager`.
  5. `main.ts`: nạp config, khởi động tài khoản đã lưu, chạy vòng lặp, bắt `SIGINT`/`SIGTERM` để đóng phiên sạch.
- Verify: test `command-runner.test.ts`: hai lệnh cùng hội thoại chạy tuần tự (lệnh hai bắt đầu sau khi lệnh một xong); text 4500 ký tự → 3 lần gửi. Exit 0.

### Task 4.8 — Tự khởi động trên Windows

- Target files: `scripts/start-zalo-bridge.ps1`, `scripts/install-startup-task.ps1`.
- Steps:
  1. `start-zalo-bridge.ps1`: nếu đã có tiến trình node chạy `apps/zalo-bridge/src/main.ts` thì thoát (không tạo bản trùng); ngược lại nạp `.env` và chạy `pnpm -F @abm/zalo-bridge start`, ghi log ra `apps/zalo-bridge/logs/bridge.log`.
  2. `install-startup-task.ps1`: tạo Scheduled Task "ABM Zalo Bridge" chạy `start-zalo-bridge.ps1` khi khởi động máy, chạy lại sau 1 phút nếu lỗi. Không chạy script này tự động; đây là bước có cổng đồng ý ở phase 10.
  3. `check-syntax.ps1`: nhận đường dẫn file qua tham số `-Path`, chạy `[System.Management.Automation.Language.Parser]::ParseFile`, in `ok` khi không có lỗi cú pháp, ngược lại in lỗi và thoát mã 1.
- Verify: `pwsh -NoProfile -File apps/zalo-bridge/scripts/check-syntax.ps1 -Path apps/zalo-bridge/scripts/start-zalo-bridge.ps1` in `ok`; lệnh tương tự với `install-startup-task.ps1` in `ok`.

### Task 4.8b — Dọn phiên GoClaw của lệnh stateless

- Goal: phiên `crm-extract:*` và `group-summary:*` trong GoClaw không tăng mãi.
- Target files: `apps/zalo-bridge/src/goclaw-session-cleanup.ts`, `src/main.ts`.
- Steps:
  1. Đọc `D:\Goclaw\source\internal\gateway\methods\sessions.go` (RPC `sessions.list`, `sessions.delete`) và `D:\Goclaw\source\docs\19-websocket-rpc.md` để lấy cách kết nối WebSocket và quyền cần có.
  2. Nếu RPC `sessions.delete` cần quyền quản trị (Gateway Token) chứ không chạy với API key `operator.write`: STOP, báo user (không dùng Gateway Token trong sidecar khi chưa được đồng ý).
  3. Nếu được: mỗi ngày 03:00 giờ Việt Nam, liệt kê phiên có key chứa `crm-extract:` hoặc `group-summary:` cũ hơn 24 giờ và xoá; log số lượng, không log nội dung.
- Verify: test `goclaw-session-cleanup.test.ts` với WebSocket giả: chỉ phiên đúng tiền tố và quá 24 giờ bị gửi lệnh xoá; `pnpm -F @abm/zalo-bridge test -- goclaw-session-cleanup` exit 0.

### Task 4.9 — Hồi quy và commit

- Steps: `pnpm -F @abm/zalo-bridge test`, `pnpm -F @abm/zalo-bridge typecheck`, `git status --short` không có file trong `.sessions` hay `.env`; commit `feat(zalo-bridge): add zalo personal sidecar for the crm inbox`.
- Verify: hai lệnh exit 0; `git ls-files apps/zalo-bridge | grep -c "\.sessions\|\.env$"` in `0`.

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
