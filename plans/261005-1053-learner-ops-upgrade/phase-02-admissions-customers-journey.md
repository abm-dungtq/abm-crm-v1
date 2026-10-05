---
phase: 2
title: "Tuyển sinh: danh sách khách, hành trình 8 bước, giữ khách 3 tháng, sản phẩm trên khách, hợp đồng đối tác"
status: pending
priority: P1
effort: "3d"
dependencies: [1]
---

# Phase 02: Tuyển sinh

## Goal

Sale và Leader làm trọn luồng tuyển sinh theo PRD §2-§6:

- tạo khách và lead học viên;
- tìm và lọc danh sách khách;
- đi hành trình;
- giữ khách 3 tháng, nhận khách từ hồ chung;
- gắn sản phẩm cho khách;
- chốt thắng, mất hoặc không phù hợp;
- quản lý hợp đồng đối tác và nhập học viên từ CSV.

Mọi lệnh chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0007_admissions.sql`
- Create: `apps/crm/src/worker/learner-hold.ts` (tính hạn giữ khách)
- Create: `apps/crm/src/worker/learner-commands.ts` (các handler của luồng học viên)
- Create: `apps/crm/src/worker/learner-queries.ts` (các truy vấn của luồng học viên)
- Modify: `apps/crm/src/worker/commands.ts` (đăng ký handler mới vào map `handlers`; `changeStage` từ chối lead `learner`)
- Modify: `apps/crm/src/worker/index.ts` (route GET mới)
- Modify: `apps/crm/src/worker/queries.ts` (`leadHealth` trả về không có SLA với lead `learner`; `search` che số điện thoại)
- Modify: `packages/contracts/src/index.ts` (schema và `COMMANDS` mới)
- Modify: `apps/crm/test/helpers/reset-db.ts` (thêm bảng mới)
- Create: `apps/crm/src/web/pages/learners.tsx`, `learner-new.tsx`, `learner-detail.tsx`, `partners.tsx`, `partner-detail.tsx`
- Modify: `apps/crm/src/web/router.tsx`, `apps/crm/src/web/components/layout.tsx`
- Create: `apps/crm/test/learner-hold.test.ts`, `apps/crm/test/admissions.test.ts`

## Tasks

### Task 2.1: Migration 0007

- Goal: có bảng cho bước hành trình và hợp đồng đối tác.
- Target: `apps/crm/migrations/0007_admissions.sql`.
- Steps:
  1. `lead_step`:
     - cột: `id`, `lead_id` (FK lead), `step_code TEXT NOT NULL`, `label TEXT NOT NULL`, `required INTEGER NOT NULL`, `position INTEGER NOT NULL`, `template_version INTEGER NOT NULL`, `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','skipped'))`, `skip_reason TEXT`, `done_at TEXT`, `done_by_user_id TEXT`, `created_at`, `updated_at`, `version`, `last_txn_id`;
     - `UNIQUE (lead_id, step_code)`.
  2. `partner_contract`:
     - cột: `id`, `organization_id`, `account_id` (FK account), `name TEXT NOT NULL`, `status TEXT NOT NULL CHECK (status IN ('draft','active','done','cancelled'))`, `starts_on TEXT`, `ends_on TEXT`, `note TEXT`, `created_by_user_id`, `created_at`, `updated_at`, `version`, `last_txn_id`.
  3. `partner_contract_step`:
     - cột: `id`, `contract_id` (FK partner_contract), `name TEXT NOT NULL`, `position INTEGER NOT NULL`, `done_at TEXT`, `done_by_user_id TEXT`, `created_at`, `updated_at`, `version`, `last_txn_id`.
  4. Tạo index `lead(pipeline, contact_id)` và `partner_contract(account_id, status)`.
  5. Thêm 3 bảng mới vào `TABLES` trong `reset-db.ts`, đặt trước `lead` và `account`.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 2.2: Tính hạn giữ khách

- Goal: hàm thuần, dễ test.
- Target: `apps/crm/src/worker/learner-hold.ts`.
- Steps:
  1. Export `holdExpiry(startIso: string): string`. Hàm cộng **3 tháng lịch** theo giờ `Asia/Ho_Chi_Minh` và giữ nguyên giờ, phút, giây.
     - Nếu ngày đích không có trong tháng đích thì lấy ngày cuối tháng đích.
     - Kết quả trả về là ISO UTC.
     - Giờ Việt Nam là UTC+7 và không có giờ mùa hè. Có thể cộng 7 giờ, tính trên các trường UTC, rồi trừ lại 7 giờ.
  2. Export `isHeld(contact: {owner_user_id, hold_expires_at}, hasWonLead: boolean, now: Date): boolean`. Trả về `true` khi khách có owner và một trong hai điều kiện sau đúng: `hasWonLead`, hoặc `hold_expires_at > now`.
- Verify: no verification needed (Task 2.8).

### Task 2.3: Hợp đồng dùng chung cho tuyển sinh

- Goal: có schema cho mọi lệnh tuyển sinh.
- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm các schema zod sau:
     - `createLearnerLeadInput`: `{ contactId?, contactName?, phone?, email?, source, partnerContractId?, sourceNote?, needSummary, productIds?: id[], nextAction, ownerUserId? }`.
       - Phải có `contactId` hoặc `contactName`.
       - `source === 'partner'` thì bắt buộc có `partnerContractId`.
       - `ownerUserId` chỉ dành cho Admin.
     - `markJourneyStepInput`: `{ leadId, version, stepCode: 'contacted' | 'need_confirmed' }`.
     - `skipTrialInput`: `{ leadId, version, reason: text(500) }`.
     - `winLearnerLeadInput`: `{ leadId, version, note? }`.
     - `closeLearnerLeadInput`: `{ leadId, version, outcome: 'lost' | 'not_fit', reason: enum LEARNER_LOST_REASONS, note? }`. Khi `reason === 'other'` thì `note` bắt buộc.
     - `claimCustomerInput`: `{ contactId, version }`.
     - `changeCustomerOwnerInput`: `{ contactId, version, ownerUserId }`.
     - `attachProductInput`: `{ contactId, productId }`.
     - `detachProductInput`: `{ customerProductId, version }`.
     - `upsertPartnerContractInput`: `{ id?, version?, accountId?, accountName?, name, status, startsOn?, endsOn?, note? }`.
     - `addContractStepInput`: `{ contractId, name }`.
     - `toggleContractStepInput`: `{ stepId, version, done: boolean }`.
     - `importContractLearnersInput`: `{ contractId, csv: string (≤512KB), commit: boolean }`.
  2. Thêm vào `COMMANDS`. Mọi lệnh đều có `expectedVersion` đúng với việc input có `version` hay không.

     | Lệnh | Roles | `agentNeedsApproval` |
     |---|---|---|
     | `createLearnerLead` | sale, leader, admin | false |
     | `markJourneyStep` | sale, leader, admin | false |
     | `skipTrial` | sale, leader, admin | false |
     | `winLearnerLead` | sale, leader, admin | true |
     | `closeLearnerLead` | sale, leader, admin | true |
     | `claimCustomer` | sale, leader | false |
     | `changeCustomerOwner` | leader, admin | true |
     | `attachProduct`, `detachProduct` | sale, leader, admin | false |
     | `upsertPartnerContract`, `addContractStep`, `toggleContractStep`, `importContractLearners` | sale, leader, admin | false |
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 2.4: Handler tuyển sinh

- Goal: mọi quy tắc của PRD §2-§6 được kiểm ở backend.
- Target: `apps/crm/src/worker/learner-commands.ts`. Export object `learnerHandlers`. Trong `commands.ts`, gộp object này vào map `handlers`, theo đúng kiểu `Handler<…>` đang dùng.
- Steps:
  1. **`createLearnerLead`**
     - Owner là actor. Riêng Admin thì owner là `ownerUserId`, và người đó phải là `sale`/`leader` đang hoạt động.
     - `department_id` và `team_id` lấy theo owner.
     - **Nếu có `phone`**, tìm `contact` đã có số này qua `contact_point`, và khách đó có lead `learner`.
       - Khách đang được người khác giữ (`isHeld` và owner khác actor): trả `fail('FORBIDDEN', 'Khách đang do sale khác giữ')`. Không trả tên sale.
       - Khách ở hồ chung: trả `fail('VALIDATION_FAILED', 'Khách đang ở hồ chung, hãy bấm Nhận trước')`.
       - Khách của chính actor: dùng lại `contact` đó.
     - Khách mới: tạo `contact` theo mẫu `createLead` (`commands.ts` khoảng dòng 290-300), gán `owner_user_id`, `hold_started_at = now`, `hold_expires_at = holdExpiry(now)`.
     - Khách cũ của chính actor: không đổi hạn giữ.
     - Nguồn `partner`: kiểm `partner_contract.status = 'active'` bằng `tx.assert` hoặc đọc trước rồi `fail`. Gán `lead.partner_contract_id`.
     - Ghi `sourceNote` vào `need_summary` theo dạng `"<need> — Nguồn: <note>"`. Không thêm cột mới.
     - Tạo lead `pipeline = 'learner'`, `stage = 'new'`, `status = 'active'`, cùng task Next Action. Mẫu code lead và task lấy từ `createLead`.
     - Tạo 8 dòng `lead_step` từ `LEARNER_JOURNEY`. Bước `recorded` có `status = 'done'`, các bước còn lại `open`.
     - Gắn các `productIds` còn bán bằng `customer_product`.
     - Ghi audit và activity.
  2. **`markJourneyStep`**
     - Lead phải là `learner` và thuộc quyền sửa của actor: owner, Leader cùng nhóm, hoặc Admin.
     - `contacted`: chỉ khi `recorded` đã `done`. Đánh `done` rồi chuyển stage sang `contacted`.
     - `need_confirmed`: chỉ khi `contacted` đã `done`. Đánh `done` rồi chuyển stage sang `qualified`.
     - Bước khác trả `FORBIDDEN` với câu "Bước này tự xong".
     - Cập nhật `stage_entered_at`. Ghi activity `stage_changed`.
  3. **`skipTrial`**: chỉ khi `need_confirmed` đã `done`. Đặt bước `trial` thành `skipped` kèm `skip_reason`.
  4. **`winLearnerLead`**
     - Điều kiện: `need_confirmed` đã `done`, `trial` là `done` hoặc `skipped`, lead có owner và có `contact_id`.
     - Thiếu điều kiện thì trả `VALIDATION_FAILED` và nêu rõ bước còn thiếu.
     - Đặt `stage = 'won'`, `status = 'won'`, `closed_at`. Đóng các task đang mở theo mẫu `changeStage` khi `won`. Bước `enrolled` thành `done`.
  5. **`closeLearnerLead`**: đặt `stage = outcome`, `status = 'lost'`, `lost_reason`, `lost_note`, `closed_at`. Đóng task đang mở.
  6. **`claimCustomer`**
     - Chỉ khi khách **không** `isHeld`.
     - Đặt owner là actor, reset `hold_started_at` và `hold_expires_at`.
     - Mọi lead `learner` đang `active` của khách đổi `owner_user_id`, `team_id`, `department_id` theo actor.
     - Task đang mở đổi `assignee_user_id`.
     - Ghi activity `owner_changed` lên từng lead.
  7. **`changeCustomerOwner`**
     - Leader chỉ đổi khi owner cũ **và** owner mới cùng nhóm với mình. Admin đổi được mọi khách.
     - Reset hạn giữ 3 tháng. Lead và task đổi theo như `claimCustomer`.
  8. **`attachProduct` / `detachProduct`**
     - Chỉ owner đang giữ, Leader cùng nhóm hoặc Admin.
     - Sản phẩm phải còn bán.
     - Gỡ thì đặt `detached_at`, không xóa dòng.
     - Gắn lại thì tạo dòng mới.
  9. **Lệnh đối tác**
     - `upsertPartnerContract`: có `accountName` mà không có `accountId` thì tạo `account` mới.
     - `addContractStep`: `position` là max + 1.
     - `toggleContractStep`: đặt hoặc xóa `done_at`.
  10. **`importContractLearners`**
      - Hợp đồng phải đang `active`.
      - Đọc CSV có header `Họ tên,Số điện thoại,Email,Nhu cầu`. Tái dùng bộ đọc dấu phân cách và `foldText` của `roster.ts` (`parseRosterCsv` dòng 76-100). Tối đa `ROSTER_MAX_ROWS` dòng.
      - Mỗi dòng đi đúng logic của `createLearnerLead` với `source = 'partner'`. Owner là actor. Next Action mặc định là "Liên hệ học viên đối tác", hạn +1 ngày.
      - Dòng nào trùng số điện thoại với khách đang được người khác giữ hoặc đang ở hồ chung thì báo lỗi ở dòng đó và không tạo.
      - `commit: false` trả bản xem trước gồm `{create, errors}`. `commit: true` ghi tất cả trong **một** `GuardedTx`.
- Success criteria: test ở Task 2.8 xanh.
- Verify: no verification needed (Task 2.8).

### Task 2.5: Giữ luồng B2B không đổi

- Goal: lệnh B2B không đụng tới lead học viên.
- Target: `apps/crm/src/worker/commands.ts` (`changeStage`, `assignLead`, `releaseLead`, `requestOwnerChange`), `apps/crm/src/worker/queries.ts` (`leadHealth`).
- Steps:
  1. Trong 4 handler trên, sau khi đọc lead: nếu `pipeline === 'learner'` thì trả `fail('VALIDATION_FAILED', 'Lead học viên đi theo hành trình học viên')`.
  2. `leadHealth`: với lead `learner` thì trả trạng thái không có cảnh báo SLA. Dùng giá trị "ok" đang có trong type `LeadHealth`. Đọc file để biết đúng tên giá trị.
  3. Thêm `l.pipeline` vào các SELECT mà `leadHealth`/`toLeadItem` dùng.
- Verify: no verification needed (Task 2.8).

### Task 2.6: Truy vấn danh sách khách và hợp đồng

- Goal: có API cho PRD §3 và §6.
- Target: `apps/crm/src/worker/learner-queries.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. `GET /learners?view=mine|pool&q=&owner=&stage=&course=`
     - Mỗi khách lấy **lead `learner` mới nhất** bằng `ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at DESC)`, và khách chưa `archived_at`.
     - Cột trả về: `contactId`, `name`, `phone`, `ownerName` ("Chưa gắn" khi ở hồ chung), `stage` và nhãn chữ, `course`, `source`, `contract` (tên hợp đồng), `holdExpiresAt`, `version`.
     - `course`: phase 03 sẽ thêm tên khóa từ ghi danh chưa kết thúc. Ở phase này chỉ trả tên các sản phẩm đang gắn, nối bằng dấu phẩy.
     - `view=mine` (mặc định cho sale) dùng `customerScope`.
     - `view=pool` trả khách **không** `isHeld`. Tính trong SQL: `c.hold_expires_at <= ? AND NOT EXISTS (SELECT 1 FROM lead WHERE contact_id = c.id AND pipeline = 'learner' AND stage = 'won')`.
     - Sale không được lọc theo `owner`. Bỏ qua tham số này khi role là `sale`.
     - Admin thấy mọi khách và lọc được theo sale.
     - `q` khớp tên đã gập dấu bằng `foldText` hoặc khớp số điện thoại chuẩn hóa. Tham khảo `searchMatcher` (`queries.ts` dòng 149).
     - **Che số điện thoại:** trả `phone: null` khi khách đang được người khác giữ và actor không phải Admin, cũng không phải Leader của nhóm owner.
  2. `GET /learners/:contactId`: trả hồ sơ, tất cả lead `learner` cùng các bước, sản phẩm đang gắn, sản phẩm đã gỡ, đồng ý mới nhất theo từng mục đích, activity.
     - Áp cùng quy tắc che số điện thoại.
     - Sale khác chỉ xem được khi khách ở hồ chung. Lúc đó trả tên, nguồn và stage, không trả activity.
  3. `GET /partners` và `GET /partners/:id`: trả hợp đồng, các bước và danh sách học viên của hợp đồng, tức là các lead có `partner_contract_id` bằng id này. Danh sách học viên áp quy tắc che số điện thoại.
  4. `search` (`queries.ts` dòng 454): đảm bảo khách `learner` của sale khác không lộ số điện thoại. Lọc thêm bằng `customerScope` hoặc che `phone`.
- Verify: no verification needed (Task 2.8).

### Task 2.7: Màn hình web

- Goal: sale làm việc được trên web.
- Target: các page mới, `router.tsx`, `layout.tsx`. Theo mẫu `leads.tsx`, `lead-new.tsx`, `lead-detail.tsx`. Dùng `useApi`, `api.command` và component trong `components/ui.tsx`.
- Steps:
  1. Thêm 2 mục nav, roles `['sale','leader','admin']`:
     - "Học viên" (`/learners`)
     - "Đối tác" (`/partners`)
  2. `/learners`:
     - Bảng luôn hiện 3 cột Sale, Trạng thái, Khóa học.
     - Có thêm các cột Điện thoại, Nguồn, Hợp đồng, Ngày hết giữ.
     - Ô tìm kiếm, bộ lọc trạng thái và khóa học. Bộ lọc sale chỉ hiện với Leader và Admin.
     - Nút chuyển giữa "Khách của tôi" và "Hồ chung". Khách ở hồ chung có nút "Nhận".
  3. `/learners/new`: form tạo theo `createLearnerLeadInput`.
     - Chọn nguồn `partner` thì hiện ô chọn hợp đồng đang hiệu lực.
     - Chọn nhiều sản phẩm.
     - Có Next Action.
     - Xử lý lỗi `FORBIDDEN` khi trùng khách của người khác.
  4. `/learners/$contactId`:
     - Checklist hành trình. Chỉ có nút cho Liên hệ, Xác nhận nhu cầu và Bỏ qua học thử.
     - Nút Thắng, Mất, Không phù hợp.
     - Danh sách sản phẩm gắn/gỡ.
     - Đồng ý theo 5 mục, mỗi mục là một công tắc gọi `recordConsent`.
     - Nhật ký chăm sóc. Dùng lại `logActivity`, kiểm `logActivity` có nhận lead `learner`.
     - Leader và Admin có nút "Đổi sale".
  5. `/partners` và `/partners/$id`:
     - Danh sách hợp đồng.
     - Form tạo hoặc sửa hợp đồng.
     - Các bước tự thêm, có tick xong.
     - Danh sách học viên.
     - Nhập CSV: xem trước rồi xác nhận.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 2.8: Test

- Target: `apps/crm/test/learner-hold.test.ts`, `apps/crm/test/admissions.test.ts`.
- Steps:
  1. `holdExpiry`:
     - `2026-01-31T03:00:00.000Z` (10:00 giờ VN ngày 31/1) ra `2026-04-30T03:00:00.000Z`.
     - `2026-11-30T20:00:00.000Z` (03:00 giờ VN ngày 1/12) ra `2027-02-28T20:00:00.000Z` (03:00 giờ VN ngày 1/3). Ca này kiểm việc cộng tháng theo giờ VN, không theo UTC.
     - `2027-11-30T03:00:00.000Z` ra `2028-02-29T03:00:00.000Z` (năm nhuận).
  2. Admissions:
     - Sale A tạo khách, sale B tạo trùng số thì nhận `FORBIDDEN`.
     - Sale B gọi `GET /learners/:id` thì `phone` là `null`.
     - Đặt `hold_expires_at` về quá khứ bằng SQL trực tiếp. Lúc này `view=pool` của B thấy khách. B `claimCustomer` thì OK, lead đổi owner sang B.
     - Khách có lead `won` mà hạn đã qua thì không ở hồ chung, và `claimCustomer` nhận `VALIDATION_FAILED` hoặc `FORBIDDEN`.
     - Gọi `markJourneyStep need_confirmed` trước `contacted` thì lỗi.
     - Gọi `markJourneyStep` cho `placed` thì lỗi ở bước parse schema, nhận `VALIDATION_FAILED`.
     - `winLearnerLead` khi bước `trial` còn `open` thì lỗi. Sau `skipTrial` thì thắng được và bước `enrolled` là `done`.
     - Nguồn `partner` dùng hợp đồng `draft` thì lỗi.
     - `closeLearnerLead` với `other` mà không có note thì `VALIDATION_FAILED`.
     - `changeStage` trên lead `learner` thì `VALIDATION_FAILED`.
     - Import CSV 3 dòng, một dòng trùng khách đang giữ: xem trước báo 1 lỗi. Commit tạo 2 lead.
     - Gỡ sản phẩm rồi gắn lại: có 2 dòng `customer_product`, chỉ 1 dòng đang gắn.
- Verify: `pnpm -F @abm/crm test` exit 0. Output có cả hai file test mới và không có `failed`.

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

## Rủi ro và rollback

- **Che số điện thoại dễ sót ở một truy vấn nào đó.** Tìm `contact_point` trong `apps/crm/src/worker` và rà từng chỗ.
- **Rollback:** revert commit. Migration chỉ lên eval ở phase 07.
