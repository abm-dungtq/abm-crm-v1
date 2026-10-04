---
handoff-version: 1
generated: 2026-10-04T03:05:00Z
generator: ak:handoff@2.0.0
focus: "viết tài liệu đến phần này, sau đó xây dựng tiếp giao diện của CRM /ak-frontend-design sau đó deploy cloudflare để đánh giá CRM"
workspace: D:/TQD/CRM
branch: main
head: eea627e
---

# HANDOFF: CRM frontend design and Cloudflare evaluation deploy

## Mission and current status
Focus: "viết tài liệu đến phần này, sau đó xây dựng tiếp giao diện của CRM /ak-frontend-design sau đó deploy cloudflare để đánh giá CRM".

Outcome wanted: a working CRM web UI (MVP1 scope: Customer 360 cơ bản, Lead/Ownership, Pipeline/Activity/Next Action, Task/Audit/Dashboard cơ bản) built with the frontend-design skill, deployed to Cloudflare so the user can evaluate it.

Done:
- Foundation plan `plans/261003-2239-abm-crm-foundation-poc/` phases 01–05 completed and committed; phase 06 local PASS (live part pending); phase 07 docs done, conclusion waiting for accountant.
- Business decision pack approved (QĐ1–QĐ14 except QĐ10 which ADR-001 now covers), ERD v1 + state machines approved, ADR-001/003/005 accepted, ADR-002/004 proposed.
- D1 guarded-write pattern proven on real Cloudflare (race 20/20, Time Travel restore ~5 s); PoC resources deleted.
- GoClaw connected to Lark (channel `abm-lark`, bot `DungTQ_Agent`, websocket), user set as sole owner and sole group writer; GoClaw restarted OK.

Remaining:
- Build the CRM UI (`apps/web`) and the minimal API it needs (`apps/api` or one Worker serving both), deploy to Cloudflare for evaluation.
- Lark app scopes/contact range, App Secret rotation, MISA Excel file, Hermes-on-other-machine check, phase 06 live identity run, phase 08 exit gate.

Urgency: normal; user wants an evaluable CRM soon.

## Scope and guardrails
Workspace: D:/TQD/CRM (pnpm 12 monorepo, `apps/*`, `packages/*`, `poc/*`).

In scope:
- New `apps/web` (React + Vite + TanStack Router/Query PWA per ADR-001) and a Hono Worker API with D1 (Drizzle) implementing MVP1 read/write for the ERD MVP1 entities actually needed by the UI.
- Synthetic seed data only (Vietnamese sample names, no real customer data).
- One evaluation deployment on Cloudflare (isolated names, e.g. `abm-crm-eval`), protected by Cloudflare Access if available.

Out of scope:
- Production deployment, real customer data import, MISA writes, GoClaw/Lark configuration changes, phase 08.

Constraints (user and plan):
- Locked decisions in `plans/261003-2239-abm-crm-foundation-poc/plan.md` "Quyết định đã chốt" and `docs/decisions/business-decisions-v1.md` must not be reopened.
- Agent permissions: agent may log activity, create next action, create lead with duplicate check; stage change, Won/Lost, owner change, external send need approval.
- Writes must use the ADR-003 guard pattern (version + `last_txn_id` nonce + `_guard` CHECK) with audit + outbox in the same batch.
- Commands defined in `packages/contracts` per ADR-005 (Zod schema, requiredScope, riskLevel, stable error codes).
- UI language Vietnamese; timezone display Asia/Ho_Chi_Minh; money as integer minor units.
- Commits: conventional format, no secrets; Markdown only under `plans/` or `docs/`.

Safety boundaries:
- Never print or commit secrets (Cloudflare tokens, Lark App Secret, GoClaw gateway token). Lark credentials live only in `D:\Goclaw\data\lark-app.local.txt` (outside repo).
- Back up any database before schema/data change.
- Remote Cloudflare resource creation for the evaluation deploy requires the user's `wrangler login` (user previously authorized PoC resources; confirm for the eval deploy).
- Do not stop/restart GoClaw without asking (it serves live Telegram and Lark bots).

## Current state
Branch: main
HEAD: eea627e7b6f2e379a1ab20d6ea37d2b3f3f9ab36
Working tree: dirty (untracked only)
Changed files: none tracked
Untracked files:
- `.claude/` (local agent memory; intentionally not committed)
- `plans/reports/operations-261004-0944-goclaw-lark-channel.md` (GoClaw Lark ops record; should be committed)
- `plans/handoffs/crm-frontend-design-cloudflare-deploy-20261004-1005.md` (this file)
Intentional local modifications: yes

Commits so far on main: 0d2b7c7 bootstrap; 11cfbbd decision pack; eb584b9 MISA docs; 117e461 ERD; da25460 ADRs and matrices; 8889c74 GoClaw identity PoC; 0d847e9 D1 guard PoC; eea627e plan status.

Outside repo (observed this session):
- GoClaw `D:\Goclaw`: channel instance `abm-lark` (feishu, domain lark, websocket) bound to agent `tqd`; `start-goclaw.ps1` sets `GOCLAW_OWNER_IDS` to `system` plus the admin Lark open_id; backups in `D:\Goclaw\backups\` (DB dump, config.json, start script).

## Decisions and rationale
- Stack per ADR-001: Workers + D1 + Hono + Drizzle + React/Vite/TanStack PWA — user mandated Cloudflare-only — rejected Twenty/Laravel — `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`.
- Test tooling: Vitest 4.1.11 + `@cloudflare/vitest-plugin` 1.3.6 instead of `defineWorkersConfig` (pool 0.22 removed `./config`) — ADR-001 text not yet updated — `plans/reports/poc-d1-guarded-write-result.md`.
- pnpm 12 needs `allowBuilds` for esbuild/workerd in `pnpm-workspace.yaml` — install failed otherwise.
- Web auth for PoC/eval: Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) verified in Worker; Lark OAuth before pilot — ADR-002 (proposed).
- Phase 06 live identity deferred; user chose local-only for this round.
- Phase 07: MISA conclusion "Chưa xác định"; user now chose MISA Excel export as temporary data for GoClaw checks (file path not yet given).
- GoClaw Lark: user is sole admin (owner_ids + sole writer in 5 groups); other members chat only.
- Decision pack answers (2026-10-03): SLA first contact 4 working hours, release after 24; stage SLAs in working days; Leader approves owner change and assigns leads manually; retention audit ≥ 5 years; active lead sources Facebook, Zalo, Website, Landing, Form, Referral, Partner, Sale self-sourced.

## Work performed
- Orca run `run_f74b66bd0da4` with Codex gpt-6.1-sol workers for phases 01–07; coordinator reviewed, answered questions, committed each phase.
- Fixed pnpm install (`allowBuilds`), approved Vitest plugin deviation.
- Phase 05 remote: created/used isolated D1 `abm-crm-poc` + Worker, race and restore passed, then deleted both.
- GoClaw: pg_dump backup, created `abm-lark` channel via `POST /v1/channels/instances`, verified Lark API (bot OK, 5 groups visible; members/contacts denied for missing scopes), added admin writer grants for 5 groups, updated owner IDs, restarted GoClaw (6.6 s downtime; Lark and Telegram reconnected, health 200).
- Wrote `plans/reports/operations-261004-0944-goclaw-lark-channel.md`.
2 redactions applied (Lark App Secret and App ID omitted).

## Verification
| Check | Command | Outcome | When |
|---|---|---|---|
| D1 PoC tests | `pnpm -F @abm/poc-d1-guard test` | 8 passed | 2026-10-04 09:33 |
| GoClaw PoC tests | `pnpm -F @abm/poc-goclaw-identity test` | 8 passed | 2026-10-04 09:33 |
| Remote race | `node poc/d1-guard/scripts/race.mjs <worker-url>` | `RACE_OK pairs=20 winners=20 audit=20` | 2026-10-04 |
| GoClaw health after restart | `GET http://127.0.0.1:18790/health` | 200 | 2026-10-04 10:03 |
| Lark ws | gateway.log | `lark ws: connected` | 2026-10-04 10:03 |
| Writer grants | psql `agent_config_permissions` | 5 rows, admin only, no wildcard | 2026-10-04 |

Not run:
- Phase 06 live identity scenarios (user deferred).
- Lark group member listing (app lacks `im:chat.members:read`).
- Any CRM UI build or deploy (not started).

## Open risks and blockers
- Type: blocker. Owner: user. Impact: Lark app needs scopes `im:chat:readonly`, `im:chat.members:read`, `contact:user.base:readonly`, `contact:department.base:readonly`, contact range = all members, persistent-connection event `im.message.receive_v1`, publish.
- Type: risk. Owner: user. Impact: Lark App Secret was pasted in chat; rotate and update `abm-lark` credentials.
- Type: question. Owner: user. Impact: is Hermes using app `DungTQ_Agent` on another machine (dual websocket splits events)?
- Type: question. Owner: user. Impact: keep agent `tqd` (TQD customer service) for internal CRM, or create a dedicated agent.
- Type: question. Owner: user. Impact: MISA Excel file path and report type.
- Type: blocker for deploy. Owner: user. Impact: `wrangler login` and consent for evaluation resources; Cloudflare Access policy for the eval URL.
- Type: risk. Owner: agent. Impact: ADR-001 text still says `defineWorkersConfig`; update when building apps.
- Type: question. Owner: user. Impact: real department/Leader list and sample product still placeholders.

## Exact next actions
1. **First safe step** — read `plans/261003-2239-abm-crm-foundation-poc/plan.md`, `docs/architecture/erd-v1.md`, `docs/security/permission-matrix-v1.md`, `docs/adr/adr-003-d1-guarded-write-pattern.md`, `docs/adr/adr-005-command-contracts.md`, and `poc/d1-guard/src/guarded-write.ts`; commit `plans/reports/operations-261004-0944-goclaw-lark-channel.md` and this handoff.
2. Create a plan for the evaluation build (`plans/261004-*-crm-mvp1-eval-ui/`) with acceptance criteria: screens, API commands, seed, deploy URL.
3. Run `/ak-frontend-design` for the CRM UI: dashboard, pipeline kanban by stage QĐ1, lead list/detail with Next Action enforcement, Customer 360 (account/contact), tasks, approvals queue, audit timeline; Vietnamese UI.
4. Implement `packages/contracts`, Worker API (Hono + D1 + guard pattern), `apps/web`; synthetic seed; local tests (`pnpm test`, typecheck).
5. Ask user to confirm Cloudflare eval resources and run `! npx wrangler login`; create isolated D1 `abm-crm-eval`, apply migrations, seed, deploy Worker + static assets, put Cloudflare Access in front if possible.
6. Report URL and evaluation checklist to the user; then resume Lark scope verification and MISA Excel ingestion when the user provides them.

## Source pointers
- `plans/261003-2239-abm-crm-foundation-poc/plan.md`
- `plans/261003-2239-abm-crm-foundation-poc/reports/orca-cook-checkpoint.md`
- `plans/reports/brainstorm-261003-2022-abm-agentic-crm-implementation.md`
- `plans/reports/operations-261004-0944-goclaw-lark-channel.md`
- `plans/reports/poc-d1-guarded-write-result.md`
- `plans/reports/poc-goclaw-lark-identity-result.md`
- `docs/decisions/business-decisions-v1.md`, `docs/decisions/open-questions.md`
- `docs/architecture/erd-v1.md`, `docs/architecture/state-machines-v1.md`
- `docs/adr/` (ADR-001…005)
- `docs/security/permission-matrix-v1.md`, `docs/security/action-risk-matrix-v1.md`
- `docs/engineering/` (environments, deployment-baseline, test-strategy, coding-conventions)
- `docs/integrations/misa/`
- `docs/source-package/sources/PRD-ABM-CRM-Revenue-Customer-Operations-v2.1.md`
- `poc/d1-guard/`, `poc/goclaw-identity/`
- GoClaw: `D:\Goclaw\docs\goclaw-system-overview.md`, `D:\Goclaw\start-goclaw.ps1`, `D:\Goclaw\backups\`
