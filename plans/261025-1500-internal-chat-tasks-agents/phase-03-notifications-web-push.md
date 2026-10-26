---
phase: 3
title: "In-app notifications and Web Push"
status: pending
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 03: In-app notifications and Web Push

## Goal
Every user gets notifications inside the CRM (bell with unread count, list, mark read) and, on devices where they turned it on, Web Push to the phone or desktop. Notifications fire for: direct messages, @mentions, task assigned to me, my task due within 30 minutes, and approval requests waiting on a Leader. Approval Lark DMs keep running in parallel until phase 05. The web app becomes an installable PWA (needed for push on iPhone).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.
- Workers Free limit: one request or cron run may use at most 50 D1 queries (a `db.batch` counts as one) and at most 50 subrequests (DO fetch, R2, push `fetch`). Batch writes; never loop `.run()` per row.
- Never print or commit a VAPID private key. Tests generate throwaway keys at runtime.

## Files to Create / Modify
- Create: `apps/crm/migrations/0027_notifications.sql`
- Create: `apps/crm/src/worker/notify.ts`, `apps/crm/src/worker/notification-routes.ts`
- Modify: `apps/crm/src/worker/env.ts` (vars `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; secret `VAPID_PRIVATE_KEY`)
- Modify: `apps/crm/wrangler.jsonc` (vars `VAPID_PUBLIC_KEY: ""`, `VAPID_SUBJECT: "mailto:admin@abm.example"` with a comment that the real values are set in phase 07)
- Modify: `apps/crm/src/worker/approval-notify.ts` (`notifyCommitted`: in-app approvals and task events), `apps/crm/src/worker/chat-routes.ts` (notify on DM/mention), `apps/crm/src/worker/index.ts` (mount routes, task comment notify, pass `ctx` to `runScheduled`), `apps/crm/src/worker/inbox/scheduled.ts` (task due reminders, sink from ctx)
- Modify: `apps/crm/package.json` (dependency `@block65/webcrypto-web-push` `^2.0.0`)
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES`)
- Create: `apps/crm/public/sw.js`, `apps/crm/public/manifest.webmanifest` (icons `apps/crm/public/icon-192.png` and `icon-512.png` already exist, prepared before handoff)
- Modify: `apps/crm/index.html` (manifest link, theme color, apple-touch-icon)
- Modify: `apps/crm/src/web/main.tsx` (register service worker)
- Create: `apps/crm/src/web/components/notification-bell.tsx`, `apps/crm/src/web/pages/notification-settings.tsx`
- Modify: `apps/crm/src/web/components/layout.tsx`, `apps/crm/src/web/router.tsx`, `apps/crm/src/web/chat-socket.ts`
- Create: `apps/crm/test/notifications.test.ts`

## Tasks

### Task 3.1 — Migration 0027
- Target: `apps/crm/migrations/0027_notifications.sql` (new). Content:

```sql
-- In-app notifications (bell) and Web Push subscriptions. dedupe_key stops the same event notifying twice.
CREATE TABLE notification (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  kind TEXT NOT NULL CHECK (kind IN ('chat_direct', 'chat_mention', 'task_assigned', 'task_due', 'approval', 'inbox', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notification_user ON notification(user_id, read_at, created_at);

CREATE TABLE push_subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX push_subscription_user ON push_subscription(user_id);
```

- In `reset-db.ts` `TABLES`, add `'notification', 'push_subscription',` before `'agent_token'`.
- Verify: `pnpm --filter @abm/crm test -- chat.test.ts` exits 0.

### Task 3.2 — notify() and Web Push sender
- Goal: one function creates notifications, relays them live, and pushes them.
- Target: `apps/crm/src/worker/notify.ts` (new), `apps/crm/package.json`, `apps/crm/src/worker/env.ts`, `apps/crm/wrangler.jsonc`.
- Steps:
  1. `pnpm --filter @abm/crm add @block65/webcrypto-web-push@^2.0.0`. Use `buildPushPayload(message, subscription, vapid)` from `@block65/webcrypto-web-push` (v2.0.0): `message = { data: <JSON string>, options: { ttl: 3600 } }`, `subscription = { endpoint, expirationTime: null, keys: { p256dh, auth } }`, `vapid = { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }` (base64url strings: public = raw 65-byte P-256 point, private = the JWK `d` value). It returns `{ headers, method, body }` for `fetch(subscription.endpoint, payload)`. If the installed README shows a different signature, follow the README and say so in your summary.
  2. `notify.ts` exports `notify(sink: Sink, input: { organizationId: string; userIds: string[]; kind: NotificationKind; title: string; body?: string; link?: string; dedupeKey?: string })`:
     - de-duplicate `userIds`; insert one `notification` per user with `INSERT OR IGNORE` and `dedupe_key = dedupeKey ? dedupeKey + ':' + userId : NULL` in one `db.batch`; keep only users whose row was inserted (`meta.changes === 1`).
     - `publish(sink, organizationId, insertedUserIds, { type: 'notification' })`.
     - if `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` are both set: load `push_subscription` rows of those users and, via `sink.waitUntil`, send each push with payload JSON `{ title, body, link }` (body max 200 chars), TTL 3600. Collect results and write them with ONE `db.batch` at the end: HTTP 404/410 → delete the subscription; other failures → `failure_count = failure_count + 1`; success → `last_success_at = now, failure_count = 0`. Send to at most 20 subscriptions per `notify()` call. Never throw.
  3. `env.ts` / `wrangler.jsonc`: add the three settings as listed above.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.3 — Notification routes
- Target: `apps/crm/src/worker/notification-routes.ts` (new), mounted at `/notifications` after `requireActor`; plus `GET /push/key` in the same file mounted at `/push`.
- Steps: routes for the actor only:
  1. `GET /notifications?before=` → latest 30 with `{ id, kind, title, body, link, createdAt, readAt }`; `GET /notifications/unread` → `{ total }`.
  2. `POST /notifications/read` `{ ids?: string[] }` → mark given ids (or all) read.
  3. `GET /push/key` → `{ publicKey: VAPID_PUBLIC_KEY or null }`.
  4. `POST /push/subscriptions` `{ endpoint (https URL), keys: { p256dh, auth }, userAgent? }` → upsert on `endpoint` (an endpoint re-registered by another user moves to the new user). `DELETE /push/subscriptions` `{ endpoint }` → delete own row.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.4 — Notification triggers
- Goal: the five event types notify the right people.
- Target: `chat-routes.ts`, `index.ts` (task comment POST), `approval-notify.ts`, `inbox/scheduled.ts`, `index.ts` scheduled export.
- Steps:
  1. Messages (`chat-routes.ts` POST messages and the task comment POST): direct conversation → `chat_direct` to the other member, title `<author name>`, body = message text with mention tokens rendered as `@Name`, link `/chat/<id>`; any conversation → `chat_mention` to mentioned users except the author, link `/chat/<id>` or `/tasks/<taskId>` for task threads. `dedupeKey = 'msg:' + messageId`.
  2. `notifyCommitted` in `approval-notify.ts`: keep the Lark branch. Add: for `approval.requested` events needing a Leader (`approvalNeedsLeaderDm`), notify `kind 'approval'` every active Leader of the lead's team (or department for queue leads), excluding the requester, regardless of Lark link; title "Yêu cầu duyệt", link `/approvals`, `dedupeKey = 'approval:' + approvalId`. For `task.created` and `task.assigned` events whose assignee differs from the actor: `task_assigned` to the assignee, link `/tasks/<taskId>`, `dedupeKey = 'task-assigned:' + taskId + ':' + assigneeUserId`. Build the sink with `sinkFrom(c)`. Add a small query helper `activeLeaders(db, lead, requesterId)` next to `leaderRecipients` (same filter without the Lark columns).
  3. Cron: change `scheduled` in `index.ts` to `ctx.waitUntil(runScheduled(env, event.cron, ctx))` and `runScheduled(env, cron, ctx)` builds `{ env, waitUntil: (w) => ctx.waitUntil(w) }`. Every minute, add `notifyDueTasks(sink)`: tasks with status `open`/`in_progress`, `due_at` between now and now + 30 minutes → `task_due` to the assignee, `dedupeKey = 'task-due:' + id + ':' + due_at`, max 10 tasks per run (the cron runs every minute and the dedupe key drains any backlog), skipping tasks that already have that notification (`NOT EXISTS` on `notification.dedupe_key`). Wrap it like the other cron steps (log and continue).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 3.5 — Tests
- Target: `apps/crm/test/notifications.test.ts` (new); helper header from `commands.test.ts` lines 1-33.
- Steps:
  1. Direct message `u-lan` → `u-huy` creates one `chat_direct` notification for `u-huy`, none for `u-lan`; posting the same message id again does not add one.
  2. Group message mentioning `@[Đỗ Ngọc Lan](user:u-lan)` creates `chat_mention` for `u-lan` only.
  3. `createTask` by `u-lan` assigned to `u-long` → `task_assigned` for `u-long`; assigned to self → none.
  4. `notifyDueTasks` with a task due in 10 minutes → one `task_due`; running it twice → still one.
  5. Push sender: generate VAPID keys with `crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify'])`; public = base64url of `exportKey('raw', publicKey)`, private = `(await exportKey('jwk', privateKey)).d`; make a subscription the same way (an ECDH P-256 key for `p256dh`, 16 random bytes base64url for `auth`); stub `fetch` (`vi.spyOn(globalThis, 'fetch')`) returning 410 → the subscription row is deleted; returning 201 → `last_success_at` set. Assert the request has header `Content-Encoding: aes128gcm`.
  6. `GET /notifications/unread` reflects reads after `POST /notifications/read`.
- Verify: `pnpm --filter @abm/crm test -- notifications.test.ts` exits 0.

### Task 3.6 — PWA, service worker, bell, settings
- Goal: users install the CRM, turn on push per device, and see a bell.
- Target: `public/sw.js`, `public/manifest.webmanifest`, icons, `index.html`, `src/web/main.tsx`, `components/notification-bell.tsx`, `pages/notification-settings.tsx`, `layout.tsx`, `router.tsx`, `chat-socket.ts`.
- Steps:
  1. `manifest.webmanifest`: `name` "ABM CRM", `short_name` "ABM CRM", `start_url` "/", `display` "standalone", `background_color` and `theme_color` from the app's main color in `styles.css`, icons `/icon-192.png` and `/icon-512.png` (both files already exist in `apps/crm/public/`; do not regenerate them).
  2. `sw.js`: `push` → `self.registration.showNotification(title, { body, data: { link }, icon: '/icon-192.png', tag: link })`, but skip showing when a focused client window exists (`clients.matchAll({ type: 'window', includeUncontrolled: true })`, `client.focused`); `notificationclick` → focus an open window and navigate to `link`, else `clients.openWindow(link)`. No fetch handler, no caching.
  3. `index.html`: `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color">`, `<link rel="apple-touch-icon" href="/icon-192.png">`.
  4. `main.tsx`: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`.
  5. `notification-settings.tsx` (route `/settings/notifications`): button "Bật thông báo trên thiết bị này" → `Notification.requestPermission()`, `GET /push/key`, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, `POST /push/subscriptions`; button "Tắt" → unsubscribe + DELETE. Show a note for iPhone: "Trên iPhone, mở CRM bằng Safari, bấm Chia sẻ → Thêm vào MH chính, rồi bật thông báo trong app đó." Show "Máy chủ chưa cấu hình thông báo đẩy" when `publicKey` is null.
  6. `notification-bell.tsx` in the layout header: unread count from `['notifications','unread']`; dropdown list; clicking an item marks it read and navigates to `link`; "Đánh dấu đã đọc hết".
  7. `chat-socket.ts`: on `{ type: 'notification' }` invalidate `['notifications']` queries.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0 and `pnpm --filter @abm/crm test` exits 0.

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
