---
title: Plan CRM bot gateway with Admin full write
date: 2026-10-04
summary: "Five-phase plan for /api/mcp gateway, Admin write, Lark leader DMs; review fixes folded in"
---

# Plan CRM bot gateway with Admin full write

## What happened
Planned the main-CRM bot gateway (plans/261004-1457-crm-bot-gateway, 5 phases, --advice). User decisions: Admin full business write on web and bot; Admin via bot executes directly; Sale/Leader via bot create approvals; only Won/Lost, assign and owner change DM the team Leader on Lark; bot returns full PII per requester scope.

## Lessons from kongming review
- runCommand hashes expectedVersion, so a repeated MCP call after the version bumps returns IDEMPOTENCY_CONFLICT; adapter needs a 5-minute replay window then a version-suffixed key.
- Hono c.executionCtx throws when tests call app.fetch without a ctx; use a background() helper.
- originGuard and requireActor would block /api/mcp; register the route before them and keep it under /api/* (run_worker_first).
- Rebuilding the approval table to widen the kind CHECK must recreate approval_lead_kind_status from 0002.
- Kill-switch assert must COALESCE a missing row to "off".
- Deliver Lark DMs only for event ids from the current transaction, never by scanning pending outbox rows.

## Next steps
Execute phase 01 (Admin business write on web) via /ak:cook --advice once the user confirms.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
