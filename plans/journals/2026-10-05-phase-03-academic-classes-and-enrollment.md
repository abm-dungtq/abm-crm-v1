---
title: Phase 03 academic classes and enrollment
date: 2026-10-05
summary: "Courses, classes, sessions, and enrollment commands pass 280 tests after restoring the actor binding."
---

# Phase 03 academic classes and enrollment

## What happened

Phase 03 of the learner-ops plan added courses, classes, sessions, trial booking, and enrollment commands. The first `pnpm -F @abm/crm test` and `typecheck` failed because `deferEnrollment`, `resumeEnrollment`, and `endEnrollment` still read `actor` after it was removed from the handler arguments. Restoring that binding made the suite pass: 20 files, 280 tests, including `academic.test.ts`. Typecheck and build also exited 0.

The kongming spawn for the failed verification was blocked by the harness (no visible payload). The post-phase go/no-go spawn was blocked because the proposed task did not describe what it would do.

## Decision

`actor` stays on every enrollment handler that loads a row by organization. Overdue deferrals compare `deferred_until` with the Vietnam calendar date. Trial session ids travel on `GET /courses` so Sale can book a trial without opening class detail. No new bot tools.

## Next steps

Phase 04 is attendance and the teacher screen. Dashboard and overview still mix learner leads into B2B totals; that split stays with phase 06. The new screens were not clicked: the Paseo browser could not reach loopback, and `agent-browser` is not installed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
