# Phase 03 Report — Phase 02 Follow-ups, In-app Notifications, and Web Push

## Tasks Completed
- **Pre-task P1 — Attachment download access & Cache-Control**: Updated `GET /chat/attachments/:id` in `apps/crm/src/worker/chat-routes.ts` to `LEFT JOIN chat_message` and return `404` when `message_deleted_at IS NOT NULL` or when `message_id IS NULL` and the requester is not `uploaded_by_user_id`. Updated `Cache-Control` to `private, max-age=300`.
- **Pre-task P2 — Task-thread membership & non-member read/polling**: Updated `ensureTaskConversation` in `apps/crm/src/worker/chat.ts` so viewing `GET /tasks/:id/comments` or calling `/read` does not insert the viewer into `chat_member` (only creator, assignee, and `task_member` rows are seeded; commenters and mentioned users passing `canSeeTask` are added via `addConversationMembers` when a comment is posted). Added `isMember: boolean` to `GET /tasks/:id/comments` and made both `/tasks/:id/comments/read` and `/chat/conversations/:id/read` a no-op returning `200` for non-members. Updated `apps/crm/src/web/components/chat-thread.tsx` so non-members poll every 30 s while the task page is open, while members keep socket-only updates (60 s poll only when disconnected). Preserved the existing `updateTask` member prune in `commands.ts`.
- **Pre-task P3 — Shared mention filter on task comments**: Extracted `filterMentions` (and `renderMentionText`) into `apps/crm/src/worker/chat.ts` using batched candidate lookup (`json_each`) and batched `taskScope` checks (`db.batch`), and wired both `POST /chat/conversations/:id/messages` and `POST /tasks/:id/comments` to use it.
- **Pre-task P4 — Socket retry cap and resume**: Updated `apps/crm/src/web/chat-socket.ts` to stop retrying after 10 consecutive failed connects (`MAX_FAILED_CONNECTS = 10`) and resume (resetting backoff and reconnecting) on `document` `visibilitychange` to `'visible'`, `window` `focus`, or the `online` event.
- **Pre-task Tests (P1–P3)**: Added tests for P1, P2, and P3 in `apps/crm/test/chat.test.ts`.
- **Task 3.1 — Migration 0027**: Created `apps/crm/migrations/0027_notifications.sql` with `notification` and `push_subscription` tables and indexes, and added `'notification', 'push_subscription'` before `'agent_token'` in `apps/crm/test/helpers/reset-db.ts`.
- **Task 3.2 — `notify()` and Web Push sender**: Installed `@block65/webcrypto-web-push@^2.0.0`, added `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, and `VAPID_PRIVATE_KEY` to `apps/crm/src/worker/env.ts` and placeholder vars to `apps/crm/wrangler.jsonc`, and created `apps/crm/src/worker/notify.ts` implementing batched `INSERT OR IGNORE` notification creation, live `ChatHub` `{ type: 'notification' }` publish, and Web Push delivery (capped at 20 subscriptions, 200-char body limit, TTL 3600, and single `db.batch` status update/deletion at the end).
- **Task 3.3 — Notification & Push routes**: Created `apps/crm/src/worker/notification-routes.ts` (`GET /notifications`, `GET /notifications/unread`, `POST /notifications/read`, `GET /push/key`, `POST /push/subscriptions`, `DELETE /push/subscriptions`) and mounted `/notifications` and `/push` in `apps/crm/src/worker/index.ts`.
- **Task 3.4 — Notification triggers**: Wired notifications for direct messages (`chat_direct`) and `@mentions` (`chat_mention`) in `chat-routes.ts` and `index.ts`; updated `notifyCommitted` in `apps/crm/src/worker/approval-notify.ts` (preserving the Lark branch) with `activeLeaders` for `approval.requested` (`approval`) and `task.created`/`task.assigned` (`task_assigned`); updated `scheduled` in `index.ts` and `runScheduled` in `apps/crm/src/worker/inbox/scheduled.ts` with `notifyDueTasks` (`task_due` for tasks due within 30 minutes, max 10 per run).
- **Task 3.5 & Brief Item 5 — Notification & D1 budget tests**: Created `apps/crm/test/notifications.test.ts` with 7 tests covering `chat_direct` deduplication, `chat_mention`, `task_assigned`, `notifyDueTasks`, Web Push (`410` delete, `201` `last_success_at`, `Content-Encoding: aes128gcm`), unread/read flow, and the 10-mention task comment D1 query budget test.
- **Task 3.6 — PWA, service worker, bell, settings**: Created `apps/crm/public/manifest.webmanifest` and `apps/crm/public/sw.js` (with `push` and `notificationclick` handlers only, no `fetch` handler or caching), updated `apps/crm/index.html` and `apps/crm/src/web/main.tsx`, created `apps/crm/src/web/components/notification-bell.tsx` and `apps/crm/src/web/pages/notification-settings.tsx`, and wired them into `apps/crm/src/web/components/layout.tsx`, `apps/crm/src/web/router.tsx`, and `apps/crm/src/web/chat-socket.ts`.

## Web-Push README Signature & Measured D1 Count
- **`@block65/webcrypto-web-push` (v2.0.0) README signature match**: **Yes** — the installed package's README and TypeScript declarations matched the brief's exact signature: `await buildPushPayload(message, subscription, vapid)` taking `message = { data, options: { ttl } }`, `subscription = { endpoint, expirationTime: null, keys: { p256dh, auth } }`, and `vapid = { subject, publicKey, privateKey }`, returning `{ headers, method, body }` for `fetch(subscription.endpoint, payload)`.
- **Measured D1 count for ONE POST of a task comment with 10 mentions**: **`12` total** (`batchCalls: 4`, `outsideBatchExecs: 8`), well within the `<= 40` budget.

## Files Changed
- Created: `apps/crm/migrations/0027_notifications.sql`
- Created: `apps/crm/src/worker/notify.ts`
- Created: `apps/crm/src/worker/notification-routes.ts`
- Created: `apps/crm/public/manifest.webmanifest`
- Created: `apps/crm/public/sw.js`
- Created: `apps/crm/src/web/components/notification-bell.tsx`
- Created: `apps/crm/src/web/pages/notification-settings.tsx`
- Created: `apps/crm/test/notifications.test.ts`
- Modified: `apps/crm/package.json`
- Modified: `pnpm-lock.yaml`
- Modified: `apps/crm/wrangler.jsonc`
- Modified: `apps/crm/src/worker/env.ts`
- Modified: `apps/crm/src/worker/chat.ts`
- Modified: `apps/crm/src/worker/chat-routes.ts`
- Modified: `apps/crm/src/worker/approval-notify.ts`
- Modified: `apps/crm/src/worker/inbox/scheduled.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Modified: `apps/crm/test/helpers/reset-db.ts`
- Modified: `apps/crm/test/chat.test.ts`
- Modified: `apps/crm/index.html`
- Modified: `apps/crm/src/web/main.tsx`
- Modified: `apps/crm/src/web/chat-socket.ts`
- Modified: `apps/crm/src/web/components/chat-thread.tsx`
- Modified: `apps/crm/src/web/components/layout.tsx`
- Modified: `apps/crm/src/web/router.tsx`

## Verification Commands & Results
1. **Task 3.1 + Pre-tasks P1–P3 Verify**: `pnpm --filter @abm/crm test -- chat.test.ts`
   - Exit code: `0`
   - Key output: `✓ test/chat.test.ts (13 tests) 1082ms`
2. **Task 3.2 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
3. **Task 3.3 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
4. **Task 3.4 Verify**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
5. **Task 3.5 Verify**: `pnpm --filter @abm/crm test -- notifications.test.ts`
   - Exit code: `0`
   - Key output: `measured_d1_count { batchCalls: 4, outsideBatchExecs: 8, totalD1: 12 } | ✓ test/notifications.test.ts (7 tests) 558ms`
6. **Task 3.6 Verify (Typecheck)**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
7. **Task 3.6 Verify (CRM Tests)**: `pnpm --filter @abm/crm test`
   - Exit code: `0`
   - Key output: `Test Files 54 passed | 1 skipped (55) | Tests 649 passed | 2 skipped (651)`
8. **Final Check — Workspace Typecheck**: `pnpm -r typecheck`
   - Exit code: `0`
   - Key output: `apps/crm typecheck: Done` (all workspace projects passed)
9. **Final Check — Workspace Tests**: `pnpm -r test`
   - Exit code: `0`
   - Key output: `apps/crm test: Test Files 54 passed | 1 skipped (55) | Tests 649 passed | 2 skipped (651)`
10. **Final Check — CRM Production Build & Dist Assets**: `pnpm --filter @abm/crm build`
    - Exit code: `0`
    - Key output: `✓ built in 3.97s` (`apps/crm/dist` verified to contain `sw.js` and `manifest.webmanifest`)

## Notes / Uncertainties
- None.

Status: DONE
Summary: Completed Phase 02 follow-ups (P1–P4) and Phase 03 in-app notifications, Web Push (`@block65/webcrypto-web-push`), PWA manifest/service worker, notification bell, and settings page. All workspace typechecks, tests (including the 12-query D1 budget test for 10 mentions), and the production build (`dist/sw.js` and `dist/manifest.webmanifest`) passed with exit code 0.
Concerns/Blockers: none
