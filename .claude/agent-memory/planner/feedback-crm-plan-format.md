---
name: crm-plan-format
description: How plans in the ABM CRM repo must be shaped - executors, Failure Protocol wording, language split, release phase owner
metadata:
  type: feedback
---

CRM plans: plan.md and brainstorm reports in Vietnamese, phase files in English. Each phase is sized for one Claude fullstack-developer run, with "Rules for the executor", a Files list, and tasks written as Target/Steps/Verify. The last phase is a release phase run by Opus: D1 export, Time Travel bookmark, `migrations apply --remote`, deploy, then live checks with the user.

The Failure Protocol says: STOP, report BLOCKED to Opus with the exact command and output, never spawn kongming.

**Why:** the user set this as the default for delegated work since 2026-10-14 (see project memory cook-with-grok-opus-advisor). Executors never commit, deploy or run wrangler --remote.

**How to apply:** copy the format of plans/261025-1500-internal-chat-tasks-agents for any new CRM plan. Do not add kongming escalation paths. Keep plan and phase ids out of code, test names and migration names.
