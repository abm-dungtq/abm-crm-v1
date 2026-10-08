---
title: Omnichannel inbox plan with GoClaw bot
date: 2026-10-08
summary: 10-phase handover plan for Zalo+Messenger inbox in ABM CRM; review fixes applied
---

# Omnichannel inbox plan with GoClaw bot

## What happened
Planned the omnichannel inbox in `plans/261008-1430-omnichannel-inbox-goclaw/` (10 phases). Shared Zalo numbers come in through the Node sidecar `apps/zalo-bridge` on the Windows box, and Fanpage messages through a Messenger webhook. GoClaw deepseek-flash replies, the Worker with D1 orchestrates, and the leased `channel_command` table acts as the outbox. Leads land in `lead_intake` for staff to classify. Assignment is manual or round-robin, with SLA reminders and alerts sent to Lark. Group schedules run behind approval, quiet hours, a daily cap, opt-out and a feature flag.

## Decision
The supervisor review returned NO-GO until these fixes were made, and all of them are now applied:
- `fromSelf` echo fallback matches by text within 120s.
- The lease is 300s (longer than the 180s GoClaw timeout), and results only apply when `attempts` matches.
- The account external id is taken from the `connected` event.
- `reset-db` re-seeds the singleton rows.
- Staff can link an intake to an existing contact.
- Skipped schedule runs record `last_skip_reason`.
- GoClaw session cleanup stops if it would need the admin token.

ADR-009 records why staff confirmation replaces the lead-only `approval` table.

A python heredoc inside bash failed on quoting. Writing the script to a file fixed it.

## Next steps
Blocked until plans 261004-1457 and 261004-1300 finish phase 05. After that, `/ak:cook --advice`.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
