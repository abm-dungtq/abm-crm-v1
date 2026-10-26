# Code review: CRM "Video bài học" + LMS learner portal

Date: 2026-10-18. Scope: uncommitted diff (lms-videos page, `importLessonVideos`, `listPrograms` teacher filter) and committed LMS app (`apps/lms/src`, `packages/lms-core/src`).
Checks run: `pnpm -r typecheck` (pass), `apps/crm` `vitest run test/lms-videos.test.ts` (8/8 pass), `apps/lms` `vitest run` (17/17 pass).

## High

### H1. Class match is a raw substring, so a shorter class name captures other classes' lines, and the row is "ready" with no way to correct it
- `apps/crm/src/worker/lms-programs.ts:665` `programsByClassLen.find((p) => foldedTitle.includes(p.foldedClassName))`
- `apps/crm/src/web/pages/lms-videos.tsx:249-252` select only shown for `no_program`/`no_lesson` or an existing override.
- Scenario A: org has program for class `BSR-AI-K1` but `BSR-AI-K10` has no program yet (or is in another org-level state). Line `BSR-AI-K10 b1m1 ... | <link>` folds to contain `bsr-ai-k1`, matches K1, finds `b1m1`, status `ready`. Committing attaches K10's video to K1, so K1 learners get it. "Longest wins" (test 2) only helps when the longer class also has a program.
- Scenario B: a short class name such as `AI` folds to `ai`, which is inside `bai` (folded `Bài`), so almost every Vietnamese title matches that class when no longer name matches.
- The UI gives no override select on `ready` rows, so the user cannot fix a wrong match except by deleting afterwards.
- Fix: match the folded class name with the same token boundary as `hasWholeWord` (`(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])` on folded strings; `K1` then rejects `K10`). Also show the lesson select on every row that has a streamUid (ready/duplicate/forbidden too), so a wrong auto-match can be overridden.

### H2. Learner program page reloads the handbook iframe on every refetch (window focus, "Đánh dấu đã học")
- `apps/lms/src/worker/learning.ts:218-224` signs `exp = now + 7200` per request, so `contentUrl` differs on every call.
- `apps/lms/src/web/pages/program.tsx:191` `src={`${detail.data.contentUrl}#${sectionId}`}`; `program.tsx:111` invalidates the detail query after progress toggle; `main.tsx` `staleTime: 15_000, refetchOnWindowFocus: true`.
- Scenario: learner reads a long section, switches to Zalo for a minute and returns (or clicks "Đánh dấu đã học"). The detail refetches, `contentUrl` changes, the iframe fully reloads, the bridge's `onHash` jumps back to the top of the section and any in-handbook state (open tabs, scroll, quiz input) is lost. `REFETCH_SIGNED_URL_MS` logic in `selectLesson` is moot because the URL already changes far more often.
- Fix: keep the iframe base URL in state and only replace it when it is near expiry (or bucket `exp` server-side, e.g. round up to the next 30 min so repeated calls return the same signed path); have the progress toggle update the cache with `setQueryData` instead of invalidating the detail.

## Medium

### M1. Override / default-program change commits something different from the preview shown when the re-preview fails
- `apps/crm/src/web/pages/lms-videos.tsx:114-123`, `183-187`, `125-127`, `139`
- `handleOverrideSelect` and the default-program select update state first, then re-run preview; `runPreview` only sets `preview` on success. If that preview request fails (network, 5xx, validation), the old preview stays on screen with its `Lưu N video` button enabled, while `runCommit` sends the new overrides/programId. The user commits a mapping they never saw.
- Fix: clear `preview` (or mark it stale and disable commit) when overrides/default program change, and only re-enable after a successful preview of the exact input. Simplest: store the input JSON that produced `preview` and disable commit unless `JSON.stringify(buildInput(false)) === previewInputJson`.

### M2. Teacher import makes one `canTeach` query per matched class; a large paste can exceed the 50-query free-plan limit
- `apps/crm/src/worker/lms-programs.ts:701-707`
- Matching runs against every program in the org (not just the teacher's), then calls `canTeach` (one D1 query for teachers) per distinct class. Base cost is idempotency replay 1 + 2 reads + 1 existing-video read; 100 lines spread across 47+ classes push a teacher request past 50 queries and the request fails with a 500 instead of rows marked `forbidden`.
- Fix: one query `SELECT ct.class_id FROM class_teacher ct JOIN app_user u ... WHERE ct.user_id = ? AND u.status='active'` and build the set in memory (or restrict `programRows` to the teacher's classes for teachers, matching `listPrograms`).

### M3. Import preview discloses other classes' program/lesson titles to a teacher
- `apps/crm/src/worker/lms-programs.ts:715-722` fills `programTitle`, `className`, `lessonTitle`, `sectionId` before the `forbidden` check; `no_lesson` rows (`:676-686`) also return program/class for any org class.
- `listPrograms` was deliberately filtered to the teacher's classes (diff in `listPrograms`), but a teacher can paste guessed class names/section ids, or an override `lessonId`, and read titles of classes they do not teach. Internal data only, so medium-low; it contradicts the intended teacher scoping.
- Fix: for teachers, load only programs of their classes in `programRows`/`lessonRows` (unmatched then shows `no_program`), or strip the descriptive fields from `forbidden` rows.

### M4. Expired session shows "Email hoặc mật khẩu không đúng" inside the app instead of sending the learner to login
- `apps/lms/src/worker/auth.ts:222-223, 242-243` `requireLearner` returns `wrongCredentials` for missing/expired session.
- `apps/lms/src/web/pages/program.tsx:139-149`, `home.tsx:64-69` render `error.message`; only `RequireAuth` (`router.tsx:25`) redirects on 401 and its `/me` is cached for 15 s.
- Scenario: after 30 days, or after the learner changed the password on another device (other sessions revoked, `auth.ts:322-328`), opening a program or a video token (`program.tsx:65-67`) shows "Email hoặc mật khẩu không đúng" in the page. The learner has not typed anything; they are confused and do not see a login form.
- Fix: return a distinct message/code for session failures (e.g. `UNAUTHENTICATED`, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại") and add a global query/mutation `onError` that clears the cache and navigates to `/dang-nhap` on 401.

### M5. Previous learner's data can flash for the next learner on a shared device
- `apps/lms/src/web/pages/login.tsx:14-16` uses `invalidateQueries()` not `clear()`; `api.ts:62-64` `queryKey: [path]` is not user-scoped.
- Scenario: learner A's session expires (no explicit logout, so `client.clear()` in `Header` never runs). Learner B logs in on the same browser tab. Home renders A's cached `/programs` (titles, class names, progress) until the refetch finishes.
- Fix: `client.clear()` before navigating in login `onSuccess` (and in the 401 handler from M4).

## Low

### L1. Known item confirmed in commit 991c186: home card shows section id (being fixed in the working tree during this review; `learning.ts` now returns `nextLessonTitle` and `home.tsx` renders it; line refs below are the committed version)
- `apps/lms/src/worker/learning.ts:126,140,148` only selects/returns `section_id`; `apps/lms/src/web/pages/home.tsx:110` renders `Tiếp tục: ${p.nextSectionId}` (e.g. `b1p1`).
- Fix: select `l.title` and return `nextLessonTitle` alongside `nextSectionId` (keep the id for the `phan` search param).

### L2. Duplicate React keys in the lesson nav
- `apps/lms/src/web/pages/program.tsx:116-128, 163` groups consecutive lessons by `groupTitle` and keys by `g.title`. Two non-adjacent groups with the same title, or two runs of `null` group ("Bài học") separated by a titled group, produce duplicate keys; React may reuse/mismatch DOM nodes and warns.
- Fix: `key={`${index}-${g.title}`}` or key by the first item id.

### L3. `learnerTitle` strips the class name without folding or boundary
- `apps/crm/src/worker/lms-programs.ts:482-490`. Matching uses folded text, but stripping uses the raw class name. Title `Lop K1 b1m1 ...` for class `Lớp K1` matches but the class name is not stripped, so learners see `Lop K1` in the video title. Also replaces the first raw substring occurrence even inside a word (class `AI` strips `AI` out of e.g. `MAIL`).
- Fix: strip the span found during folded, boundary-aware matching (fold preserves length for NFD-removed marks only after recomposition, so compute the span on the original via a diacritic-insensitive boundary regex built per char, or simply strip only the leading token sequence before the section id).

### L4. "Video đã gắn" program select cannot be cleared
- `apps/crm/src/web/pages/lms-videos.tsx:67-72, 332`. Choosing "Chọn chương trình…" sets `''`, and the effect immediately resets it to the first class. Harmless but the option is dead; remove it or guard the effect with a "user touched" flag.

### L5. Concurrent imports into the same lesson can create duplicate videos and equal positions
- `apps/crm/src/worker/lms-programs.ts:710-726, 768-774`; `migrations/0024_lms.sql:79-92` has no unique index on `(lesson_id, stream_uid)` for live rows. Two staff committing the same paste at once both pass the pre-read and both insert. Fix if it matters: partial unique index `ON lms_lesson_video(lesson_id, lower(stream_uid)) WHERE deleted_at IS NULL` and map the UNIQUE failure to `STALE_VERSION`.

### L6. Login lockout can be triggered by anyone who knows a learner email
- `apps/lms/src/worker/auth.ts:110-119, 198-200`. 10 wrong passwords lock the account for 5 minutes with no per-IP limit; a script can keep a learner locked out continuously. Consistent with the existing design; consider Cloudflare rate limiting on `/api/auth/login`.

## Verified non-issues
- Preview/commit line-number keying: text edit clears `preview` and `overrides` (`lms-videos.tsx:167-172`), and the server re-parses the same text, so line numbers cannot drift between preview and commit.
- Preview and commit use separate `useCommand` instances, so they never share an idempotency key; a preview stages nothing (`tx.hasAnchor` false) and is not stored.
- Rename/delete send the row `version` from the class detail; server checks it and the batch guard re-checks; `useCommand` invalidates on `STALE_VERSION`.
- postMessage: parent checks `event.source === frameRef.current?.contentWindow`; bridge checks `event.source === window.parent` and validates the id regex. `goto` → bridge `click()` → `section` echo navigates to the same `phan` with `replace`, no loop.
- Review window: `starts_at` is stored via `isoUtc`, so `Date.parse` is safe; `expires_at` normalized with `toISOString()`; string comparison is valid.
- Session cookie HttpOnly/Secure/SameSite=Lax, origin guard on non-GET, session hash lookup, password change revokes other sessions and keeps the current one.
- LMS per-request query counts are small (≤ 5).

## Unresolved questions
1. Commit batch size: 100 ready rows put ~302 statements in one `db.batch`. Cloudflare docs say per-query limits apply to each statement in a batch but do not state whether each statement counts toward the 50 queries/invocation free limit. If they do, a commit of more than ~15 videos fails on the free plan. Worth one remote test with 20+ rows before relying on 100.
2. `change-password` runs two PBKDF2 derivations at 50 000 iterations (verify + hash) versus one at login; ADR-006 says the count was measured against the ~10 ms CPU budget for one derivation. Confirm it was measured on this endpoint too.

Status: DONE_WITH_CONCERNS
Summary: Typecheck and tests pass. Two high issues: substring class matching silently attaches videos to the wrong class with no way to override a "ready" row, and the learner handbook iframe reloads on every refetch because the signed URL changes each time. There are also several medium issues around stale-preview commits, teacher query fan-out and data scoping, and expired-session handling.
