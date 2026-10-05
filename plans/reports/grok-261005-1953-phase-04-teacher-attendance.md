# Phase 04 teacher attendance: implementation report

Status: completed. Verify passed on the first run. Nothing committed, nothing deployed, no remote Wrangler, no dev server.

## Verify results

| Command | Result |
| --- | --- |
| `pnpm -F @abm/crm test` | pass, exit 0. 21 files, 289 tests. Output contains `attendance.test.ts` (7 tests) and does not contain `failed`. |
| `pnpm -F @abm/crm typecheck` | pass, exit 0 |
| `pnpm -F @abm/crm build` | pass, exit 0. Vite printed its chunk-size warning and still exited 0. |
| `Select-String -Path apps/crm/src/worker/attendance.ts -Pattern "charge\|payment"` | no lines |

The suite covers the phase checks: unmarked roster, pending and deferred seats omitted, unassigned teacher `FORBIDDEN`, first `late` moves the seat to `studying` and marks step `started` done, makeup keeps the original absence and lists only that student, trial `present` moves the lead to `trial_done` and marks step `trial` done, the teacher attendance JSON has no `phone` and no key containing `amount`, and a teacher gets 403 on class detail while `/my-classes` shows only assigned classes.

## Files changed

Created:

- `apps/crm/migrations/0009_attendance.sql`
- `apps/crm/src/worker/attendance.ts`
- `apps/crm/src/web/pages/my-classes.tsx`
- `apps/crm/src/web/pages/session-attendance.tsx`
- `apps/crm/test/attendance.test.ts`
- `apps/crm/test/helpers/learner-fixtures.ts`

Modified:

- `packages/contracts/src/index.ts` (`ATTENDANCE_STATUSES`, `markAttendance`, `createMakeupSession`)
- `apps/crm/src/worker/commands.ts` (spread `attendanceHandlers`)
- `apps/crm/src/worker/index.ts` (`GET /my-classes`, `GET /sessions/:id/attendance`)
- `apps/crm/src/worker/guarded-tx.ts` (`attendance` on `GuardedTable`)
- `apps/crm/src/worker/academic-commands.ts` (export `ENROLLMENT_FROM`, add `markAttendance: ['confirmed']`)
- `apps/crm/src/worker/academic-queries.ts` (`classDetail.absences`)
- `apps/crm/src/web/pages/class-detail.tsx` (makeup form on absent and excused rows)
- `apps/crm/src/web/pages/dashboard.tsx` (teacher to `/my-classes`, academic to `/courses`, before the dashboard query)
- `apps/crm/src/web/components/layout.tsx` (nav "Lớp của tôi")
- `apps/crm/src/web/router.tsx`
- `apps/crm/test/academic.test.ts` (shared fixtures)
- `apps/crm/test/helpers/reset-db.ts` (`attendance` before `trial_booking`)
- phase-04 file (`status: completed`)

`mcp-tools.ts` was not edited. `addSession` still rejects `kind = 'makeup'`.

## Deviations

1. **Command fields the type requires.** `CommandDefinition` requires `riskLevel`, `idempotent`, `expectedVersion`, and `agentNeedsApproval`. `markAttendance` is `riskLevel: 'medium'`. `createMakeupSession` is `riskLevel: 'low'`, `expectedVersion: false`, `agentNeedsApproval: false`. The phase named roles for the makeup command and did not name those three fields. Neither command is a bot tool.
2. **Trial activity only when the stage changes.** A present or late trial mark writes `stage_changed` only when the lead is an active learner lead in `trial_booked` and step `trial` is not `skipped`. A skipped step stays skipped, the stage stays put, and that activity is not written. Journey steps go through `markStepDone`, which leaves a `done` or `skipped` step unchanged. Enrollment status changes only when the current status is in `ENROLLMENT_FROM.markAttendance` (`confirmed` to `studying`). A seat already `studying`, or a historical `completed` / `transferred` / `withdrawn` seat, is left as it is.
3. **UTC helper is local.** `attendance.ts` normalizes `startsAt` with `new Date(x).toISOString()`. `academic-commands.ts` does not export its copy. The makeup form sends `fromLocalInput`, the same helper the class screen uses for session times.
4. **Screens were not clicked.** The task forbids starting a dev server. Checks are the test suite, typecheck, build, and the static scan.
