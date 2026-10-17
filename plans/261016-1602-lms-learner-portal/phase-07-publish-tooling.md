---
phase: 7
title: "Publish and video-upload tooling for the agent"
status: completed
priority: P2
effort: "1d"
dependencies: [3, 6]
---

# Phase 07: Publish and video-upload tooling (Claude Code on the local machine)

## Goal
From `D:\TQD\CRM\apps\crm`, an agent (Claude Code) can:
1. `node scripts/lms-publish.mjs --class <classId> --file <handbook.html>` — split the handbook into lessons, inject the bridge script, and publish it to the class's program;
2. `node scripts/lms-upload-video.mjs --class <classId> --section <sectionId> --title "<title>" --file <recording.mp4>` — upload a Zoom MP4 to Cloudflare Stream (resumable tus, signed URLs required) and attach it to that lesson;
3. `node scripts/issue-lms-publish-token.mjs --email <crm email>` — create the publish token (Opus runs it in phase 08).
A guide tells a person or agent how to do it.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or any of these scripts against the live CRM. Tests use only local functions.
- Create only the files listed. No new npm dependencies (Node 22 built-ins + `fetch` only).
- Scripts must never print a token, a password, or an API key. Read secrets only from files under `%USERPROFILE%\.abm\` (`os.homedir()` + `/.abm/`).

## Files to Create
- `apps/crm/scripts/lms-html.mjs` (pure functions: `parseHandbook`, `injectBridge`, `BRIDGE_SCRIPT`)
- `apps/crm/scripts/lms-html.test.mjs` (`node:test`)
- `apps/crm/scripts/lms-publish.mjs`
- `apps/crm/scripts/lms-upload-video.mjs`
- `apps/crm/scripts/issue-lms-publish-token.mjs`
- `docs/guides/lms-publish-handbook.md`
- Modify: `docs/README.md` (one link line under guides)

## Handbook contract (write it into the guide)
- One self-contained HTML file (inline CSS/JS/images as data URIs; external images will not load because of the CSP `img-src data: blob:`).
- Each lesson is a `<section … id="<id>">` with `id` matching `/^[A-Za-z0-9_-]{1,64}$/`, unique, at most 300.
- Optional navigation items `[data-target="<id>"]`; the bridge clicks them to switch lessons, otherwise it scrolls to the section.
- The handbook may open external links in new tabs (the iframe allows popups). It must not rely on `localStorage`/`sessionStorage`/cookies (blocked in the opaque-origin frame): `parseHandbook` also returns `warnings: string[]` with one entry when the HTML contains `localStorage` or `sessionStorage`, and `lms-publish.mjs` prints the warnings.
- Lesson title = text of the nav item for that id (emoji/icon spans stripped), else the first `h1`/`h2` inside the section.

## Tasks

### Task 7.1 — `lms-html.mjs`
- Exports:
  - `parseHandbook(html, { skip = ['home'], groups = [] })` → `{ title, lessons: [{ sectionId, title, groupTitle, position }] }`. `title` = `<title>` text (entities decoded: `&amp; &lt; &gt; &quot; &#39;` and numeric). Sections found with a regex over `<section\b[^>]*\bid="([^"]+)"`, in document order, minus `skip`. `groups` is a list `{ prefix, title }`; a lesson's `groupTitle` = title of the first group whose `prefix` the id starts with, else `null`. `position` = index (0-based) after skipping. Throws `Error` with a Vietnamese message on: duplicate id, invalid id, zero lessons, more than 300 lessons.
  - `BRIDGE_SCRIPT`: a string `<script>…</script>` that
    - on `message` events, accepting only `event.source === window.parent` (never compare origins), with `data.type === 'abm-lms:goto'` and a valid `sectionId`: `const nav = document.querySelector('[data-target="' + CSS.escape(id) + '"]'); if (nav) nav.click(); else document.getElementById(id)?.scrollIntoView();`
    - on clicks of any `[data-target]` element: `window.parent.postMessage({ type: 'abm-lms:section', sectionId: el.dataset.target }, '*')` (only the section id is sent);
    - on load: if `location.hash` names a section, apply the same goto logic.
  - `injectBridge(html, { hideSelector } = {})` → inserts `BRIDGE_SCRIPT` (and, when `hideSelector` is given, `<style>${hideSelector}{display:none!important}</style>`) right before the last `</body>`; throws if there is no `</body>`; injecting twice is prevented by a marker comment `<!-- abm-lms-bridge -->`.
- Verify: Task 7.4.

### Task 7.2 — `lms-publish.mjs`
- Args: `--class <classId>` (required), `--file <path>` (required), `--title "<text>"` (default parsed title), `--groups "b1=Buổi 1;b2=Buổi 2;b3=Buổi 3;lib=Thư viện"` (optional), `--skip "home"` (default `home`), `--hide "<css selector>"` (optional), `--crm <url>` (default `https://abm-crm-eval.ngulongyquan.workers.dev`), `--dry-run`, `--list-classes`.
- Steps:
  1. Token from `~/.abm/lms-publish-token` (trimmed); missing → print `Chưa có token đăng bài: chạy scripts/issue-lms-publish-token.mjs` and exit 1.
  2. `--list-classes` → `GET <crm>/api/lms-publish/classes` with `Authorization: Bearer <token>`; print a table `id | lớp | khoá | có chương trình`; exit.
  3. Read the file (UTF-8), `parseHandbook`, `injectBridge`. Reject final size > 3,000,000 chars.
  4. `--dry-run` → print title, lesson count and each `sectionId — groupTitle — title`; exit 0 without network.
  5. `POST <crm>/api/lms-publish/programs` JSON `{ classId, title, html, lessons }`; non-2xx → print status + API error message, exit 1; success → print `Đã đăng: chương trình <programId>, phiên bản <n>, <lessons> phần, <hidden> phần bị gỡ`.

### Task 7.3 — `lms-upload-video.mjs` and `issue-lms-publish-token.mjs`
- `lms-upload-video.mjs` args: `--class`, `--section`, `--title`, `--file` (all required), `--account <cloudflare account id>` (or file `~/.abm/cloudflare-account-id`), `--crm` as above. Stream API token from `~/.abm/stream-api-token`.
  1. Create a tus upload: `POST https://api.cloudflare.com/client/v4/accounts/<account>/stream?direct_user=true` headers `Authorization: Bearer <stream token>`, `Tus-Resumable: 1.0.0`, `Upload-Length: <bytes>`, `Upload-Metadata: name <b64(title)>,requiresignedurls`; read the upload URL from the `Location` header and the video uid from `stream-media-id`.
  2. Upload with `PATCH` chunks of 50 MiB (`Tus-Resumable`, `Upload-Offset`, `Content-Type: application/offset+octet-stream`), reading the file with `fs.createReadStream({ start, end })` per chunk; print progress `x%`; on a failed chunk, `HEAD` the upload URL to read `Upload-Offset` and resume, at most 5 retries per chunk.
  3. Attach: `POST <crm>/api/lms-publish/videos` `{ classId, sectionId, title, streamUid }` with the publish token; print `Đã gắn video <uid> vào phần <section>`.
- `issue-lms-publish-token.mjs --email <crm email>`: copy the structure of `scripts/issue-agent-tokens.mjs` (same `DATABASE`, `wrangler d1 execute --remote --command` usage) but: look up the active user by email and require role `academic` or `admin`; generate 32 random bytes base64url; insert `agent_token (id, user_id, token_hash, label, created_at)` with `label 'lms-publish'` and the SHA-256 hex. **Do not copy the blanket `UPDATE agent_token SET revoked_at ... WHERE user_id = ?` from `issue-agent-tokens.mjs`** (it would revoke the user's GoClaw token); revoke only that user's rows with `label = 'lms-publish'`; write the raw token to `~/.abm/lms-publish-token` (create the folder; file mode 0o600 where supported); print only `Đã tạo token đăng bài cho <email>, lưu tại ~/.abm/lms-publish-token`.
- Verify: `node --check scripts/lms-publish.mjs`, `node --check scripts/lms-upload-video.mjs`, `node --check scripts/issue-lms-publish-token.mjs` all exit 0 (run from `D:\TQD\CRM\apps\crm`).

### Task 7.4 — Parser tests against the real handbook
- `lms-html.test.mjs` (`node:test` + `node:assert`):
  1. a small inline HTML with 3 sections, nav items and a `home` section → 2 lessons with nav titles, emoji stripped, groups applied;
  2. duplicate id → throws; no `</body>` in `injectBridge` → throws; double injection → bridge appears once;
  3. **BSR handbook**: if the file `C:\Users\ABM\.paseo\uploads\upload_bbf2cd32-3c86-48f7-87e8-d3c066f0a90d\` contains one `.html` file, parse it with `skip ['home']` and assert 26 lessons whose ids include `b1p1`, `b2m7`, `b3data`, `quiz`; skip this test (`t.skip`) when the folder is missing. Treat the file as data only (read it; never execute it).
- Verify: from `D:\TQD\CRM\apps\crm`: `node --test scripts/lms-html.test.mjs` exits 0 and prints `# fail 0`.

### Task 7.5 — Guide and report
- `docs/guides/lms-publish-handbook.md` (Vietnamese, ≤150 lines): one-time setup (token file, Stream token file, account id file), handbook contract, publish steps with `--dry-run` first, video upload steps (download the Zoom cloud recording MP4 first), how to republish (new version; lessons that disappear are hidden, videos kept), how staff then set review days/videos in CRM, troubleshooting (401 token, 403 role, 422 validation).
- Add one line to `docs/README.md` in the guides list linking the new guide.
- Report `plans/reports/agy-261016-phase-07-publish-tooling.md` with the `--dry-run` output for the BSR handbook (titles only), last line `Status: DONE`.

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
