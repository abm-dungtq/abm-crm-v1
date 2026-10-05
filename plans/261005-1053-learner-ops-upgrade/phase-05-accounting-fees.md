---
phase: 5
title: "Kế toán: khoản phải thu, ghi tiền, phân bổ, hàng đợi chưa khớp, nội dung chuyển khoản"
status: pending
priority: P1
effort: "2.5d"
dependencies: [3]
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
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/crm/test/helpers/reset-db.ts`
- Create: `apps/crm/src/web/pages/fees.tsx` (khoản phải thu và tiền vào), `fees-queue.tsx` (hàng đợi chưa khớp), `fee-guide.tsx` (hướng dẫn chuyển khoản)
- Modify: `apps/crm/src/web/pages/admin.tsx` (form tài khoản ngân hàng của đơn vị)
- Modify: `apps/crm/src/web/router.tsx`, `layout.tsx`
- Create: `apps/crm/test/fees.test.ts`

## Tasks

### Task 5.1: Migration 0010

- Target: `apps/crm/migrations/0010_fees.sql`. Mọi bảng có `created_at`, `updated_at`, `version`, `last_txn_id`.
- Steps:
  1. `org_setting`:
     - cột `organization_id TEXT PRIMARY KEY`, `bank_name TEXT`, `bank_account_no TEXT`, `bank_account_holder TEXT`, cùng các cột version;
     - chèn sẵn một dòng `'org-abm'` để rỗng.
  2. `fee_counter`: `organization_id TEXT PRIMARY KEY`, `next_value INTEGER NOT NULL`.
  3. `charge`:
     - cột: `id`, `organization_id`, `code TEXT NOT NULL UNIQUE` (`HP000001`), `contact_id` (FK contact), `enrollment_id TEXT` (FK enrollment, có thể null), `kind TEXT NOT NULL CHECK (kind IN ('tuition','deposit','material','adjustment'))`, `amount_vnd INTEGER NOT NULL`, `product_name TEXT` (snapshot lúc tạo), `sessions_count INTEGER` (gói buổi, chỉ để ghi), `note TEXT`, `invoice_ref TEXT`, `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','void'))`;
     - `CHECK (kind = 'adjustment' OR amount_vnd > 0)`;
     - index `(contact_id)` và `(enrollment_id)`.
  4. `payment`:
     - cột: `id`, `organization_id`, `direction TEXT NOT NULL CHECK (direction IN ('in','refund'))`, `method TEXT NOT NULL CHECK (method IN ('transfer','cash'))`, `amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0)`, `received_at TEXT NOT NULL`, `memo TEXT`, `payer_note TEXT`, `recorded_by_user_id`;
     - index `(organization_id, received_at)`.
  5. `payment_allocation`:
     - cột: `id`, `payment_id` (FK payment), `charge_id` (FK charge), `amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0)`, `created_by_user_id`, `created_at`, `revoked_at TEXT`;
     - index `(charge_id)` và `(payment_id)`.
  6. Thêm các bảng mới vào `TABLES`: `payment_allocation`, `payment`, `charge` đặt trước `enrollment` và `contact`. Thêm `fee_counter`, `org_setting`.
- Verify: `pnpm -F @abm/crm test` exit 0.

### Task 5.2: Hợp đồng dùng chung

- Target: `packages/contracts/src/index.ts`.
- Steps:
  1. Thêm `CHARGE_KINDS` với nhãn: Học phí, Tiền cọc, Học liệu, Điều chỉnh.
     Thêm `PAYMENT_METHODS` với nhãn: Chuyển khoản, Tiền mặt.
     Thêm `MONEY_ROLES = ['accountant','admin','director'] as const`.
  2. Thêm schema và lệnh. Mọi lệnh có roles `accountant` và `admin`, `agentNeedsApproval: false`.

     | Lệnh | Input |
     |---|---|
     | `createCharge` | `{contactId, enrollmentId?, kind, amountVnd: int (adjustment được âm, các loại khác > 0), sessionsCount?, note?}` |
     | `voidCharge` | `{chargeId, version, reason}` |
     | `recordPayment` | `{direction, method, amountVnd: int > 0, receivedAt, memo?, payerNote?}` |
     | `allocatePayment` | `{paymentId, version, allocations: [{chargeId, amountVnd > 0}] (1-50 phần tử)}` |
     | `revokeAllocation` | `{allocationId, reason}` |
     | `setInvoiceRef` | `{chargeId, version, invoiceRef: text(60)}` |
     | `moveEnrollmentCharges` | `{fromEnrollmentId, toEnrollmentId}` |

     Riêng `updateOrgBank` (`{version, bankName, bankAccountNo, bankAccountHolder}`) chỉ cho `admin`.
- Verify: `pnpm -F @abm/crm typecheck` exit 0.

### Task 5.3: Handler tiền

- Target: `apps/crm/src/worker/fees.ts`. Export `feeHandlers`.
- Steps:
  1. **`createCharge`**
     - `code` lấy từ `fee_counter` bằng `printf('HP%06d', next_value)`, theo đúng mẫu `lead_counter` trong `createLead` (`commands.ts` khoảng dòng 305-315).
     - Có `enrollmentId` thì `product_name` lấy tên sản phẩm của khóa qua chuỗi `enrollment → class_group → course → product`. Giá trị này là snapshot, đổi giá sản phẩm sau đó không làm đổi khoản đã tạo.
     - `amount_vnd` do kế toán nhập. Không tự lấy giá sản phẩm.
  2. **Số còn lại của một khoản phải thu** là `amount_vnd - SUM(allocation.amount_vnd WHERE revoked_at IS NULL)`.
     - Viết một view SQL hoặc subquery dùng chung tên `chargeBalanceSql`.
     - Không bao giờ lưu số dư thành cột.
  3. **`recordPayment`**
     - Ghi `payment`.
     - Nếu `direction = 'in'` và `memo` chứa đúng một mã `HP\d{6}` của một khoản `open` có số còn lại ≥ `amountVnd`, thì tạo luôn allocation cho khoản đó trong cùng `GuardedTx`.
     - Còn lại thì không phân bổ. Khoản tiền đó nằm trong hàng đợi.
  4. **`allocatePayment`**
     - Tổng các allocation mới cộng các allocation còn hiệu lực của payment phải ≤ `payment.amount_vnd`.
     - Mỗi allocation phải ≤ số còn lại của khoản phải thu.
     - Khoản phải thu phải `open`.
     - Payment `refund` chỉ được phân bổ vào khoản `adjustment` âm, hoặc không phân bổ. Ghi chú quy tắc này trong code.
     - Dùng `tx.assert` để chặn ghi trùng khi hai người cùng phân bổ một lúc. Điều kiện kiểm phải là SQL tính tổng ngay trong batch.
  5. **`revokeAllocation`**: đặt `revoked_at`. Không xóa dòng.
  6. **`voidCharge`**: chỉ khi khoản không còn allocation hiệu lực.
  7. **`setInvoiceRef`**: chỉ ghi số tham chiếu. Thu tiền không tự đánh dấu đã xuất hóa đơn.
  8. **`moveEnrollmentCharges`**
     - Ghi danh nguồn phải ở `transferred`, và ghi danh đích có `transferred_from_enrollment_id` bằng ghi danh nguồn.
     - Đổi `enrollment_id` của mọi khoản `open` từ nguồn sang đích.
     - Nếu không có khoản nào thì trả OK với `moved: 0` và không ghi gì. Không sinh bút toán giả.
  9. **Đánh dấu bước học phí:**
     - Viết hàm `syncTuitionStep(tx, db, contactId)`, gọi sau mỗi lệnh có thể làm đổi số còn lại: allocate, revoke, void, createCharge, recordPayment khi có tự phân bổ.
     - Với mỗi lead `learner` của khách có ghi danh chưa kết thúc: nếu lead có ít nhất một khoản `tuition` `open` và mọi khoản `tuition` `open` của ghi danh lead đó đều còn lại = 0, thì bước `tuition_paid` thành `done`.
     - Nếu bước đang `done` mà còn nợ do bị thu hồi phân bổ thì đặt lại `open`.
     - Trạng thái này đọc trước rồi cập nhật bằng `tx.update` có version, chấp nhận dựa trên số liệu đọc trước batch. Thêm `tx.assert` trên tổng phân bổ để batch tự hỏng nếu có người ghi chen.
  10. **`updateOrgBank`**: cập nhật `org_setting` có version và audit.
  11. Mọi lệnh ghi `tx.audit`.
- Verify: no verification needed (Task 5.6).

### Task 5.4: Truy vấn

- Target: `apps/crm/src/worker/fees.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. Mọi route dưới đây trả 403 khi role không thuộc `MONEY_ROLES`, kiểm trong handler:
     - `GET /fees/charges?status=&q=`: danh sách khoản phải thu kèm `paid` và `remaining` tính trong SQL, tên học viên, mã, hóa đơn.
     - `GET /fees/payments?unallocated=1`: hàng đợi gồm các payment có phần chưa phân bổ > 0, sắp xếp cũ trước.
     - `GET /fees/contacts/:contactId`: sổ tiền của một học viên.
     - `GET /fees/charges/:id/guide`: tên ngân hàng, số tài khoản, chủ tài khoản lấy từ `org_setting`, số còn lại, và nội dung chuyển khoản `ABM <code>`.
  2. Rà `GET /learners/:contactId` (phase 02) và `GET /classes/:id` (phase 03), đảm bảo **không** trả trường tiền nào.
     - Tuyển sinh chỉ thấy bước `tuition_paid` đã xong hay chưa, không thấy số tiền.
- Verify: no verification needed (Task 5.6).

### Task 5.5: Web

- Target: `fees.tsx`, `fees-queue.tsx`, `fee-guide.tsx`, `admin.tsx`, `router.tsx`, `layout.tsx`.
- Steps:
  1. Thêm 2 mục nav, roles accountant, admin, director:
     - "Học phí" (`/fees`)
     - "Tiền chưa khớp" (`/fees/queue`, kèm badge số lượng)
  2. `/fees`:
     - bảng khoản phải thu;
     - form tạo khoản, chọn học viên và ghi danh của họ;
     - form ghi tiền vào và hoàn tiền;
     - nút "Hướng dẫn chuyển khoản" mở `/fees/guide/$chargeId`;
     - nút "Số hóa đơn".
  3. `/fees/queue`: mỗi payment có form phân bổ, gồm nhiều dòng chọn khoản phải thu và số tiền. Hiện số còn lại của payment khi gõ.
  4. `/fees/guide/$chargeId`: hiện thông tin ngân hàng, số tiền còn lại và nội dung chuyển khoản, mỗi mục có nút sao chép. Không tạo ảnh QR.
  5. `admin.tsx`: thêm form "Tài khoản nhận tiền" cho admin.
- Verify: `pnpm -F @abm/crm typecheck` exit 0 và `pnpm -F @abm/crm build` exit 0.

### Task 5.6: Test

- Target: `apps/crm/test/fees.test.ts`.
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

- **Hai người phân bổ cùng lúc có thể vượt số tiền.** `tx.assert` tính tổng ngay trong batch để chặn. Test 3 kiểm việc này.
- **Đây là sổ tiền thật:** phase 07 sao lưu D1 trước khi lên eval. ADR-007 ghi rõ trách nhiệm.
- **Rollback:** revert commit.
