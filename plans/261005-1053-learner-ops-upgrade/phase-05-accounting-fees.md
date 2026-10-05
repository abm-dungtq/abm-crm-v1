---
phase: 5
title: "Kế toán: khoản phải thu, ghi tiền, phân bổ, hàng đợi chưa khớp, nội dung chuyển khoản"
status: completed
priority: P1
effort: "2.5d"
dependencies: [4]
---

# Phase 05: Kế toán

## Goal

Kế toán làm được các việc theo PRD §9 và ADR-007:

- ghi khoản phải thu: học phí, tiền cọc, học liệu, điều chỉnh;
- ghi tiền vào bằng chuyển khoản hoặc tiền mặt, và ghi hoàn tiền;
- phân bổ một khoản tiền cho một hay nhiều khoản phải thu, kể cả của nhiều học viên.

Ngoài ra:

- Tiền có nội dung chuyển khoản khớp mã khoản phải thu thì tự phân bổ. Tiền không khớp vào hàng đợi.
- Số dư luôn tính từ các khoản phân bổ, không có ô số dư nào để nhân viên gõ tay.
- Khi học phí của khóa thu đủ, bước "Thu học phí khóa" của lead được đánh dấu.
- Màn hướng dẫn chuyển khoản hiện tài khoản của đơn vị, số còn lại và nội dung chuyển khoản do server sinh.
- Kế toán ghi số tham chiếu hóa đơn khi đã xuất hóa đơn ở nơi khác.
- Giáo viên và tuyển sinh (sale, leader) không đọc được số tiền nào.

Mọi tiền tính bằng đồng, kiểu số nguyên.

Mọi lệnh chạy từ `D:\TQD\CRM`.

## Files to Create / Modify

- Create: `apps/crm/migrations/0010_fees.sql`
- Create: `apps/crm/src/worker/fees.ts` (handler và truy vấn)
- Modify: `apps/crm/src/worker/commands.ts` (đăng ký `feeHandlers`)
- Modify: `apps/crm/src/worker/index.ts`
- Modify: `apps/crm/src/worker/guarded-tx.ts`
- Modify: `apps/crm/src/worker/learner-commands.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts`
- Modify: `apps/crm/test/helpers/learner-fixtures.ts`
- Modify: `apps/crm/seed/demo.sql`
- Create: `apps/crm/src/web/pages/fees.tsx` (khoản phải thu và tiền vào), `fees-queue.tsx` (hàng đợi chưa khớp), `fee-guide.tsx` (hướng dẫn chuyển khoản)
- Modify: `apps/crm/src/web/pages/admin.tsx` (form tài khoản ngân hàng của đơn vị)
- Modify: `apps/crm/src/web/pages/dashboard.tsx`
- Modify: `apps/crm/src/web/router.tsx`, `layout.tsx`
- Create: `apps/crm/test/fees.test.ts`

## Tasks

### Task 5.1: Migration 0010

- Target: `apps/crm/migrations/0010_fees.sql`. Mọi bảng có `created_at`, `updated_at`, `version`, `last_txn_id`.
- Steps:
  1. `org_setting`:
     - cột `id TEXT PRIMARY KEY` (luôn bằng `organization_id`), `organization_id TEXT NOT NULL UNIQUE`, `bank_name TEXT`, `bank_account_no TEXT`, `bank_account_holder TEXT`, cùng các cột version;
     - chèn một dòng cho mỗi tổ chức đã có: `INSERT INTO org_setting (id, organization_id, created_at, updated_at, version) SELECT id, id, <now>, <now>, 1 FROM organization`. Không ghi cứng `org-abm`. Các cột ngân hàng để rỗng.
     - thêm vào `seed/demo.sql` một dòng `INSERT OR IGNORE INTO org_setting … 'org-abm' …`, để `resetDb` nạp lại sau khi xóa.
  2. `fee_counter`: `organization_id TEXT PRIMARY KEY`, `next_value INTEGER NOT NULL`.
  3. `charge`:
     - cột: `id`, `organization_id`, `code TEXT NOT NULL UNIQUE` (`HP000001`), `contact_id` (FK contact), `enrollment_id TEXT` (FK enrollment, có thể null), `kind TEXT NOT NULL CHECK (kind IN ('tuition','deposit','material','adjustment'))`, `amount_vnd INTEGER NOT NULL`, `product_name TEXT` (snapshot lúc tạo), `sessions_count INTEGER` (gói buổi, chỉ để ghi), `note TEXT`, `invoice_ref TEXT`, `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','void'))`;
     - `CHECK (kind = 'adjustment' OR amount_vnd > 0)`;
     - index `(contact_id)` và `(enrollment_id)`.
  4. `payment`:
     - cột: `id`, `organization_id`, `direction TEXT NOT NULL CHECK (direction IN ('in','refund'))`, `method TEXT NOT NULL CHECK (method IN ('transfer','cash'))`, `amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0)`, `received_at TEXT NOT NULL`, `memo TEXT`, `payer_note TEXT`, `contact_id TEXT` (chỉ hoàn tiền, để sổ học viên hiện khoản hoàn), `recorded_by_user_id`;
     - index `(organization_id, received_at)`.
  5. `payment_allocation`:
     - cột: `id`, `payment_id` (FK payment), `charge_id` (FK charge), `amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0)`, `created_by_user_id`, `revoked_at TEXT`, cùng `created_at`, `updated_at`, `version`, `last_txn_id`;
     - index `(charge_id)` và `(payment_id)`.
  6. Chèn `'payment_allocation', 'payment', 'charge'` vào **đầu** `TABLES`, trước `'attendance'`. Chèn `'fee_counter', 'org_setting'` ngay trước `'organization'`.
  7. Thêm `'org_setting' | 'charge' | 'payment' | 'payment_allocation'` vào type `GuardedTable` trong `guarded-tx.ts`.
     - `tx.update` ghi cứng `WHERE id = ?` (`guarded-tx.ts` dòng 36), nên `org_setting` phải có cột `id`. Gọi `tx.update('org_setting', organizationId, version, …)`.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 5.2: Hợp đồng dùng chung

- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm `CHARGE_KINDS` với nhãn: Học phí, Tiền cọc, Học liệu, Điều chỉnh.
     Thêm `PAYMENT_METHODS` với nhãn: Chuyển khoản, Tiền mặt.
     Thêm `MONEY_ROLES = ['accountant','admin','director'] as const`.
  2. Thêm schema và lệnh. Mọi lệnh có roles `accountant` và `admin`, `idempotent: true`, `agentNeedsApproval: false`.
     Lệnh neo vào lead dùng `expectedVersion`, lệnh neo vào thực thể khác dùng `version`.
     `kind = 'tuition'` bắt buộc có `enrollmentId`. Giảm giá ghi bằng khoản `adjustment` âm, không sửa `amount_vnd` của khoản `tuition`.

     | Lệnh | riskLevel | expectedVersion | Input |
     |---|---|---|---|
     | `createCharge` | medium | false | `{contactId, enrollmentId?, kind, amountVnd: int (adjustment được âm, các loại khác > 0), sessionsCount?, note?}` |
     | `voidCharge` | high | true | `{chargeId, version, reason}` |
     | `recordPayment` | high | false | `{direction, method, amountVnd: int > 0, receivedAt, memo?, payerNote?}` |
     | `allocatePayment` | high | true | `{paymentId, version, allocations: [{chargeId, amountVnd > 0}] (1-50 phần tử)}` |
     | `revokeAllocation` | high | true | `{allocationId, version, reason}` |
     | `setInvoiceRef` | low | true | `{chargeId, version, invoiceRef: text(60)}` |
     | `moveEnrollmentCharges` | medium | true | `{fromEnrollmentId, toEnrollmentId, version}` — `version` là của ghi danh đích |
     | `updateOrgBank` | high | true | `{version, bankName, bankAccountNo, bankAccountHolder}`, chỉ cho `admin` |
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 5.3: Handler tiền

- Target: `apps/crm/src/worker/fees.ts`. Export `feeHandlers`.
- Steps:
  1. **`createCharge`**
     - `code` lấy từ `fee_counter` bằng `printf('HP%06d', next_value)`, theo đúng mẫu `lead_counter` trong `createLead` (`commands.ts` dòng 349-362).
     - Có `enrollmentId` thì `product_name` lấy tên sản phẩm của khóa qua chuỗi `enrollment → class_group → course → product`. Giá trị này là snapshot, đổi giá sản phẩm sau đó không làm đổi khoản đã tạo.
     - `amount_vnd` do kế toán nhập. Không tự lấy giá sản phẩm. Không sửa `amount_vnd` của khoản `tuition` để ghi giảm giá; giảm giá là một khoản `adjustment` âm.
     - Ghi danh phải cùng tổ chức, `enrollment.contact_id = contactId`, và trạng thái thuộc `pending`, `confirmed`, `studying` hoặc `deferred`. `kind = 'tuition'` bắt buộc có `enrollmentId`.
  2. **Số còn lại của một khoản phải thu** là `amount_vnd - SUM(allocation.amount_vnd WHERE revoked_at IS NULL)`.
     - Viết một view SQL hoặc subquery dùng chung tên `chargeBalanceSql`.
     - Không bao giờ lưu số dư thành cột.
  3. **`recordPayment`**
     - Ghi `payment`.
     - Nếu `direction = 'in'` và `memo` chứa đúng một mã `HP\d{6}` của một khoản `open` có số còn lại ≥ `amountVnd`, thì tạo luôn allocation cho khoản đó trong cùng `GuardedTx`.
     - Hoàn tiền có thể gửi `contactId`. Khi có, hoàn tiền hiện trong sổ của học viên đó và vẫn không được phân bổ.
     - Cùng `tx.assert` tổng phân bổ theo `charge_id` như bước 4, và `tx.assert` `status = 'open'` trong batch: `(SELECT COALESCE(SUM(amount_vnd),0) FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL) <= (SELECT amount_vnd FROM charge WHERE id = ?)`.
     - Chuẩn hóa `receivedAt` bằng `isoUtc` dùng chung (export từ `command-result.ts`). Web gửi `receivedAt` qua `fromLocalInput`.
     - Còn lại thì không phân bổ. Khoản tiền đó nằm trong hàng đợi.
  4. **`allocatePayment`**
     - Payment phải có `direction = 'in'`. Hoàn tiền (`refund`) chỉ được ghi lại, **không bao giờ được phân bổ**. Ghi chú quy tắc này trong code.
     - Tổng các allocation mới cộng các allocation còn hiệu lực của payment phải ≤ `payment.amount_vnd`.
     - Mỗi allocation phải ≤ số còn lại của khoản phải thu.
     - Khoản phải thu phải `open`.
     - Bump version của `payment` bằng `tx.update('payment', paymentId, version, {})` làm dòng neo.
     - **Chống ghi trùng khi hai người phân bổ cùng lúc:** sau khi đã đẩy mọi câu `INSERT` allocation vào batch, mới đẩy `tx.assert`. Điều kiện kiểm là:
       - `(SELECT COALESCE(SUM(amount_vnd),0) FROM payment_allocation WHERE payment_id = ? AND revoked_at IS NULL) <= (SELECT amount_vnd FROM payment WHERE id = ?)`;
       - với từng khoản phải thu: `(SELECT COALESCE(SUM(amount_vnd),0) FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL) <= (SELECT amount_vnd FROM charge WHERE id = ?)`;
     - và `tx.assert` `status = 'open'` của từng khoản trong cùng batch, để phân bổ không dính vào khoản vừa bị hủy.
     - Luôn dùng `COALESCE(SUM(...),0)`, vì `SUM` trên 0 dòng trả `NULL`.
  5. **`revokeAllocation`**: dùng `version` client gửi, rồi gọi `tx.update('payment_allocation', id, version, { revoked_at: tx.now })`. Không xóa dòng. Dòng phải có `revoked_at IS NULL`. Nếu đã thu hồi thì trả `VALIDATION_FAILED`.
  6. **`voidCharge`**: chỉ khi khoản không còn allocation hiệu lực.
  7. **`setInvoiceRef`**: chỉ ghi số tham chiếu. Thu tiền không tự đánh dấu đã xuất hóa đơn.
  8. **`moveEnrollmentCharges`**
     - Ghi danh nguồn phải ở `transferred`, và ghi danh đích có `transferred_from_enrollment_id` bằng ghi danh nguồn.
     - Đổi `enrollment_id` của mọi khoản `open` từ nguồn sang đích bằng `tx.update('charge', …)`.
     - Không đổi `enrollment.status`, nên không đi qua `ENROLLMENT_FROM`. Nguồn kiểm `status = 'transferred'`.
     - Luôn bump version của ghi danh đích bằng `tx.update('enrollment', toId, version, {})` làm dòng neo, và ghi một dòng audit.
     - Nếu không có khoản nào thì trả OK với `moved: 0`. Không tạo khoản phải thu hay phân bổ nào. Không sinh bút toán giả.
  9. **Đánh dấu bước học phí:**
     - Giảm giá được ghi bằng một khoản `adjustment` âm. Không sửa `amount_vnd` của khoản `tuition` để ghi giảm giá.
     - Viết hàm `syncTuitionStep(db, tx, actorId, contactId)`, gọi sau mỗi lệnh có thể làm đổi số còn lại: allocate, revoke, void, createCharge, recordPayment khi có tự phân bổ.
     - Với mỗi lead `learner` của khách: lấy ghi danh sống duy nhất (trạng thái `pending`, `confirmed`, `studying` hoặc `deferred`). Bước `tuition_paid` thành `done` khi ghi danh đó có ít nhất một khoản `tuition` `open`, và tổng số còn lại của mọi khoản `open` gắn ghi danh đó (học phí, tiền cọc, học liệu và `adjustment` âm) ≤ 0.
     - Đánh `done` chỉ qua `markStepDone(db, tx, actorId, leadId, 'tuition_paid')`.
     - Nếu bước đang `done` mà tổng số còn lại > 0, mở lại bằng `reopenStep(db, tx, leadId, stepCode)`. Export hàm này từ `learner-commands.ts` ngay cạnh `markStepDone`. Hàm chỉ đổi `done → open`. Không viết `UPDATE lead_step` ở `fees.ts`.
     - Contract: `kind = 'tuition'` bắt buộc có `enrollmentId`.
     - Với ghi danh còn ít nhất một khoản `tuition` đang `open`, thêm `tx.assert` tính lại tổng số còn lại của mọi khoản `open` trên ghi danh đó trong batch: quyết định `done` thì assert `<= 0`, còn lại thì assert `> 0`. Batch tự hỏng nếu có người ghi chen.
  10. **`updateOrgBank`**: cập nhật `org_setting` có version và audit.
  11. Mọi lệnh ghi `tx.audit`.
- Verify: no verification needed (Task 5.6).

### Task 5.4: Truy vấn

- Target: `apps/crm/src/worker/fees.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. Mọi route dưới đây trả 403 khi role không thuộc `MONEY_ROLES`, kiểm trong handler:
     - `GET /fees/charges?status=&q=`: danh sách khoản phải thu kèm `paid` và `remaining` tính trong SQL, tên học viên, mã, hóa đơn.
     - `GET /fees/payments?unallocated=1`: hàng đợi gồm các payment có phần chưa phân bổ > 0, sắp xếp cũ trước.
     - `GET /fees/contacts/:contactId`: sổ tiền của một học viên. Lọc `contact_id` trong SQL trước `LIMIT`. Trả phân bổ còn hiệu lực kèm `id` và `version`, và các cặp ghi danh đã chuyển lớp để gọi `moveEnrollmentCharges`. Hoàn tiền có `contact_id` của học viên nằm trong sổ.
     - `GET /fees/charges/:id/guide`: tên ngân hàng, số tài khoản, chủ tài khoản lấy từ `org_setting`, số còn lại, và nội dung chuyển khoản `ABM <code>`.
     - `GET /fees/contacts?q=` (chỉ `MONEY_ROLES`): tên, mã lead và ghi danh sống (lớp, khóa, sản phẩm). Đây là nguồn cho form tạo khoản.
  2. Rà `GET /learners/:contactId`, `GET /classes/:id`, `GET /my-classes`, `GET /sessions/:id/attendance` và `GET /courses`, đảm bảo **không** trả trường tiền nào.
     - Tuyển sinh chỉ thấy bước `tuition_paid` đã xong hay chưa, không thấy số tiền.
- Verify: no verification needed (Task 5.6).

### Task 5.5: Web

- Target: `fees.tsx`, `fees-queue.tsx`, `fee-guide.tsx`, `admin.tsx`, `dashboard.tsx`, `router.tsx`, `layout.tsx`.
- Steps:
  1. `dashboard.tsx` chuyển `accountant` sang `/fees`.
  2. Thêm 2 mục nav, roles accountant, admin, director:
     - "Học phí" (`/fees`)
     - "Tiền chưa khớp" (`/fees/queue`, kèm badge số lượng)
  3. `/fees`:
     - bảng khoản phải thu;
     - form tạo khoản, chọn học viên và ghi danh của họ từ `GET /fees/contacts?q=`;
     - form ghi tiền vào và hoàn tiền;
     - nút "Hướng dẫn chuyển khoản" mở `/fees/guide/$chargeId`;
     - nút "Số hóa đơn".
  4. `/fees/queue`: mỗi payment có form phân bổ, gồm nhiều dòng chọn khoản phải thu và số tiền. Hiện số còn lại của payment khi gõ.
  5. `/fees/guide/$chargeId`: hiện thông tin ngân hàng, số tiền còn lại và nội dung chuyển khoản, mỗi mục có nút sao chép. Không tạo ảnh QR.
  6. `admin.tsx`: thêm form "Tài khoản nhận tiền" cho admin.
  7. Trên các trang kế toán: Hủy khoản, Thu hồi phân bổ, Chuyển khoản phải thu theo lớp mới, và Sổ tiền học viên (`/fees/ledger/$contactId`).
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 5.6: Test

- Target: `apps/crm/test/fees.test.ts`.
- Seed không có user `accountant`. Dùng `addUser('u-accountant', 'accountant')` và các fixture trong `learner-fixtures.ts`. Test 12 điểm danh bằng `u-academic` qua `confirmSeat`, theo mẫu `attendance.test.ts`.
- Steps: viết các test sau.
  1. Tạo khoản `tuition` 5.000.000 có mã `HP000001`.
     - Ghi tiền vào 5.000.000 với memo `ABM HP000001` thì tự phân bổ, số còn lại là 0, bước `tuition_paid` là `done`.
  2. Ghi tiền 3.000.000 với memo không khớp: payment nằm trong hàng đợi.
     - Phân bổ 2.000.000 cho học viên A và 1.000.000 cho học viên B thì hàng đợi rỗng.
  3. Phân bổ vượt số còn lại của khoản, hoặc vượt số tiền của payment: `VALIDATION_FAILED`, và không có dòng nào được ghi.
  4. Thu hồi phân bổ thì số còn lại tăng lại và bước `tuition_paid` quay về `open`.
  5. Đổi `price_vnd` của sản phẩm thì `amount_vnd` của khoản đã tạo không đổi.
  6. `moveEnrollmentCharges` sau khi chuyển lớp: khoản chuyển sang ghi danh mới. Trường hợp không có khoản thì `moved: 0` và số dòng `audit_log` không tăng ngoài audit của chính lệnh.
  7. `sale` và `teacher` gọi `GET /fees/charges` nhận 403. `sale` gọi `createCharge` nhận `FORBIDDEN`.
  8. `GET /learners/:contactId` của sale owner không có khóa nào chứa `amount`.
  9. `setInvoiceRef` chỉ đổi `invoice_ref`, các trường khác giữ nguyên.
  10. `voidCharge` khi khoản còn phân bổ hiệu lực thì lỗi. Thu hồi phân bổ xong thì hủy được.
  11. Ghi hoàn tiền (`direction = 'refund'`) thì được. `allocatePayment` cho payment đó thì `VALIDATION_FAILED`.
  12. Điểm danh một buổi (dùng lệnh của phase 04, actor `u-academic`) không làm đổi số dòng và tổng `amount_vnd` của `charge`, `payment`, `payment_allocation`.
  13. Hai `allocatePayment` cùng một payment, cùng `version`, chạy `Promise.all`: đúng một lệnh thành công. Test này chứng minh guard version của payment.
  14. Hai payment khác nhau cùng phân bổ đủ một khoản `deposit`, chạy `Promise.all` qua `allocatePayment` và qua `recordPayment` tự phân bổ: đúng một lệnh thành công, tổng phân bổ không vượt số tiền của khoản. Test này chứng minh `tx.assert` tổng.
- Verify: `pnpm -F @abm/crm test` exit 0. Output có `fees.test.ts` và không có `failed`.

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

- **Hai người phân bổ cùng lúc có thể vượt số tiền.** `tx.assert` tính tổng ngay trong batch để chặn. Test 13 chứng minh guard version của payment. Test 14 chứng minh `tx.assert` tổng: hai payment khác nhau cùng phân bổ vào một khoản `deposit`.
- **Đây là sổ tiền thật:** phase 07 sao lưu D1 trước khi lên eval. ADR-007 ghi rõ trách nhiệm.
- **Rollback:** revert commit.
