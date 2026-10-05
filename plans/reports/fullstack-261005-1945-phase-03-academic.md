# Phase 03 academic classes and enrollment: implementation report

Status: completed. Verify passes after one failed run. Remote D1 untouched, nothing deployed, nothing committed.

## Verify results

| Command | Result |
| --- | --- |
| `pnpm -F @abm/crm test` (first run) | fail, exit 1. `academic.test.ts` listed. 2 failed, 278 passed. `deferEnrollment` returned HTTP 500 `INTERNAL` because `actor is not defined`. |
| `pnpm -F @abm/crm typecheck` (first run) | fail, exit 1. `academic-commands.ts` lines 249, 261, 295: `Cannot find name 'actor'`. |
| `pnpm -F @abm/crm test` (after the binding restore) | pass, exit 0. 20 files, 280 tests. `academic.test.ts` listed, 10 tests, no failures. |
| `pnpm -F @abm/crm typecheck` | pass, exit 0 |
| `pnpm -F @abm/crm build` | pass, exit 0 |

The failed-verification kongming spawn was blocked by the harness (`task tool call has no visible payload`). Advisory supervision was unavailable for that checkpoint. Typecheck and the runtime named the same missing binding, so `actor` was restored on `deferEnrollment`, `resumeEnrollment`, and `endEnrollment`, and both Verify commands were re-run. A second spawn, for the post-phase go/no-go, was blocked because the proposed task did not describe what it would do. It was not retried.

## Files this phase owns

Created:

- `apps/crm/migrations/0008_academic.sql` (`course`, `class_group`, `class_teacher`, `class_session`, `enrollment`, `trial_booking`)
- `apps/crm/src/worker/academic-commands.ts` (14 handlers, enrollment state table)
- `apps/crm/src/worker/academic-queries.ts` (`GET /courses`, `GET /classes/:id`, `GET /enrollments/overdue-deferrals`)
- `apps/crm/src/web/pages/products.tsx`, `courses.tsx`, `class-detail.tsx`
- `apps/crm/test/academic.test.ts` (10 tests)

Modified:

- `packages/contracts/src/index.ts` (schemas and the 14 commands)
- `apps/crm/src/worker/commands.ts` (spread `academicHandlers`)
- `apps/crm/src/worker/guarded-tx.ts` (`course`, `class_group`, `class_session`, `enrollment`, `trial_booking`)
- `apps/crm/src/worker/index.ts` (three GET routes)
- `apps/crm/src/worker/learner-queries.ts` (course column, enrollments on the full learner profile)
- `apps/crm/src/web/router.tsx`, `components/layout.tsx`, `types.ts`, `pages/learner-detail.tsx`
- `apps/crm/test/helpers/reset-db.ts` (new tables before `lead`, `product`, and `app_user`)
- phase-03 file (`status: completed`)

`mcp-tools.ts` was not edited. The new commands are not bot tools.

## Deviations

1. **Trial sessions ride on `GET /courses`.** Sale and Leader cannot open `GET /classes/:id`. Their open-class payload includes scheduled trial sessions (`id`, `startsAt`, `durationMinutes`) so "Đặt học thử" has a session id. The manage payload used by Academic and Admin attaches the same `trialSessions` list on each class, because that screen also books trials and reserves seats from the learner profile. The phase's minimum fields remain.
2. **Full learner profile includes enrollments.** The list and "Hủy chờ" need the rows. The restricted profile does not include them.
3. **Class detail includes `teacherCandidates`.** Active users with role `teacher` or `admin`. Academic does not use the admin user list. `GET /team-members` is unchanged.
4. **Class detail is Academic and Admin only.** Director can `GET /courses` (the phase lists Director there) and receives 403 on `GET /classes/:id`. Teacher receives 403, not 404.
5. **Overdue deferrals use the Vietnam calendar date.** `deferred_until < today` in `Asia/Ho_Chi_Minh` (`en-CA`, `YYYY-MM-DD`). A deferral dated today is not overdue. Workers run in UTC, so a datetime comparison would mark today overdue.
6. **No command sets `studying`.** The defer/resume test updates the status in SQL, leaves `version` unchanged, then calls the commands.
7. **Money check is dynamic.** No fee, payment, invoice, tuition, or charge tables exist yet. The transfer test counts rows in any sqlite table whose name matches those words and expects the count to stay the same.
8. **`reserveSeat` uses its own lead loader.** The admissions loader rejects a lead that is not active, and a won lead is not active. The seat command still requires stage `won`, an editable lead, and an open class, and it bumps `lead.version`.
9. **`cancelPendingEnrollment` checks permission before status.** Another sale receives `FORBIDDEN` when the enrollment exists.
10. **Course column.** Qualifying enrollments (`pending`, `confirmed`, `studying`, `deferred`) supply distinct course names. With none, the column stays the attached product names from phase 02. The course filter matches that displayed string. There is one list query; search filters those rows in memory.

## Local smoke, not a substitute for the browser

`pnpm -F @abm/crm db:migrate:local` applied `0006`, `0007`, and `0008` to the persistent local D1. No `--remote`. A temporary Wrangler config with `DEMO_MODE=1` and no `AUTH_MODE` served `http://127.0.0.1:8787`. That config file was removed after the smoke. Results:

| Request | Result |
| --- | --- |
| `GET /api/courses` as `u-admin` | 200, `scope: manage`, `courses: []` |
| `GET /api/courses` as `u-lan` | 200, `scope: open`, `classes: []` |
| `GET /api/classes/no-such` as `u-admin` | 404 |
| `GET /api/enrollments/overdue-deferrals` as `u-lan` | 403 |
| `GET /api/products` as `u-admin` | 200, `[]` |

The Paseo browser tab received `ERR_CONNECTION_REFUSED` for `http://localhost:5173/` and `http://127.0.0.1:8787/`. `agent-browser` is not on PATH. The screens were not clicked. Vite on port 5173 was reachable from this machine's `curl` to `localhost` and was stopped with the worker.

## Left for later phases

- Dashboard and overview still count learner leads inside B2B totals. Phase 06 owns that split. Phase 02's kongming note asked for an earlier fix; this phase did not take it.
- There is still no command that moves an enrollment to `studying`.
- Makeup sessions stay forbidden on `addSession`. Phase 04 owns attendance and makeup.

Status: DONE
Summary: Phase 03 adds courses, classes, sessions, trials, and enrollment commands with 10 passing tests. The suite is 280 tests, and typecheck and build exit 0. The screens were not clicked because the available browser could not reach loopback.
