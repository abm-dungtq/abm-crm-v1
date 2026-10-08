---
phase: 1
title: "ADR và điều kiện trước"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 01: ADR và điều kiện trước

## Goal

Ba ADR mới được viết và chấp nhận, hai plan đang chạy đã xong phase 05, hồ sơ Meta App Review đã nộp.

## Files to Create / Modify

- Create: `docs/adr/adr-008-zalo-bridge-sidecar.md`
- Create: `docs/adr/adr-009-customer-facing-bot.md`
- Create: `docs/adr/adr-010-leased-command-dispatcher.md`
- Modify: `docs/adr/adr-001-stack-cloudflare-modular-monolith.md` (thêm một dòng "Cập nhật bởi ADR-008, ADR-010" ở cuối mục Hệ quả)
- Modify: `docs/README.md` (thêm 3 ADR vào mục ADR)

## Tasks

### Task 1.1 — Kiểm tra plan chặn

- Goal: biết chắc phase 05 của plan 1457 và 1300 đã `completed`.
- Target files: `plans/261004-1457-crm-bot-gateway/phase-05-rollout-live-test.md`, thư mục `plans/261004-1300-crm-admin-user-auth/` (file `phase-05-*.md`).
- Steps:
  1. Đọc frontmatter `status` của hai file phase 05.
  2. Chạy `git -C D:/TQD/CRM status --short` và `git -C D:/TQD/CRM log --oneline -5`.
- Success criteria: cả hai `status: completed`, working tree sạch.
- Verify: `grep -h "^status:" plans/261004-1457-crm-bot-gateway/phase-05-*.md plans/261004-1300-crm-admin-user-auth/phase-05-*.md` in đúng hai dòng `status: completed`; `git status --short` không in gì. Nếu không đạt: STOP và báo user plan nào chưa xong (đây là chặn hợp lệ, không phải lỗi để tự sửa).
- Quyết định của user (2026-10-08): hai phase 05 vẫn `pending`, nhưng code phase 01–04 của cả hai plan đã xong. User cho làm phase 01–09 của plan này trên máy (code, test, migration `--local`), không đụng remote. Phase 10 vẫn chờ hai phase 05 kia `completed`.

### Task 1.2 — ADR-008 sidecar Zalo

- Goal: ghi quyết định cho phép một service Node ngoài Cloudflare.
- Target files: `docs/adr/adr-008-zalo-bridge-sidecar.md`.
- Steps:
  1. Theo khuôn ADR sẵn có (xem `adr-006-password-login.md`): tiêu đề, `Trạng thái: accepted`, `Ngày: <hôm nay>`, Bối cảnh, Quyết định, Phương án đã xét, Hệ quả.
  2. Bối cảnh: zca-js cần socket sống lâu, Worker không giữ được; GoClaw chạy trên máy Windows.
  3. Quyết định: `apps/zalo-bridge` (Node 22, TypeScript) chạy trên máy Windows cạnh GoClaw; chỉ kéo lệnh qua `/api/bridge/*` có HMAC; không giữ trạng thái nghiệp vụ; gọi GoClaw qua `http://127.0.0.1:18790`; tự khởi động bằng Task Scheduler.
  4. Phương án đã xét: Chatwoot (cần Docker/Redis/Ruby 24/7), vá GoClaw (fork), bot loop trong sidecar (trái ADR-001).
  5. Hệ quả: rủi ro điều khoản Zalo cá nhân (giao thức không chính thức, số có thể bị khóa) được chấp nhận rõ ràng; nhân viên không đăng nhập Zalo PC/Web trên số chung; khi máy Windows tắt, lệnh chờ trong D1.
- Success criteria: file tồn tại, có đủ 5 mục.
- Verify: `grep -c "^## " docs/adr/adr-008-zalo-bridge-sidecar.md` in số ≥ 4 và `grep -o "Zalo" docs/adr/adr-008-zalo-bridge-sidecar.md | wc -l` in số ≥ 3.

### Task 1.3 — ADR-009 bot khách hàng

- Goal: ghi bot khách hàng là loại principal mới, khác bot nhân viên của ADR-004.
- Target files: `docs/adr/adr-009-customer-facing-bot.md`.
- Steps:
  1. Quyết định: chế độ hội thoại `ai`/`human`/`paused`; marker `[HANDOFF: lý do]`; công tắc riêng `customer_bot_switch` (không dùng `agent_kill_switch`); bot chỉ ghi vào `lead_intake`; thông tin mới khác thông tin đã có chỉ được dùng khi nhân viên xác nhận trên giao diện; `contact` và `lead` thật chỉ do nhân viên tạo bằng `createLead` / `createLearnerLead`; bot không bao giờ tự tạo `lead`.
  2. Ghi rõ: hợp đồng brainstorm nói ghi đè "qua approval"; ADR chọn nhân viên xác nhận trong `lead_intake` thay cho bảng `approval` (bảng này chỉ dành cho lead, `lead_id NOT NULL`), chấp nhận được vì bot không bao giờ ghi trực tiếp `contact`/`lead`.
  3. Ghi rõ lịch sử tách đôi và cách xử lý tiền tố `[Nhân viên đã trao đổi: ...]`.
- Success criteria: file có đủ mục, nhắc `customer_bot_switch`, `lead_intake`, `HANDOFF`.
- Verify: `grep -o "customer_bot_switch\|lead_intake\|HANDOFF" docs/adr/adr-009-customer-facing-bot.md | sort -u | wc -l` in `3`.

### Task 1.4 — ADR-010 dispatcher lệnh có lease

- Goal: cập nhật cách thực hiện side effect của ADR-001.
- Target files: `docs/adr/adr-010-leased-command-dispatcher.md`, `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`.
- Steps:
  1. Quyết định: bảng `channel_command` với `status`, `attempts`, `claimed_at`, `lease_expires_at`, `next_run_at`, `dedupe_key`; lệnh `target='bridge'` do sidecar long-poll, lệnh `target='worker'` do Worker xử lý ngay (`waitUntil`) và Cron Trigger mỗi phút thử lại; tối đa 5 lần, backoff 2^attempts phút. Thay "Queues" bằng "Queues hoặc lệnh lease D1"; không cần Workers Paid.
  2. Thêm vào cuối mục Hệ quả của ADR-001 dòng: `Cập nhật: ADR-008 (sidecar Zalo), ADR-010 (dispatcher lệnh lease D1).`
- Verify: `grep -c "ADR-010" docs/adr/adr-001-stack-cloudflare-modular-monolith.md` ≥ 1.

### Task 1.5 — Cập nhật mục lục docs

- Target files: `docs/README.md`.
- Steps: thêm ba dòng liên kết tới ADR-008, 009, 010 theo đúng định dạng các ADR khác.
- Verify: `grep -o "adr-008\|adr-009\|adr-010" docs/README.md | sort -u | wc -l` in `3`.

### Task 1.6 — Nộp Meta App Review (user làm)

- Goal: hồ sơ quyền `pages_messaging` đã nộp.
- Steps:
  1. Nhắc user: tạo hoặc dùng Meta App của doanh nghiệp, thêm sản phẩm Messenger, xin `pages_messaging` (Advanced Access) và tính năng Human Agent, xác minh doanh nghiệp.
  2. Ghi ngày nộp vào `plans/reports/` khi user báo.
- Success criteria: user xác nhận đã nộp.
- Verify: no verification needed (bước của user; phase 09 kiểm kết quả duyệt).

### Task 1.7 — Commit

- Steps: `git add docs/adr docs/README.md` rồi commit `docs(adr): add zalo bridge, customer bot and leased dispatcher decisions`.
- Verify: `git log -1 --format=%s` in đúng thông điệp trên.

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
