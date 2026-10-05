---
title: Overview board for Admin and Director
date: 2026-10-04
summary: "Kanban overview with heat map, approvals and bot health; deploy pending consent"
---

# Overview board for Admin and Director

## What happened
Built the "Toàn cảnh" overview for Admin and Director in three commits (23abadb, 86e8eb2, 221a7a5): KPI strip, kanban from intake queue through Won/Lost in period, department/team heat map, approvals, bot/Lark health, workload, sources, recent audit. Also removed the old abm-crm-poc MCP grant from the GoClaw agent after a backup.

## Decision
Counts come from SQL GROUP BY; cards, risk and matrix from one capped lead list with a visible truncation notice. Audit feed returns names and codes only because before/after JSON can hold phone or email. Win rate is won/(won+lost) closed in period.

## Lessons
`pnpm -F pkg deploy` hits pnpm's built-in deploy; use `run deploy`. Git Bash profile breaks background runs here; use PowerShell. Two connected Chrome browsers block automated visual checks unless the user picks one.

## Next steps
User consent to deploy to eval; 375px visual check once a browser is chosen; bot rollout still waits on Lark links for testers.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
