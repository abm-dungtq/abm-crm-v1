---
phase: 3
title: "CRM: programs, videos, clone, publish API"
status: completed
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 03: CRM — programs, videos, clone, publish API

## Goal
The CRM owns everything about a class's online program: an agent publishes a handbook HTML (stored in R2 bucket `abm-lms-content`) and its lesson list through a token-protected API; staff edit the title and review days, add/edit/delete Stream videos per lesson, clone a program to another class (no videos), and get a signed preview URL.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, create Cloudflare resources, or start a background dev server.
- Modify only the files listed below.

## Files to Create / Modify
- Create: `packages/lms-core/src/content-url.ts` and add `export * from './content-url';` to `packages/lms-core/src/index.ts`; create `packages/lms-core/src/content-url.test.ts`
- Create: `apps/crm/src/worker/lms-programs.ts` (handlers `lmsProgramHandlers`, queries, shared `publishProgram` and `attachVideo` functions)
- Create: `apps/crm/src/worker/stream.ts` (Stream "copy from URL" client)
- Create: `apps/crm/src/worker/lms-publish-routes.ts` (Hono sub-app for the agent)
- Modify: `apps/crm/src/worker/env.ts` (bindings/vars), `apps/crm/wrangler.jsonc` (R2 binding + vars), `apps/crm/src/worker/commands.ts`, `apps/crm/src/worker/index.ts`, `packages/contracts/src/index.ts`
- Modify: `apps/crm/src/worker/attendance.ts` only if `canTeach` is not exported (it is exported at line ~40; do not change it otherwise)
- Create: `apps/crm/test/lms-programs.test.ts`

## Error codes
Only the codes in `ERROR_CODES` (`packages/contracts/src/index.ts:225`) exist; there is no `CONFLICT`. Use `DUPLICATE_SUSPECTED` (HTTP 409) for "already exists", `VALIDATION_FAILED` (422), `NOT_FOUND` (404), `FORBIDDEN` (403), `STALE_VERSION` (409).

## Tasks

### Task 3.1 — Signed content URLs (shared)
- Goal: CRM and LMS mint, and the content Worker verifies, the same short-lived HMAC URLs.
- Target: `packages/lms-core/src/content-url.ts`.
- Steps: export
```ts
/** Path served by abm-lms-content: /c/<programId>/<contentVersion>?exp=<unix seconds>&sig=<hex HMAC-SHA256>. */
export async function signContentPath(programId: string, contentVersion: number, secret: string, ttlSeconds: number, nowMs: number): Promise<string>
export async function verifyContentPath(url: URL, secret: string, nowMs: number): Promise<{ programId: string; contentVersion: number } | null>
```
  Message = `${programId}.${contentVersion}.${exp}`; HMAC via `crypto.subtle.importKey('raw', …, { name: 'HMAC', hash: 'SHA-256' })`; compare signatures in constant time (`crypto.subtle.verify`). Reject when `exp*1000 <= nowMs`, path does not match `/^\/c\/([A-Za-z0-9-]{1,64})\/(\d{1,6})$/`, or `sig` is missing.
- Tests in `content-url.test.ts`: round trip ok; tampered version → null; expired → null; wrong secret → null.
- Verify: `pnpm --filter @abm/lms-core test` exits 0 with no `failed`.

### Task 3.2 — Bindings and config
- Steps:
  1. `wrangler.jsonc`: add to `r2_buckets`: `{ "binding": "LMS_CONTENT", "bucket_name": "abm-lms-content" }`; add to `vars`: `"LMS_CONTENT_ORIGIN": ""` and `"STREAM_ACCOUNT_ID": ""` with a comment that phase 08 fills them. Do not add secrets to the file.
  2. `env.ts` `Env`: `LMS_CONTENT: R2Bucket; LMS_CONTENT_ORIGIN: string; STREAM_ACCOUNT_ID: string; STREAM_API_TOKEN?: string; CONTENT_SIGNING_SECRET?: string;` (the last two are secrets set in phase 08).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.3 — `publishProgram` (shared function) and the agent route
- Goal: the agent creates or republishes a class program in one call.
- Target: `lms-programs.ts` function `publishProgram(env, actor, input)`, `lms-publish-routes.ts`.
- Input (zod schema `publishProgramInput`, defined in `lms-programs.ts`, not in COMMANDS):
  `{ classId: id, title: string 1..200, html: string 1..3_000_000, lessons: { sectionId: /^[A-Za-z0-9_-]{1,64}$/, title: 1..200, groupTitle?: ≤200, position: int 0..999 }[] 1..300 }`, sectionIds unique (refine).
- Steps:
  1. Actor role must be `academic` or `admin` → else 403 `FORBIDDEN`.
  2. Class must belong to actor's org (join course). Load program `SELECT * FROM lms_program WHERE class_id = ?`.
  3. `programId` = existing id or `crypto.randomUUID()`; `nextVersion = (existing?.content_version ?? 0) + 1`; `key = programs/${programId}/v${nextVersion}.html` (no org prefix, so the content Worker needs no database).
  4. `await env.LMS_CONTENT.put(key, input.html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } })` before the tx (an orphan object after a failed tx is harmless).
  5. New `GuardedTx` as `admin-routes.ts:281-293` builds one for a REST route. That route uses file-local helpers `body` (admin-routes.ts ~l.21) and `commit` (~l.29-38) which are not exported: copy `commit()` into `lms-publish-routes.ts`. Before committing add `tx.assert(AGENT_WRITES_OPEN, [])` (the agent kill-switch condition in `commands.ts` ~l.85; export it if needed) so the kill switch also stops publishing. New program → `tx.insertVersioned('lms_program', { id, organization_id, class_id, title, content_key: key, content_version: 1, published_at: tx.now })`; existing → `tx.update('lms_program', id, version, { title, content_key: key, content_version: nextVersion, published_at: tx.now })`.
  6. Lessons: load existing `(id, section_id, version)`; for each input lesson, existing → `tx.update('lms_lesson', …, { title, group_title, position, hidden_at: null })`, new → `tx.insertVersioned('lms_lesson', { id, program_id, section_id, title, group_title, position })`; existing not in input and not hidden → `tx.update(... { hidden_at: tx.now })`.
  7. `tx.audit('lms_program', programId, …, { contentVersion: nextVersion, lessons: n })`; `await tx.commit()` (follow the admin route for error mapping).
  8. Return `{ programId, contentVersion: nextVersion, lessons: input.lessons.length, hidden: hiddenCount }`.
- Route file `lms-publish-routes.ts` (Hono, same `AppBindings`):
  - `use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }))`, then the Bearer check copied from `mcp-routes.ts:16-29` (reject `Origin` header, look up `agent_token`, `loadAgentActor`, set `actor`).
  - Note (accepted): any `agent_token` of an active academic/admin user can publish, including tokens issued for GoClaw.
  - `GET /classes` → classes of the org: `id, name, status, courseName, programId, contentVersion` (open classes first, limit 200).
  - `POST /programs` → validate `publishProgramInput`, call `publishProgram`, `ok(result)`.
  - `POST /videos` → body `{ classId, sectionId, title, streamUid }`; resolves the lesson of that class's program by section id (404 if none) and calls `attachVideo` (Task 3.5).
- `index.ts`: `app.route('/lms-publish', lmsPublishRoutes)` placed right after the `/mcp` mount (line ~42), i.e. before `originGuard`.

### Task 3.4 — Stream copy client
- Target: `apps/crm/src/worker/stream.ts`.
- Steps: export `async function streamCopyFromUrl(env: Env, url: string, name: string): Promise<{ uid: string }>`:
  - If `!env.STREAM_API_TOKEN || !env.STREAM_ACCOUNT_ID` throw an error whose message is `STREAM_NOT_CONFIGURED`.
  - `POST https://api.cloudflare.com/client/v4/accounts/${STREAM_ACCOUNT_ID}/stream/copy` with headers `Authorization: Bearer <token>`, `Content-Type: application/json`, body `{ url, meta: { name }, requireSignedURLs: true }`.
  - Non-2xx or `success !== true` → throw `STREAM_COPY_FAILED`. Return `{ uid: json.result.uid }`.
- Verify: no verification needed (typecheck in 3.8).

### Task 3.5 — Video commands
- Shared `attachVideo(db, tx, actor, lessonId, title, streamUid)`: position = `(SELECT COALESCE(MAX(position), -1) + 1 FROM lms_lesson_video WHERE lesson_id = ? AND deleted_at IS NULL)` computed before; `tx.insertVersioned('lms_lesson_video', { id, lesson_id, title, stream_uid, position, created_by_user_id: actor.id })`; audit.
- `addLessonVideo`: load lesson → program → `class_id`, org check; `await canTeach(db, actor, classId)` false → `fail('FORBIDDEN', 'Chỉ giáo viên của lớp được sửa video')`. If `sourceUrl`: call `streamCopyFromUrl` before writing; on `STREAM_NOT_CONFIGURED` return `fail('VALIDATION_FAILED', 'Chưa cấu hình Cloudflare Stream')`, on `STREAM_COPY_FAILED` return `fail('VALIDATION_FAILED', 'Stream không tải được video từ link này')`. Then `attachVideo`.
- `updateLessonVideo`: same permission; version check; update `title`/`position` when given.
- `deleteLessonVideo`: same permission; `tx.update(... { deleted_at: tx.now })` (soft delete; Stream file is not deleted).
- Register `COMMANDS` entries `addLessonVideo`, `updateLessonVideo`, `deleteLessonVideo` (roles `['academic','admin','teacher']`).

### Task 3.6 — `updateLmsProgram`, `cloneLmsProgram`
- `updateLmsProgram`: program in org; version check; update `title` (when given) and `review_days` (`input.reviewDays`, may be null); audit. Roles `['academic','admin']`.
- `cloneLmsProgram`: both classes in org; source program must exist with `content_key` not null, else `fail('VALIDATION_FAILED', 'Lớp nguồn chưa có chương trình')`; target class must have no program, else `fail('DUPLICATE_SUSPECTED', 'Lớp đích đã có chương trình')`. Insert program copying `title, content_key, content_version, review_days`, `cloned_from_program_id = source.id`, `published_at = tx.now`; copy every non-hidden lesson (new ids, same section_id/title/group_title/position). **Do not copy videos.** Audit. Roles `['academic','admin']`.

### Task 3.7 — Read endpoints
- In `lms-programs.ts`, `classProgram(db, env, actor, classId)`; gate: `LMS_STAFF` (import from `./lms-accounts`) or `canTeach` true; else 403.
  Returns `{ program: null }` when none, else `{ program: { id, version, title, contentVersion, publishedAt, reviewDays, clonedFromProgramId }, lessons: [{ id, version, sectionId, title, groupTitle, position, hidden, videos: [{ id, version, title, streamUid, position }] }], counts: { enrolled, withAccount, withoutEmail }, learnersWithoutAccount: [{ contactId, displayName, email: string | null }], hasDefaultPassword }` (`learnersWithoutAccount` = enrolled contacts with no `learner_account`, limit 200; `email` = first email contact point or null). `enrolled` uses `ACCESS_ENROLLMENT_STATUSES`.
- `listPrograms(db, actor)` (LMS_STAFF): `[{ programId, classId, className, courseName, title, lessonCount }]` for the clone picker.
- `previewUrl(env, actor, classId)`: same gate as `classProgram`; requires `CONTENT_SIGNING_SECRET` and `LMS_CONTENT_ORIGIN` (missing → 503 with message `Chưa cấu hình xem trước`); returns `{ url: LMS_CONTENT_ORIGIN + await signContentPath(programId, contentVersion, secret, 1800, Date.now()) }`.
- Routes in `index.ts` (after `requireActor`): `GET /classes/:id/lms`, `GET /classes/:id/lms/preview-url`, `GET /lms/programs`.

### Task 3.8 — Tests
- Target `apps/crm/test/lms-programs.test.ts`. Create an agent token in the test: insert `agent_token (id, user_id, token_hash, created_at)` with `token_hash = sha256(raw)` (import `sha256` from `../src/worker/commands`) for an academic user; call `app.fetch(new Request('http://crm.test/api/lms-publish/programs', { method: 'POST', headers: { Authorization: 'Bearer ' + raw, 'Content-Type': 'application/json' }, body }), env)`.
- Cases:
  1. publish 3 lessons → 200, `contentVersion 1`, R2 object exists (`await env.LMS_CONTENT.get(key)` not null — the vitest pool provides a local R2 for bindings in `wrangler.jsonc`).
  2. republish with 2 of those sections + 1 new → `contentVersion 2`, `hidden 1`, lesson rows = 4 with one `hidden_at` not null.
  3. publish with a browser `Origin` header → 403; wrong token → 401; sale-role token → 403.
  4. `addLessonVideo` with `streamUid` (32 hex chars) as academic → 200; as a teacher not assigned to the class → 403; as assigned teacher → 200 (assign via `setClassTeachers` like `academic.test.ts`).
  5. `addLessonVideo` with `sourceUrl` when `STREAM_API_TOKEN` is unset → error with message `Chưa cấu hình Cloudflare Stream`.
  6. `deleteLessonVideo` hides it from `GET /classes/:id/lms`.
  7. `updateLmsProgram` sets `reviewDays: 90` then `null`.
  8. `cloneLmsProgram` copies non-hidden lessons and zero videos; cloning again into the same target → 409.
  9. `GET /classes/:id/lms` as sale → 403.
- Verify: from `D:\TQD\CRM\apps\crm`: `pnpm test test/lms-programs.test.ts` exits 0, no `failed`.

### Task 3.9 — Regression and report
- Verify: `pnpm -r typecheck` exits 0 and `pnpm -r test` exits 0.
- Report `plans/reports/agy-261016-phase-03-lms-programs.md`, last line `Status: DONE`.

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

## Supervisor amendments (kongming checkpoint after phase 02) — these override the tasks above
1. **Handlers need `env`.** `Ctx` in `apps/crm/src/worker/command-result.ts` is `{ db, actor, input, tx }`. You may modify `command-result.ts`: add `env?: Env` to `Ctx`; add an optional `env` parameter to `runCommand` in `commands.ts` and pass `c.env` from the `/commands` route in `index.ts` (and from `mcp-routes.ts` if it calls `runCommand`). Handlers needing R2/Stream must return `fail('VALIDATION_FAILED', 'Chưa cấu hình …')` when `env` or the binding is missing. The test `command` helper must pass `env` (from `cloudflare:test`) so Stream "not configured" tests fail for the right reason.
2. **Clone must copy the content object.** The content Worker (phase 06) reads R2 key `programs/<programId>/v<contentVersion>.html` with no database, so a cloned program pointing at the source key would 404. In `cloneLmsProgram`: before the tx, `const obj = await env.LMS_CONTENT.get(source.content_key)`; if missing → `fail('NOT_FOUND', 'Không tìm thấy nội dung chương trình gốc')`; `await env.LMS_CONTENT.put('programs/<newId>/v<source.content_version>.html', obj.body, { httpMetadata: obj.httpMetadata })`; store that new key as `content_key` and keep `content_version` equal to the source's. Add a test asserting the object exists at the new key.
3. Stream `copy` is asynchronous: a 200 means "accepted", not "playable now". Do not mark anything as ready based on it.
