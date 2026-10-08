---
title: Omnichannel inbox deployed to eval
date: 2026-10-08
summary: Migrations 0012-0017 rehearsed and applied on eval D1; Worker da4b119e live with inbox crons
---

# Omnichannel inbox deployed to eval

## What happened
- Rehearsed migrations 0012–0017 on a scratch D1. A full-export import failed with D1_RESET_DO three times; a data-only import without the PRAGMA failed on foreign keys. What worked: split the schema and data exports, then import the data with parent tables first. The first, invalid attempt (migrations applied to an empty DB) was caught and redone.
- Backed up eval and recorded a time-travel bookmark, then applied the six migrations. foreign_key_check came back empty and row counts were unchanged.
- Deployed Worker da4b119e with crons "* * * * *" and "0 14 * * *". `pnpm -F @abm/crm deploy` hits pnpm's built-in deploy command; `run deploy` is the correct form.
- Smoke checks passed. A 75 s tail showed the cron running ok with no errors.

## Decision
- APP_URL lives in wrangler vars, not in secrets.
- LARK_INBOX_CHAT_ID must be set before the pilot QR login, because send_lark gives up after about 62 minutes.
- No D1 time-travel restore and no wrangler rollback while the Zalo bridge task is running.

## Next steps
- User sets BRIDGE_SECRET and LARK_INBOX_CHAT_ID.
- GoClaw changes need consent: backup, agents, unbound key, rpm 120, drop the abm-crm-poc grant.
- Scheduled Task install, QR login for two pilot numbers, then six live scenarios.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
