---
phase: 6
title: "New app apps/lms: learner portal Worker + SPA, and the content Worker"
status: completed
priority: P1
effort: "2d"
dependencies: [1, 2, 3]
---

# Phase 06: `apps/lms` — learner portal and content Worker

## Goal
A new workspace app `@abm/lms` with two Workers:
- `abm-lms` (portal): learner sign-in/out, change password, "my programs", the lesson page (menu + handbook iframe + per-lesson Stream video + mark done). Binds the CRM D1 database; never runs migrations.
- `abm-lms-content` (content): serves a handbook HTML from R2 `abm-lms-content` only for a valid signed path, with a strict CSP and no cookies.

UI reference: `plans/reports/brainstorm-261016-1538-lms-class-program-demo.html` tabs "Demo: Đăng nhập", "Demo: Trang học viên", "Demo: Bài học + Video". Use the CRM tokens in `apps/crm/src/web/styles.css` (copy the `:root` variables you need into `apps/lms/src/web/styles.css`).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, create Cloudflare resources, or start a background dev server.
- Create files only under `apps/lms/`. Do not modify `apps/crm/**` or `packages/**` (import from `@abm/lms-core`).
- Do not add a `migrations_dir` to the lms wrangler configs.

## Files to Create
```
apps/lms/package.json            name @abm/lms; scripts: dev (vite), build (vite build), test (vitest run),
                                 typecheck (tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit),
                                 deploy (vite build && wrangler deploy), deploy:content (wrangler deploy -c wrangler.content.jsonc)
apps/lms/wrangler.jsonc          portal Worker
apps/lms/wrangler.content.jsonc  content Worker
apps/lms/tsconfig.json, tsconfig.worker.json, tsconfig.web.json, vite.config.ts, vitest.config.ts, index.html
apps/lms/src/worker/index.ts     Hono app (portal)
apps/lms/src/worker/env.ts
apps/lms/src/worker/auth.ts      login, logout, change password, session middleware
apps/lms/src/worker/learning.ts  programs, program detail, video token, progress
apps/lms/src/worker/stream-token.ts
apps/lms/src/content/index.ts    content Worker
apps/lms/src/web/main.tsx, router.tsx, api.ts, styles.css
apps/lms/public/_headers         security headers for the SPA (required; see Task 6.3)
apps/lms/src/web/pages/login.tsx, home.tsx, program.tsx, change-password.tsx
apps/lms/test/helpers/reset-db.ts, test/auth.test.ts, test/learning.test.ts, test/content.test.ts, test/stream-token.test.ts
```
`tsconfig.worker.json` must include `src/worker/**/*.ts`, `src/content/**/*.ts`, `test/**/*.ts`, `vitest.config.ts`. Copy config shapes from `apps/crm` (`package.json` dependency versions, `tsconfig.*.json`, `vite.config.ts`, `vitest.config.ts`). Dependencies: `@abm/lms-core: workspace:*`, `hono`, `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `zod` (same versions as CRM); devDependencies same as CRM.

## Tasks

### Task 6.1 — Scaffold and configs
- Steps:
  1. `wrangler.jsonc`: `name: "abm-lms"`, `main: "src/worker/index.ts"`, same `compatibility_date`/flags as CRM, `assets: { directory: "./dist", not_found_handling: "single-page-application", run_worker_first: ["/api/*"] }`, `d1_databases: [{ binding: "DB", database_name: "abm-crm-eval", database_id: "ecf247ae-bb5e-431a-85a1-bca9b21f7507" }]` (**no `migrations_dir`**), `vars: { "LMS_CONTENT_ORIGIN": "", "STREAM_CUSTOMER_CODE": "" }`, `observability.enabled: true`. Comment that secrets `CONTENT_SIGNING_SECRET`, `STREAM_SIGNING_KEY_ID`, `STREAM_SIGNING_JWK` are set in phase 08.
  2. `wrangler.content.jsonc`: `name: "abm-lms-content"`, `main: "src/content/index.ts"`, `r2_buckets: [{ binding: "LMS_CONTENT", bucket_name: "abm-lms-content" }]`, `vars: { "LMS_ORIGIN": "" }`; secret `CONTENT_SIGNING_SECRET`.
  3. `vitest.config.ts`: like CRM but `readD1Migrations('../crm/migrations')`, wrangler config `./wrangler.jsonc`, `include: ['test/**/*.test.ts']`, bindings `{ TEST_MIGRATIONS, LMS_CONTENT_ORIGIN: 'https://content.test', STREAM_CUSTOMER_CODE: 'testcode', CONTENT_SIGNING_SECRET: 'test-secret' }`.
  4. `test/helpers/reset-db.ts`: `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` then `DELETE FROM` every table in a `TABLES` list copied from `apps/crm/test/helpers/reset-db.ts` (same order). Do NOT import `../crm/seed/demo.sql`. Export small insert helpers (`seedOrg`, `seedContact`, `seedClass`, `seedProgram`, `seedAccount`) that insert `organization`, `org_setting`, `app_user`, `contact`, `contact_point`, `product`, `course`, `class_group`, `class_session`, `lead`, `enrollment`, `lms_program`, `lms_lesson`, `lms_lesson_video`, `learner_account` rows directly with SQL (read the column lists in `apps/crm/migrations/0001_init.sql`, `0006`, `0008`, `0024`).
  5. `pnpm install` at `D:\TQD\CRM`.
- Verify: `pnpm --filter @abm/lms typecheck` exits 0 (with stub `index.ts` files exporting an empty Hono app / fetch handler). Run `pnpm --filter @abm/lms build` once before any `pnpm test`, because wrangler validates `assets.directory` (`./dist`) when vitest loads the config.

### Task 6.2 — Auth (`auth.ts`)
- Constants: cookie `abm_learner`, `SESSION_DAYS = 30`, `MAX_FAILED_LOGINS = 10`, `LOCK_MINUTES = 5` (same as CRM `auth-routes.ts:10-11`).
- Steps:
  1. Session helpers copied from `apps/crm/src/worker/session.ts` (`newSession`, `readSession`, `revokeSession`, cookie builders, `originGuard`) but on table `learner_session` / column `account_id`, cookie `abm_learner`, `HttpOnly; Secure; SameSite=Lax; Path=/`. `originGuard` always on (no `AUTH_MODE` switch): non-GET/HEAD requests whose `Origin` ≠ request origin → 403.
  2. `POST /api/auth/login` `{ email, password }` (zod; email trimmed+lower-cased): load `learner_account` by email; if missing, disabled, or `locked_until > now` → run a dummy `verifyPassword` (copy CRM `auth-routes.ts:66,71`) and return 401 `{ ok:false, error:{ code:'UNAUTHENTICATED', message:'Email hoặc mật khẩu không đúng' } }`.
     - Stored password = account's own hash when `password_hash` not null; else the org default from `org_setting` (`learner_default_password_*` where `organization_id = account.organization_id`). Default missing → 401 message "Tài khoản chưa sẵn sàng, vui lòng liên hệ Học vụ ABM".
     - Locked accounts get the same 401 `UNAUTHENTICATED` "Email hoặc mật khẩu không đúng" as a wrong password (like CRM `auth-routes.ts:70-71`; do not reveal the lock).
     - Wrong password → atomic failure update copied from CRM `recordFailure` (`auth-routes.ts:43-46`) on `learner_account`.
     - Success → reset counters, set `last_login_at`, create session, `Set-Cookie`, return `ok({ usesDefaultPassword })`.
  3. `POST /api/auth/logout` → revoke session, clear cookie.
  4. Middleware `requireLearner` for every other `/api/*` route: read cookie → `learner_session` (not revoked, not expired) → account `status='active'` → set `c.var.learner = { accountId, contactId, organizationId, email, usesDefaultPassword }`; else 401.
  5. `POST /api/auth/change-password` `{ currentPassword, newPassword (8..128) }`: verify current (same lockout rule); `hashPassword(newPassword)`; update `password_hash/salt/iterations`, `password_changed_at = now`, `version = version + 1`, `updated_at`; revoke the learner's other sessions; `ok({})`.
  6. `GET /api/me` → `{ displayName (from contact), email, usesDefaultPassword }`.
- Verify: Task 6.7.

### Task 6.3 — Learning endpoints (`learning.ts`)
- Shared `loadFacts(db, contactId, programId?)`: one query returning, per program the contact can reach (programs with `published_at` not null whose class has an enrollment of the contact, UNION programs with a live `lms_access` row for the contact): `programId, title, className, enrolled (EXISTS enrollment status IN ACCESS_ENROLLMENT_STATUSES), lastSessionAt (MAX starts_at of non-cancelled class_session of the class), reviewDays, manual (json_group_array of live lms_access mode/expires_at)`. Map to `AccessFacts` and call `resolveAccess` from `@abm/lms-core`.
- Endpoints (all behind `requireLearner`):
  1. `GET /api/programs` → programs with state `open` or `expired` (drop `none`): `{ id, title, className, state, until, endedAt, lessonCount, completedCount, nextSectionId }` (`nextSectionId` = first non-hidden lesson by position not in `lms_progress`).
  2. `GET /api/programs/:id` → state must be `open` (expired → 403 `{ code:'FORBIDDEN', message:'Đã hết hạn xem lại chương trình này' }`; none → 404). Return `{ program: { id, title, className, until }, lessons: [{ id, sectionId, title, groupTitle, position, done, videos: [{ id, title }] }], contentUrl: LMS_CONTENT_ORIGIN + await signContentPath(id, content_version, CONTENT_SIGNING_SECRET, 7200, Date.now()) }` (hidden lessons and deleted videos excluded).
  3. `GET /api/videos/:id/token` → video not deleted, its lesson's program state `open`, else 403/404. Return `{ iframeUrl: 'https://customer-' + STREAM_CUSTOMER_CODE + '.cloudflarestream.com/' + token + '/iframe' }` with `token = await signStreamToken(stream_uid, env, 7200)`.
  4. `PUT /api/lessons/:id/progress` `{ done: boolean }` → program state `open`; `INSERT … ON CONFLICT DO NOTHING` / `DELETE`; `ok({ done })`.
- Security headers: static HTML is served by Assets (only `/api/*` runs the Worker), so `apps/lms/public/_headers` is REQUIRED with a `/*` block: `Content-Security-Policy: default-src 'self'; frame-src https://*.workers.dev https://*.cloudflarestream.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`. (Phase 08 narrows `frame-src` to the real content origin.) A middleware adds `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` to API responses.

### Task 6.4 — Stream token (`stream-token.ts`)
- `signStreamToken(uid: string, env, ttlSeconds: number): Promise<string>`: `jwk = JSON.parse(atob(env.STREAM_SIGNING_JWK))`; `crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])`; header `{ alg: 'RS256', kid: env.STREAM_SIGNING_KEY_ID }`, payload `{ sub: uid, kid: env.STREAM_SIGNING_KEY_ID, exp: Math.floor(Date.now()/1000) + ttlSeconds }`; base64url(header).base64url(payload).base64url(signature). Missing secrets → throw `STREAM_NOT_CONFIGURED`; the endpoint maps it to 503 "Video chưa sẵn sàng".
- Test: generate an RSA key pair in the test with `crypto.subtle.generateKey`, export private JWK, sign, then verify the signature with the public key and check the decoded payload `sub`/`kid`/`exp`.

### Task 6.5 — Content Worker (`src/content/index.ts`)
- `fetch(request, env)`: only `GET`/`HEAD`; `verifyContentPath(url, env.CONTENT_SIGNING_SECRET, Date.now())` from `@abm/lms-core`; invalid → 403 plain text "Liên kết đã hết hạn, hãy mở lại bài học". Object key `programs/${programId}/v${contentVersion}.html`; missing → 404.
- Response headers:
  - `Content-Type: text/html; charset=utf-8`
  - `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${env.LMS_ORIGIN}`
  - `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
  - never `Set-Cookie`.
- Test (`content.test.ts`): import the default export and call `fetch` with a stub env `{ LMS_CONTENT: { get: async (k) => k === 'programs/p1/v2.html' ? { body: '<html>ok</html>' } : null }, CONTENT_SIGNING_SECRET: 's', LMS_ORIGIN: 'https://lms.test' }` (adapt the stub to the R2 methods you call): valid signed path → 200 and the CSP header contains `connect-src 'none'` and `frame-ancestors https://lms.test`; expired → 403; wrong version → 404 or 403; POST → 405.

### Task 6.6 — SPA (`src/web`)
- Routes (TanStack Router, like CRM `router.tsx`): `/dang-nhap`, `/` (home), `/hoc/$programId` (search param `phan` = sectionId), `/doi-mat-khau`. Unauthenticated `/api/me` (401) → redirect to `/dang-nhap`.
- **Login:** email + password, error messages from API, footer "Quên mật khẩu? Liên hệ Học vụ ABM qua Zalo."
- **Home:** header "ABM · Học tập" + name + "Đăng xuất". When `usesDefaultPassword`: warn banner "Anh/Chị đang dùng mật khẩu mặc định. Nên đổi mật khẩu để bảo vệ tài khoản." + button to `/doi-mat-khau` (not blocking). Grid of program cards: class name badge, title, "Đã học x/y phần", progress bar, "Tiếp tục: <next lesson>"; expired cards greyed with badge "Đã hết hạn xem lại" and not clickable. Empty state: "Anh/Chị chưa được ghi danh chương trình nào."
- **Program page:** three columns (≥980px; stacked below): left dark menu grouped by `groupTitle` with ✓ for done; centre `<iframe ref={frameRef} title="Nội dung bài học" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allow="clipboard-write" src={contentUrl + '#' + sectionId}>` (no `allow-same-origin`: the frame has an opaque origin; `clipboard-write` keeps the handbook's copy buttons working); buttons "← Phần trước", "✓ Đánh dấu đã học"/"✓ Đã học", "Phần sau →"; right "🎬 Video bài học": list of the lesson's videos, clicking one loads `GET /api/videos/:id/token` and shows `<iframe src={iframeUrl} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen>`; no videos → "Chưa có video cho phần này".
  - Switching lesson: update `?phan=`, then `frameRef.current.contentWindow.postMessage({ type: 'abm-lms:goto', sectionId }, '*')` (the sandboxed frame's origin is opaque, so a specific targetOrigin would drop the message; the payload is only a section id). Listen to `message` events and accept only `event.source === frameRef.current?.contentWindow` with `data.type === 'abm-lms:section'` (do not compare `event.origin`; it is the string "null").
  - Refetch the program (new signed URL) when the iframe was loaded more than 100 minutes ago and the learner switches lesson.
- **Change password:** current + new + confirm (min 8, match) → success toast and back to home.
- Verify: `pnpm --filter @abm/lms typecheck` exits 0 and `pnpm --filter @abm/lms build` exits 0.

### Task 6.7 — Worker tests
- `test/auth.test.ts` (password set up by calling `hashPassword` from `@abm/lms-core` and writing `org_setting.learner_default_password_*` directly; account rows inserted directly):
  1. default-password login → 200, `Set-Cookie` contains `abm_learner=`, `usesDefaultPassword: true`;
  2. wrong password ×10 → an 11th attempt with the RIGHT password still returns 401, and `learner_account.locked_until` is in the future;
  3. no org default → 401 with "chưa sẵn sàng";
  4. change password then login with the new one → 200, `usesDefaultPassword: false`; old default → 401;
  5. disabled account → 401; POST with foreign `Origin` → 403.
- `test/learning.test.ts` (rows inserted directly: course/class via SQL, `lms_program` with `published_at`, lessons, videos, enrollment):
  1. enrolled `confirmed` → `/api/programs` lists it `open`; `/api/programs/:id` returns lessons and a `contentUrl` starting with `https://content.test/c/`;
  2. not enrolled → 404; live `block` → 404; live `grant` without enrollment → open;
  3. `review_days = 1` with last session 3 days ago → listed `expired`; detail → 403;
  4. progress PUT true then false;
  5. video token: missing `STREAM_SIGNING_JWK` → 503; with a generated key (set via env override in `app.fetch(req, { ...env, STREAM_SIGNING_JWK, STREAM_SIGNING_KEY_ID })`) → `iframeUrl` contains `customer-testcode.cloudflarestream.com`;
  6. hidden lesson and deleted video are not returned.
- Verify: from `D:\TQD\CRM\apps\lms`: `pnpm build` exits 0, then `pnpm test` exits 0, no `failed`.

### Task 6.8 — Regression and report
- Verify: from `D:\TQD\CRM`: `pnpm -r typecheck` exits 0, `pnpm --filter @abm/lms build` exits 0, and `pnpm -r test` exits 0.
- Report `plans/reports/agy-261016-phase-06-lms-app.md`, last line `Status: DONE`.

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
