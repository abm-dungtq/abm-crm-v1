# Phase 02 admissions: implementation report

Status: completed. Every Verify step passes. Remote D1 untouched, nothing deployed, nothing committed. No Verify step failed, so kongming was not consulted.

## Verify results

| Command | Result |
| --- | --- |
| `pnpm -F @abm/crm test` | pass, exit 0 (19 files, 270 tests; both `admissions.test.ts` and `learner-hold.test.ts` listed in verbose output, no failures) |
| `pnpm -F @abm/crm typecheck` | pass, exit 0 |
| `pnpm -F @abm/crm build` | pass, exit 0 |

## Step 0: phase text corrections applied first

F1 (contact via `tx.insertVersioned`, anchor), F2 (`roster.ts:79`, `foldText` from contracts), F3 (`queries.ts:465`), F4 (pool SQL with `owner_user_id IS NULL`), F5 (director reads `/learners`, `/learners/:id`, `/partners*` and nav; no director write command), the owner-eligibility risk fix (written into Task 2.2, with the new test) and the `expectedVersion` naming for lead-targeting commands. All are in the phase file.

## Files changed

Created:
- `apps/crm/migrations/0007_admissions.sql` (`lead_step`, `partner_contract`, `partner_contract_step`, two indexes)
- `apps/crm/src/worker/learner-hold.ts` (`holdExpiry`, `isHeld` with owner eligibility, SQL twins `OWNER_ELIGIBLE_SQL`, `HAS_WON_SQL`, `IN_POOL_SQL`, shared contact-state columns)
- `apps/crm/src/worker/learner-commands.ts` (13 handlers, `learnerHandlers`)
- `apps/crm/src/worker/learner-queries.ts` (`GET /learners`, `/learners/:id`, `/partners`, `/partners/:id` data, phone masking)
- `apps/crm/src/worker/command-result.ts` (see deviation 1)
- `apps/crm/src/web/pages/learners.tsx`, `learner-new.tsx`, `learner-detail.tsx`, `partners.tsx`, `partner-detail.tsx`
- `apps/crm/test/learner-hold.test.ts` (8 tests), `apps/crm/test/admissions.test.ts` (27 tests)

Modified:
- `packages/contracts/src/index.ts` (13 schemas, 13 `COMMANDS`, `PARTNER_CONTRACT_STATUSES`, `learnerLostReasonLabel`)
- `apps/crm/src/worker/commands.ts` (handler map, learner guard in `changeStage`, `assignLead`, `releaseLead`, `requestOwnerChange` and the two agent proposals, `pipeline` on `LeadRow`, dry-run early return)
- `apps/crm/src/worker/index.ts` (4 GET routes, readers: sale, leader, admin, director)
- `apps/crm/src/worker/queries.ts` (`leadHealth` returns no SLA for learner leads, `l.pipeline` in `LEAD_SELECT`, `searchMatcher` exported, B2B list filter)
- `apps/crm/src/worker/guarded-tx.ts` (three new `GuardedTable` values, `hasAnchor`)
- `apps/crm/src/worker/roster.ts` (export `readRecords`, `detectDelimiter`)
- `apps/crm/src/web/router.tsx`, `components/layout.tsx` (nav "Học viên" and "Đối tác" for sale, leader, director, admin), `types.ts`
- `apps/crm/test/helpers/reset-db.ts` (three new tables before `lead` and `account`)
- phase-02 file (corrections, `status: completed`)

## Deviations, each with its reason

1. **New file `command-result.ts`.** `fail`, `ok`, `Ctx` and `Handler` moved out of `commands.ts`. `learner-commands.ts` needs them while `commands.ts` imports `learnerHandlers`; sharing through `commands.ts` would create a module cycle with a temporal-dead-zone risk when the handler map is built.
2. **`roster.ts` edited (not in the phase list).** Only two `export` keywords, so the CSV import reuses the delimiter detection and RFC 4180 reader as the phase text asked.
3. **`GuardedTx.hasAnchor` plus an early return in `runCommand`.** The CSV preview (`commit: false`) must write nothing, but `runCommand` always calls `tx.idempotency`, which throws without a guarded row. A handler that stages nothing now returns its result directly (no idempotency row, no commit). The same path covers a commit with zero valid rows.
4. **`importContractLearnersInput` has an optional `ownerUserId`.** Admin has no team or department, and a lead needs both; without it the Admin role listed for the command could never import. Same rule as `createLearnerLead`: Admin must name an active Sale or Leader, other roles may not.
5. **B2B lists exclude learner leads.** `leadWhere` in `queries.ts` now adds `l.pipeline = 'b2b'`, so `/leads`, global search and account pages leave learner leads out (otherwise a Sale would see learner leads with raw stage codes in the B2B list). Learner tasks still show in the task list.
6. **Director sees phone and holder of held customers.** The phase text masks for "not Admin and not Leader of the owner team"; with F5 the director reads org-wide, so masking would defeat the read-only role. Director is treated like Admin for reading only.
7. **Sale B opening a customer held by Sale A gets a restricted profile, not 404.** The phase test list requires `phone` to be `null` on `GET /learners/:id` for that case, while Task 2.6 says other sales only see pool customers. The response is `restricted: true` with name, source, stage, `phone: null`, no holder name and no history. Pool customers return the same shape with the phone shown (not held).
8. **Contacts adopted by id.** `createLearnerLead` with a `contactId` that has no learner lead (for example a B2B contact) is taken over by the owner with a fresh hold. A `contact_point` assertion also stops two concurrent creations of the same number from both landing as new customers.
9. **Import commits the valid rows and skips error rows.** The errors come back in the same response. The phone lookup is one query for the whole file, to stay inside the per-request query allowance on the free plan.
10. **Expired-hold customers show "Chưa gắn" even in the owner's own list.** Consistent with them being in the pool; the owner can claim the customer again to renew the hold.
11. **`isHeld` signature.** The contact argument carries an extra `owner_eligible` flag for the owner-role risk fix; `IN_POOL_SQL` is its SQL twin, so the pool list, claim, duplicate check and `isHeld` use one rule.

## Concerns for later phases

- Dashboard and overview aggregates (`dashboard`, `overview.ts`) still count learner leads in B2B totals; phase 06 reports should separate them.
- A 200-row import is about 15 statements per row in one D1 batch. Not measured on remote D1 (no remote access this run); phase 07 should try a near-limit file on eval.
- Each consent write bumps `contact.version`, so a claim or owner change right after can get `STALE_VERSION`; the screen reloads and the user retries.
- `partner_contract` is created with `accountName` as a new `account` each time (no folded-name dedupe), as the phase text says. Existing partner accounts can be picked by id.

Status: DONE
Summary: Phase 02 admissions is implemented end to end (migration 0007, hold logic with owner-eligibility rule, 13 commands, read routes with phone masking, five web screens, 35 new tests). `pnpm -F @abm/crm test` (270 tests), `typecheck` and `build` all exit 0.
