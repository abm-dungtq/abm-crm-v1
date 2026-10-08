---
phase: 7
title: "Trích CRM và lead chờ phân loại"
status: pending
priority: P1
effort: "1.5d"
dependencies: [3, 6]
---

# Phase 07: Trích CRM và lead chờ phân loại

## Goal

Agent GoClaw `crm-extractor` trích thông tin khách từ hội thoại vào `lead_intake`. Nhân viên thấy lead chờ phân loại, chọn `b2b` hoặc `learner`, và CRM tạo lead thật bằng lệnh có sẵn (`createLead` hoặc `createLearnerLead`), gắn Zalo ID / Facebook ID vào khách.

## Quy tắc (executor không được đổi)

1. Lần trích chạy khi: handoff; trả lại AI; cron thấy hội thoại `direct` có `last_inbound_at` cũ hơn 15 phút và mới hơn `last_extracted_at` (hoặc chưa trích); nhân viên bấm "Cập nhật CRM".
2. Lệnh: `run_completion` `target='bridge'`, `payload = { agentKey: 'crm-extractor', userId: 'crm-extract:' + crypto.randomUUID(), conversationId, purpose: 'extract', text }`, `dedupe_key = 'extract:' + conversationId + ':' + <id tin cuối>`. `text` = hướng dẫn ngắn + 60 tin gần nhất dạng `Khách: ...` / `Bot: ...` / `Nhân viên: ...`.
3. Kết quả `purpose='extract'`: bỏ rào ```` ``` ```` nếu có, `JSON.parse`, kiểm bằng zod `{ name?, phone?, email?, need?, interest?, note? }` (chuỗi, cắt khoảng trắng, độ dài như `createLeadInput`). Không hợp lệ → `failCommand` lỗi `EXTRACT_INVALID`, không ghi gì.
4. Một hội thoại có tối đa một `lead_intake` `pending`. Trường đang trống thì điền luôn. Trường đã có giá trị khác thì lưu vào `fields_json.proposed[<field>]`; giá trị chính chỉ đổi khi nhân viên bấm xác nhận trên giao diện.
5. Lead thật chỉ được tạo bởi nhân viên (actor `human`) qua `runCommand` với `createLead` (pipeline `b2b`) hoặc `createLearnerLead` (pipeline `learner`), `source` = `zalo` hoặc `facebook`. Form điền sẵn từ `lead_intake`; nhân viên bổ sung trường bắt buộc (SĐT hoặc email, `nextAction` với learner).
6. Lệnh thành công: `lead_intake.status='classified'`, `lead_id`, `classified_by_user_id`, `classified_at`; `conversation.contact_id = lead.contact_id`; chèn `contact_point` (`zalo_uid` = `conversation.external_thread_id` hoặc `fb_psid`) nếu chưa có; ghi `activity` vào lead với 20 tin gần nhất làm ghi chú.
7. Lỗi `DUPLICATE_SUSPECTED` từ lệnh có sẵn → trả lỗi đó về giao diện như trang tạo lead đang làm; không tự đặt `confirmNotDuplicate`. Giao diện cho nhân viên hai lựa chọn: "Vẫn tạo lead mới" (gửi lại với `confirmNotDuplicate: true` do chính nhân viên bấm) hoặc "Gắn vào khách có sẵn".
8. "Gắn vào khách có sẵn" (`POST /inbox/intakes/:id/link-contact` `{ contactId }`, kiểm `customerScope` của actor): gắn `conversation.contact_id`, chèn `contact_point` kênh nếu chưa có, `lead_intake.status='classified'` với `lead_id` NULL. Với pipeline `learner` có thể truyền `contactId` sẵn có vào `createLearnerLead`.

## Files to Create / Modify

- Modify: `apps/crm/seed/cleanup-demo.sql` và `apps/crm/test/demo-cleanup.test.ts`: trước khi xoá contact/lead demo, `UPDATE conversation SET contact_id = NULL WHERE contact_id` thuộc contact demo (không xoá hội thoại), `DELETE FROM lead_intake WHERE lead_id` thuộc lead demo `OR contact_id` thuộc contact demo, và xoá `audit_log` của các `lead_intake` đó. Thêm test: gắn một hội thoại vào contact demo, chạy cleanup, `PRAGMA foreign_key_check` rỗng và hội thoại vẫn còn. Không thêm bảng inbox vào `BUSINESS_EMPTY_TABLES`.
- Create: `apps/crm/migrations/0015_conversation_extracted_at.sql` (`ALTER TABLE conversation ADD COLUMN last_extracted_at TEXT;`)
- Create: `apps/crm/src/worker/inbox/intake.ts` (`enqueueExtraction`, `applyExtractionResult`, `classifyIntake`, `discardIntake`, `confirmProposedField`)
- Create: `apps/crm/src/web/pages/intakes.tsx` (danh sách lead chờ phân loại)
- Create: `apps/crm/src/web/components/intake-card.tsx` (thẻ ở cột phải Inbox + form phân loại)
- Create: `apps/crm/test/inbox-intake.test.ts`
- Create: `docs/integrations/goclaw-inbox-agents.md` (prompt cho agent khách hàng, `crm-extractor`, `group-summarizer`)
- Modify: `apps/crm/src/worker/inbox/bridge-routes.ts` (kết quả `purpose='extract'` → `applyExtractionResult`)
- Modify: `apps/crm/src/worker/inbox/conversation-flow.ts` (`handoff` và `setMode('ai')` gọi `enqueueExtraction`)
- Modify: `apps/crm/src/worker/inbox/scheduled.ts` (quét hội thoại im 15 phút)
- Modify: `apps/crm/src/worker/inbox/inbox-routes.ts` (`GET /inbox/intakes?status=pending`, `POST /inbox/intakes/:id/classify`, `POST /inbox/intakes/:id/discard`, `POST /inbox/intakes/:id/confirm-field`, `POST /inbox/intakes/:id/link-contact`, `POST /inbox/conversations/:id/extract`)
- Modify: `apps/crm/src/web/router.tsx`, `apps/crm/src/web/components/layout.tsx` (mục "Lead chờ phân loại" cho role xem Inbox), `apps/crm/src/web/pages/inbox.tsx`, `apps/crm/src/web/api.ts`
- Modify: `docs/README.md` (liên kết tài liệu agent)

## Tasks

### Task 7.1 — Đọc lệnh có sẵn

- Target files: `packages/contracts/src/index.ts` (`createLeadInput`, `createLearnerLeadInput`), `apps/crm/src/worker/commands.ts` (`runCommand`), `apps/crm/src/worker/learner-commands.ts`, `apps/crm/src/web/pages/lead-new.tsx`, `apps/crm/src/web/pages/learner-new.tsx`.
- Steps: ghi lại trường bắt buộc, cách `runCommand` nhận `idempotencyKey`, cách trang tạo lead hiển thị `DUPLICATE_SUSPECTED`, và kết quả trả về chứa id lead ở đâu.
- Verify: no verification needed.

### Task 7.2 — Migration

- Verify: `cd apps/crm && npx wrangler d1 migrations apply abm-crm-eval --local` exit 0 và in `0015_conversation_extracted_at.sql`.

### Task 7.3 — Module intake

- Target files: `apps/crm/src/worker/inbox/intake.ts` và các file Modify phía Worker.
- Steps: hiện thực quy tắc 1–7. `classifyIntake(db, actor, intakeId, { pipeline, input })` gọi `runCommand(db, actor, pipeline === 'b2b' ? 'createLead' : 'createLearnerLead', input, 'intake:' + intakeId)` rồi áp quy tắc 6 khi kết quả `ok`.
- Verify: Task 7.5.

### Task 7.4 — Tài liệu prompt agent

- Target files: `docs/integrations/goclaw-inbox-agents.md`.
- Steps: viết ba mục:
  1. Agent khách hàng: vai trò tư vấn/CSKH, chỉ trả lời theo kiến thức đã duyệt, không bịa giá/chính sách; khi khách cần người, hỏi ngoài kiến thức, phàn nàn, muốn chốt đơn hoặc yêu cầu gặp nhân viên thì kết thúc câu trả lời bằng **một dòng riêng** `[HANDOFF: <lý do ngắn>]`; không bao giờ nhắc chữ "HANDOFF" trong câu khác.
  2. `crm-extractor`: chỉ trả **một** JSON object với các khoá `name`, `phone`, `email`, `need`, `interest`, `note`; khoá không có thông tin thì bỏ; không thêm chữ ngoài JSON; chỉ lấy thông tin do khách nói.
  3. `group-summarizer`: tóm tắt tin nhóm trong ngày thành tối đa 8 gạch đầu dòng tiếng Việt: chủ đề chính, câu hỏi chưa ai trả lời, khách cần liên hệ lại; không chép số điện thoại.
  4. Ghi: cả ba dùng provider/model `deepseek-flash`; agent `crm-extractor` và `group-summarizer` không có tool nào.
- Verify: `grep -o "HANDOFF\|crm-extractor\|group-summarizer" docs/integrations/goclaw-inbox-agents.md | sort -u | wc -l` in `3`.

### Task 7.5 — Test

- Target files: `apps/crm/test/inbox-intake.test.ts`.
- Steps:
  1. Handoff tạo một lệnh `run_completion` `purpose='extract'`, `userId` bắt đầu bằng `crm-extract:`.
  2. Kết quả JSON có rào ```` ```json ```` → `lead_intake` có `name`, `phone`.
  3. Kết quả không phải JSON → không có `lead_intake`, lệnh lỗi `EXTRACT_INVALID`.
  4. Lần trích thứ hai có `phone` khác → giá trị chính giữ nguyên, `proposed.phone` có giá trị mới; `confirm-field` → giá trị chính đổi.
  5. `classify` `b2b` → có `lead` `pipeline='b2b'`, `contact_point` `zalo_uid`, `conversation.contact_id` khớp, `lead_intake.status='classified'`.
  6. `classify` `learner` thiếu `nextAction` → 422, intake vẫn `pending`.
  7. Cron với hội thoại im 16 phút → một lệnh trích; chạy lại → không thêm.
  8. `link-contact` với contact trong phạm vi → `conversation.contact_id` khớp, có `contact_point` `zalo_uid`, intake `classified`; contact ngoài phạm vi → 404.
- Verify: `pnpm -F @abm/crm test -- inbox-intake` exit 0.

### Task 7.6 — UI

- Target files: các file web ở mục Files.
- Steps: thẻ "Lead chờ phân loại" ở cột phải Inbox hiện các trường, giá trị đề xuất có nút "Dùng giá trị mới", nút "Tạo lead B2B", "Tạo lead học viên", "Bỏ qua"; nút mở form điền sẵn (dùng lại thành phần form của `lead-new.tsx` / `learner-new.tsx` nếu tách được, nếu không thì form riêng với đúng trường bắt buộc). Trang `/intakes` liệt kê intake `pending` có link tới hội thoại.
- Verify: `pnpm -F @abm/crm build` exit 0.

### Task 7.7 — Hồi quy và commit

- Steps: `pnpm -F @abm/crm test`, `typecheck`, `build`; commit `feat(crm): add chatbot lead intake with staff classification`.
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
