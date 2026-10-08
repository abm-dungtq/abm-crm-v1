---
title: Omnichannel inbox built locally
date: 2026-10-08
summary: Phases 01-09 of the inbox plan implemented on feat/omnichannel-inbox; phase 10 waits on blockers and consent
---

# Omnichannel inbox built locally

## What happened
Phases 01-09 of `plans/261008-1430-omnichannel-inbox-goclaw` were implemented locally on `feat/omnichannel-inbox`, 38 commits, not pushed:
- D1 migrations 0012-0017
- leased command dispatcher
- HMAC bridge API
- ai/human/paused conversation flow
- Node sidecar `apps/zalo-bridge` (zca-js)
- inbox, intake, assignment and Zalo group UIs
- Messenger webhook and send

Final checks: 455 CRM tests and 45 bridge tests pass; typecheck and build are clean. Phases 04, 05 and 06 ran in parallel git worktrees and were merged cleanly.

## Decision
- The user allowed local work even though the phase 05 of plans 261004-1457 and 261004-1300 is still pending. Phase 10 (remote rollout) stays blocked on those plans.
- The executor built `staff_context_pending` as a 0/1 flag. Changed it to TEXT before anything shipped.
- Echo detection now requires whole-line matches, so short staff replies like "ok" are not swallowed.
- GoClaw session cleanup runs per user id with an unbound operator key, chosen by the user over granting an admin key.
- The final review found that `customer_bot_switch` was not re-checked when a completion was applied. Fixed: bot replies and bot sends are dropped once the switch is on or `bot_enabled` is 0.

## Next steps
- User: submit Meta App Review (Task 1.6).
- Finish phase 05 of plans 1457 and 1300, then run phase 10 with a consent gate at each step.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
