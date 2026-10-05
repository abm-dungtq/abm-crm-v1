# Phase 05 accounting and fees: checkpoint report

Status: completed. The three verify commands exited 0 after the charge-sum assert was restored. Nothing committed, nothing deployed, no remote Wrangler, no dev server. Phase 06 was not implemented.

## Verify results

| Command | Result |
| --- | --- |
| `pnpm -F @abm/crm test` | pass, exit 0. 22 files, 312 tests. Output contains `fees.test.ts` (18 tests) and does not contain `failed`. |
| `pnpm -F @abm/crm typecheck` | pass, exit 0 |
| `pnpm -F @abm/crm build` | pass, exit 0. Vite printed its chunk-size warning and still exited 0. |

All three were run from `D:\TQD\CRM` after the assert was put back. An earlier full suite, run before the removal experiment, also exited 0 with the same 312 tests.

### Charge-sum experiment

The two new deposit races were run with only the charge sum asserts removed (`tx.assert(chargeWithinSql, …)` inside `assertChargeTotals` and on the `recordPayment` auto-allocation path). The open-status assert and the payment sum assert stayed in place.

Command, from `apps/crm`: `pnpm -F @abm/crm exec vitest run test/fees.test.ts -t deposit`

Both new tests failed, which is what the removal was meant to show:

- `two different payments allocating one deposit let exactly one succeed`: both `allocatePayment` calls returned 200. Expected `[200, 409]`.
- `two automatic allocations of one deposit let exactly one succeed`: both `recordPayment` calls allocated the same deposit. Expected 1 success, got 2.

The two `chargeWithinSql` asserts were restored. The full suite above is the run after that restore.

`pnpm -F @abm/crm test -- test/fees.test.ts` does not filter on this machine: pnpm passes a literal `--` and Vitest runs the whole suite. The experiment used `pnpm exec vitest` and `-t deposit` so only the fee file was filtered.

## Files changed

Created:

- `apps/crm/src/web/pages/fees-ledger.tsx` (Sổ tiền học viên: hủy khoản, thu hồi phân bổ, chuyển khoản phải thu theo lớp mới)

Modified:

- `apps/crm/migrations/0010_fees.sql` (`UNIQUE (organization_id, code)`; nullable `payment.contact_id` and `payment_contact`)
- `packages/contracts/src/index.ts` (`recordPayment` optional `contactId`)
- `apps/crm/src/worker/commands.ts` (UNIQUE → `STALE_VERSION` only for charge code and the attendance insert races)
- `apps/crm/src/worker/fees.ts` (open-charge assert, tuition remaining re-check, SQL contact filter, live allocations, refund contact, uppercase memo match)
- `apps/crm/src/web/pages/fees.tsx` (Hủy khoản, link Sổ tiền, chọn học viên khi hoàn tiền)
- `apps/crm/src/web/router.tsx` (`/fees/ledger/$contactId`)
- `apps/crm/test/fees.test.ts` (two deposit races, lower-case memo, ledger past the 300-row window)
- `plans/261005-1053-learner-ops-upgrade/phase-05-accounting-fees.md` (checkpoint text, then `status: completed`)
- `plans/261005-1053-learner-ops-upgrade/phase-06-reports-privacy-bot-docs.md` (plan text only)
- `plans/261005-1053-learner-ops-upgrade/plan.md` (phase 05 row set to `completed`; the plan itself stays `pending`)

Not edited: `docs/security/permission-matrix-v1.md`, `apps/crm/test/learner-foundation.test.ts`, `searchFeeContacts`.

## What the checkpoint asked for

- Allocating, by hand or from a memo, asserts inside the batch that the charge is still `open` and that the live allocation sum does not exceed the charge.
- The new deposit tests use two different payments against one 1.000.000 deposit, so neither a payment version nor a journey-step write is the loser. Exactly one succeeds. The removal experiment above shows the charge sum assert is what makes the loser fail.
- `listCharges` applies `contact_id` in the WHERE before `LIMIT 300`. The ledger calls that filter instead of dropping rows in JavaScript.
- The ledger returns live allocations as `id`, `version`, `paymentId`, `chargeId`, `chargeCode`, `amountVnd`, `createdAt`. The ledger test revokes with those fields and gets 200.
- When a live enrollment still has an open tuition, the batch re-reads the remaining of every open charge on that enrollment and asserts `<= 0` or `> 0` to match the journey-step decision.
- A UNIQUE failure maps to `STALE_VERSION` only when the message contains `charge.code`, `attendance.session_id`, `attendance_session_enrollment`, or `attendance_session_trial`.
- `charge.code` is unique per organization. The original memo is stored; matching uses the upper-cased memo, so `abm hp000001` allocates.
- A refund may carry `contactId`. It is stored on `payment.contact_id` and listed on that learner's ledger. It is never allocated. An incoming payment ignores `contactId`.
- Sale and leader still see the product list price.

## Deviations

1. **Attendance unique races stay mapped.** Phase 04 already expects the first attendance insert of one session to return `STALE_VERSION` when it hits `attendance_session_enrollment` (and the session and trial indexes). Those three names stay in the matcher together with `charge.code`. Any other unique failure, such as `account.tax_code` or `class_teacher`, is still thrown.
2. **The ledger also returns transfer pairs.** `transfers` is `{fromEnrollmentId, toEnrollmentId, version, fromClassName, toClassName, openChargeCount}` for a `transferred` enrollment and the destination whose `transferred_from_enrollment_id` points at it. The accountant cannot call `/classes`, and `moveEnrollmentCharges` needs the destination version. The allocation fields required for revoke are still returned.
3. **Refund contact is in `0010_fees.sql`.** The fee migration has not been applied on eval, so the nullable column and index were edited in place. There is no new migration file.
4. **Phase 05 text gained a few sentences past the ten checkpoint edits.** They record the optional refund `contactId`, the live allocations and linked refunds on the ledger, the in-batch open and tuition-remaining checks, and the four accountant screens in Task 5.5. A completed phase should not contradict the code.
5. **The permission matrix file was not edited.** Phase 06 Task 6.5 now says to change the học phí line from Admin `R` to Admin `R/W`, to note BGĐ `R`, and to note that only Admin edits the bank account. The matrix path is in the phase 06 file list. The accountant `tools/list` whoami line was already in Task 6.6 and was left as that one line.
6. **Anonymize behavior was not changed.** Phase 06 now says `searchFeeContacts` must filter `archived_at IS NULL`, that `charge.contact_id` still pointing at “Đã ẩn danh” is correct, and that `payment.memo`, `payment.payer_note`, `lead.need_summary`, and `consent.note` stay with the money documents. Whether to wipe that free text is still open. No bank-transfer reference was added.
7. **The four screens were not clicked.** The task forbids a dev server. The pages typecheck and the production build includes the new route.
