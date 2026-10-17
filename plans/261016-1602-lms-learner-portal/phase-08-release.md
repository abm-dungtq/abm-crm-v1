---
phase: 8
title: "Release: backup, remote migration, Cloudflare resources, deploy, live check with the BSR handbook"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1, 2, 3, 4, 5, 6, 7]
---

# Phase 08: Release (Opus runs this phase)

## Goal
The three Workers run on Cloudflare with migration 0024 applied after a fresh backup, a test class shows the BSR handbook with one Stream video to a test learner, and every acceptance criterion in `plan.md` is checked live.

## Rules
- Executor: Opus (the only actor allowed to run remote commands). Each item that needs the user is marked **[user]**; ask and wait.
- Never print secret values; pass them through `wrangler secret put` prompts or files under `~/.abm/`.
- Commit only after the user agrees (git-manager, conventional commits, no AI references in messages).

## Tasks

### Task 8.1 — Code review and local gates
- Steps: review phases 01–07 diffs (`git diff --stat`, read the new modules); run `pnpm -r typecheck`, `pnpm --filter @abm/crm build`, `pnpm --filter @abm/lms build`, then `pnpm -r test` and `node --test apps/crm/scripts/lms-html.test.mjs`.
- Verify: every command exits 0; record test counts in the report.

### Task 8.2 — Cloudflare prerequisites
- Steps:
  1. **[user]** Enable Cloudflare Stream on the account (paid) and confirm the plan/price; create an API token with Stream Edit (save to `~/.abm/stream-api-token`) and give the account id (`~/.abm/cloudflare-account-id`).
  2. Create the Stream signing key: `POST /accounts/<id>/stream/keys`; keep `id` and `jwk` (base64) for 8.4 without printing them. Read the customer code from any video's playback URL or the Stream dashboard.
  3. `npx wrangler r2 bucket create abm-lms-content` (from `apps/crm`).
- Verify: `npx wrangler r2 bucket list` output contains `abm-lms-content`.

### Task 8.3 — Backup and migration
- Steps (from `apps/crm`):
  1. `npx wrangler d1 export abm-crm-eval --remote --output ../../exports/abm-crm-eval-before-0024-<yyyymmdd>.sql` and `npx wrangler d1 time-travel info abm-crm-eval` (record the bookmark).
  2. `npx wrangler d1 migrations apply abm-crm-eval --remote`.
- Verify: `npx wrangler d1 execute abm-crm-eval --remote --command "SELECT name FROM sqlite_master WHERE name IN ('learner_account','lms_program','lms_lesson','lms_lesson_video','lms_access','lms_progress','learner_session')"` returns 7 rows.

### Task 8.4 — Deploy and configure
- Steps:
  1. Generate `CONTENT_SIGNING_SECRET` (32 random bytes) and set it on all three Workers: `abm-crm-eval` (`apps/crm`), `abm-lms` and `abm-lms-content` (`apps/lms`, `-c wrangler.content.jsonc` for the latter).
  2. `abm-crm-eval`: secret `STREAM_API_TOKEN`; vars `STREAM_ACCOUNT_ID`, `LMS_CONTENT_ORIGIN` (= the content Worker URL) in `wrangler.jsonc`.
  3. `abm-lms`: secrets `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_JWK`; vars `LMS_CONTENT_ORIGIN`, `STREAM_CUSTOMER_CODE`.
  4. `abm-lms-content`: var `LMS_ORIGIN` (= the portal URL).
  4b. Narrow `frame-src` in `apps/lms/public/_headers` from `https://*.workers.dev` to the exact content origin.
  5. Deploy: `pnpm --filter @abm/lms deploy:content`, `pnpm --filter @abm/lms deploy`, `pnpm --filter @abm/crm deploy`. Record version ids.
- Verify: `curl -s -o NUL -w "%{http_code}" <portal>/api/me` prints `401`; `curl -s -o NUL -w "%{http_code}" "<content>/c/x/1?exp=1&sig=00"` prints `403`.

### Task 8.5 — Live walkthrough
- Steps:
  1. **[user]** Admin sets the default learner password on "Tài khoản học viên".
  2. `node scripts/issue-lms-publish-token.mjs --email <academic or admin email>` **[user picks the email]**.
  3. **[user]** Create or choose a test class (e.g. "BSR-AI-K1 (thử)") and a test learner with an email the user controls; enrol and confirm.
  4. `node scripts/lms-publish.mjs --class <id> --file "<BSR handbook path>" --groups "b1=Buổi 1;b2=Buổi 2;b3=Buổi 3;lib=Thư viện" --dry-run`, then without `--dry-run`.
  5. **[user]** Provide one Zoom MP4; `node scripts/lms-upload-video.mjs …` to section `b1p1`.
  6. Browser check (agent-browser or the user's browser): learner login with default password → banner shows; program card; lesson page shows 26 lessons, iframe content, menu switching, video plays; change password; log in again.
  7. Accepted limits to state in the report: signed content and video URLs are not bound to one learner (a shared link works for up to 2 hours); any academic/admin agent token can publish.
  8. Security checks: open the content URL with an altered `sig` → 403; in the lesson page devtools, run `fetch('https://example.com')` inside the iframe context → blocked by CSP; `document.cookie` inside the iframe is empty; a second learner without enrollment opening `/hoc/<programId>` → not found.
  9. Set `review_days = 0` on a class whose last session is in the past → card shows "Đã hết hạn xem lại"; restore.
  10. Partner import with class on a test contract (2 rows) → accounts created; Sale dashboard "won" unchanged.
  10b. **[user agrees first]** Import a 200-row synthetic CSV (throwaway names/phones) into a test class on the live D1; record wall time and any limit error (D1 Free: 50 queries per invocation; whether one batch counts as one query is undocumented). If it fails, stop and plan chunked commits (~50 rows); then delete the synthetic rows with the user's approval after a backup.
  11. Staff screens checked as academic, teacher (video only), director (read-only).
- Verify: each step's expected result observed; screenshots saved under `plans/reports/assets/lms-release/`.

### Task 8.6 — Docs and close-out
- Steps:
  1. Write `docs/adr/adr-011-learner-lms-portal.md` (decision, shared D1 rule, content isolation, Stream signing, default password trade-off).
  2. Update `docs/README.md` index and `docs/engineering/deployment-baseline.md` with the two new Workers and their secrets (names only).
  3. Update `plan.md` status/phase table, write `plans/reports/deploy-<yymmdd>-lms-learner-portal.md`.
  4. **[user]** Ask whether to commit; on yes, use git-manager.
- Verify: `ak plan validate plans/261016-1602-lms-learner-portal` exits 0.

## Rollback
- Workers: `npx wrangler rollback` per Worker to the recorded previous version (CRM) / delete the two new Workers.
- Database: migration 0024 only adds columns/tables; to roll back data, restore from the Time Travel bookmark recorded in 8.3 (`npx wrangler d1 time-travel restore abm-crm-eval --bookmark <id>`), which also discards any CRM writes after it — confirm with the user first.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Spawn the `kongming` subagent for next-step counsel and pass:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Apply kongming's guidance, then re-run the Verify step.
If `kongming` cannot be spawned in this environment, STOP and report the same
failure evidence to the user. Never continue by self-reasoning.

## Supervisor amendments (kongming security review after phase 06)
- Set `LMS_ORIGIN` on `abm-lms-content` to the exact portal scheme+host with no trailing slash (it goes into `frame-ancestors` verbatim; empty now returns 500).
- Narrow `frame-src` in `apps/lms/public/_headers` to the content origin plus `https://customer-<code>.cloudflarestream.com`.
- **[user]** Optional: a Cloudflare WAF rate-limit rule on `POST /api/auth/login` (about 10 per minute per IP). Lockout already limits guesses per account.
- Accepted limits to record in the report: the handbook may open popups that keep `window.opener` (authors are ABM staff); the "chưa sẵn sàng" login message reveals that an account exists only while the default password is unset.
