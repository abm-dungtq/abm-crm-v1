---
title: Phat hanh cong hoc vien LMS
date: 2026-10-17
summary: "Deploy 3 Worker LMS, migration 0024, dang cam nang BSR, hoc vien thu dang nhap duoc; video cho Stream"
---

# Phat hanh cong hoc vien LMS

## What happened
Phase 08: backed up D1, applied migration 0024 remotely, created R2 bucket, set the shared content signing secret, deployed abm-lms-content, abm-lms and abm-crm-eval. Created test class/contract/learner through real CRM commands with a short-lived admin session (revoked). Published the BSR handbook (26 parts). Browser walk: login, reminder banner, lesson menu, iframe content, empty video box.

## Problems
Browser typing through the Vietnamese IME garbled the email once; wrangler JSON output needed the progress lines stripped.

## Next steps
Enable Stream for video; 200-row live import test needs user approval; show the section title instead of the id on the home card.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
