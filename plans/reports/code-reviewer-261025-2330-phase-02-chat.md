# Code review: phase 02, internal chat (groups, direct messages, task threads, realtime)

Plan: `plans/261025-1500-internal-chat-tasks-agents/phase-02-chat-realtime.md`. Code is uncommitted on main (HEAD 773b399). I ignored the LMS changes in the same files.

## Scope
- Worker: `chat.ts`, `chat-routes.ts`, `chat-hub.ts`, the `env.ts` Sink/CHAT_HUB parts, `index.ts` (task comment routes, `/chat` mount, `ChatHub` export), `wrangler.jsonc`, `migrations/0026_chat_attachments.sql`
- Web: `chat-socket.ts`, `components/chat-thread.tsx`, `components/mention-input.tsx`, `pages/chat.tsx`, `components/layout.tsx`, `router.tsx`
- Tests: `test/chat.test.ts`, `test/chat-hub.test.ts`
- Checked against: `actor.ts` (requireActor), `session.ts` (originGuard), `task-scope.ts` (canSeeTask), `commands.ts` (updateTask chat_member prune), migration 0025 indexes

## Overall assessment
Access control holds. Every conversation-scoped route goes through `loadConversation`: org match, not archived, and then `chat_member` for group/direct or `canSeeTask` for task threads. The delete-message and download routes resolve the conversation through it too. Writes are covered by the global `originGuard`. The socket route checks `Origin` and only accepts the actor from the session cookie, never a header the client sent. Downloads use the content-type allowlist, set `nosniff`, and send everything except raster images as `attachment`. Message bodies and mentions render as React text nodes, with no `dangerouslySetInnerHTML`. The Durable Object only relays id-only events and stores nothing. Chat messages are not written to `audit_log`. I found no Critical issue. I fixed two High issues below.

## Critical issues
None.

## High priority (fixed)
1. **The read marker trusted the browser clock and could never move back.** In `chat.ts`, `markRead` stored the client's `at` with `MAX(...)`. A future value from a skewed clock, an optimistic message's local `createdAt` or a crafted request froze the user's unread count until that time. Because the marker never moves back, this could not be corrected. Fix: `markRead` now converts `at` to ISO and caps it at the server time. This covers both `/chat/.../read` and `/tasks/:id/comments/read`. Test: "a read marker in the future is capped at the server clock…", which fails without the fix.
2. **Each read marker cost an extra message refetch (request budget).** `POST /read` publishes `read` back to the actor, and `chat-socket.ts` then invalidated `['chat', conversationId]`. So every message a viewer opened caused one more messages GET in that same tab, multiplied by the number of viewers, against the 100k requests/day Free limit. Fix: the `read` handler now invalidates only `['chat','conversations']` and `['chat','unread']`.

Also added the regression test "a user outside the task scope cannot read, post to, upload to or download from its thread". It proves that a task thread follows `canSeeTask` for GET messages, POST message, upload and download (404), and that the assignee is allowed. No existing test covered non-member upload/download or the task-thread access path.

## Medium priority (not fixed)
1. **Attachments of a recalled message can still be downloaded.** `GET /chat/attachments/:id` does not check `chat_message.deleted_at`. "Thu hồi" (recall) hides the files in the list, but the URL keeps working for every member, and `Cache-Control: private, max-age=31536000, immutable` keeps cached copies. Suggest: `LEFT JOIN chat_message m ON m.id = a.message_id` and return 404 when `m.deleted_at IS NOT NULL`. Also consider a shorter max-age, so that removal from a group takes effect.
2. **Uploaded files that are never sent stay in R2 forever.** Rows with `message_id IS NULL` (upload then cancel, or a send that failed) are never cleaned up, and the R2 put happens before the D1 insert. Suggest a cron sweep that deletes rows with `message_id IS NULL AND created_at < now-1d` and their R2 objects, in batches within the 50-subrequest limit.
3. **Opening a task makes a manager a permanent thread member.** `GET /tasks/:id/comments` (`ensureTaskConversation`) adds the viewer to `chat_member`. A director or leader who glances at a task then gets every later comment counted in `/chat/unread` and gets socket events, until an assignee or member change prunes them. It also writes to D1 on every GET. This is a product decision. Options: only add task participants, or add viewers only when they post.
4. **The task comment route in `index.ts` does not filter mentions.** `POST /tasks/:id/comments` stores `parseMentions(body)` unfiltered, while `/chat/.../messages` filters mentions to members/`canSeeTask`. If phase 03/04 notifies mentioned users, this route could notify people outside the task scope (with the task title). The web client now uses the `/chat` route only, so either route this POST through the same filter or remove it.
5. **Mention filtering runs queries one user at a time.** In task threads, `filterMentions` runs up to 2 queries per mention (10 mentions = 20 queries). A full POST is about 26 queries, still under 50. Suggest one query: `SELECT ... FROM app_user WHERE id IN (json_each(?))`, then reuse a `taskScope` SQL with the candidate bound, or accept the cost and document it.
6. **Open sockets ignore logout, deactivation and session revoke.** A hibernated socket keeps receiving events after the session ends. The events carry only ids (conversation and message ids, no content), so impact is small. Suggest: on logout/deactivate, call a hub `/disconnect` with the user id that closes `getWebSockets(userId)`.
7. **A failed socket reconnects forever.** When the socket fails (expired session 401, demo mode, where a browser WebSocket cannot send `X-Demo-User`), `chat-socket.ts` retries every 30 s indefinitely, about 2,880 Worker requests per tab per day. Suggest stopping after N failures, or retrying only after a successful API call.
8. **Sending a message refetches the thread twice.** After a send, `chat-thread.tsx` invalidates `['chat', id]` in `onSuccess` although it already called `setQueryData`, and the socket echo of `message.created` invalidates it again. Drop the `onSuccess` invalidation when `connected`.

## Low priority
- `PATCH /conversations/:id` with both `agentReadable` and an invalid `title` saves `agent_readable` and then returns 422 (partial update). Validate everything before writing.
- `Content-Disposition` builds `filename*` with `encodeURIComponent`, which leaves `' ( ) * !` unescaped (not RFC 5987 attr-char). Browsers tolerate it. Header injection is impossible because CR/LF are encoded.
- `listMessages` pages by `created_at < before` only, so messages that share a timestamp at the page edge are skipped. There is no "load older" UI yet, so a thread shows only the newest 50 messages, and replies to older parents render as top-level messages.
- `listConversations` uses `ORDER BY last_message_at DESC`, so new empty groups (NULL) sort last.
- Mention labels come from the message text: `@[Giám đốc](user:u-x)` displays any name. This is cosmetic only, since the stored mentions are filtered by id.
- Group members may remove every member, including the owner, which leaves an orphaned group.
- `parseBody` buffers the whole multipart upload. A chunked upload with no `Content-Length` skips the early 413 and is fully read before the size check. Only members can upload.
- The hub accepts unlimited sockets per user.

## Edge cases checked
- Path to the message store: the DO `/broadcast` and `/online` are reachable only through the binding. `X-Chat-User` is set by the Worker, not copied from the client.
- Hibernation: auto-response `ping`/`pong` is set in the constructor. `webSocketClose` maps 1005/1006 to 1000 and swallows errors. Compatibility date 2026-10-03.
- Parent message from another conversation: rejected by `INSERT ... WHERE EXISTS`. Duplicate id from another author or conversation: CONFLICT. Same author: idempotent.
- Attachment linking: limited to the same conversation, the same uploader and `message_id IS NULL`, so a member cannot steal another member's upload.
- Direct chat: deterministic `dm:<a>:<b>` id. The other user must be active and in the same org. Members cannot be added to or removed from direct or task chats (422).
- Polling: thread, conversation list, conversation header and unread badge use `refetchInterval` only while the socket is disconnected.
- D1 LIKE limit: no LIKE in the chat code.

## Positive observations
- A single access helper (`loadConversation`) is used by every route, so the access rule exists in one place.
- The Durable Object holds no data, matching the ADR.

## Plan follow-ups
- Tasks 2.1–2.6 appear implemented and verified by tests. I did not review docs task 2.7.
- Recommended next: Medium 1 (recalled attachments still downloadable), Medium 4 (mention filter on the task comment route) before phase 03 notifications, and Medium 2 (cleanup sweep).

## Verification
- `pnpm --filter @abm/crm exec vitest run test/chat.test.ts test/chat-hub.test.ts`: 11 passed
- `pnpm -r typecheck`: exit 0
- `pnpm --filter @abm/crm test`: 53 files passed, 1 skipped; 639 tests passed, 2 skipped; exit 0

## Files changed by this review
- `apps/crm/src/worker/chat.ts`: `markRead` converts `at` to ISO and caps it at the server time
- `apps/crm/src/web/chat-socket.ts`: the `read` event no longer refetches messages
- `apps/crm/test/chat.test.ts`: 2 new tests (task-scope access for read/post/upload/download; future read marker)

## Unresolved questions
- Should viewing a task make managers permanent thread members, with unread counts and events (Medium 3)?
- Should recall also revoke attachment downloads (Medium 1)? Recommended: yes.

Status: DONE_WITH_CONCERNS
Summary: Access control, XSS defenses, WebSocket origin/auth and DO hibernation are sound. I fixed two High issues (read marker trusted the client clock; read events caused extra message refetches) and added access-control regression tests. Typecheck and the full CRM suite exit 0.
Concerns/Blockers: Medium items 1 (recalled attachments still downloadable), 3 (task viewers become permanent members) and 4 (unfiltered mentions on the task comment route) should be decided before phase 03 notifications.

## Advisor decision (2026-10-25)
- Fixed in phase 03 pre-tasks: recalled-message attachments return 404, the attachment cache becomes private for 300 s, viewers no longer join task threads, task-comment mentions are filtered, and the socket stops retrying after 10 failures.
- Accepted debt, deferred:
  - Orphan R2 uploads. Later fix: a daily cron removes files still unsent after 24 h.
  - Sockets stay open after logout or deactivation. Events carry ids only and every REST read checks access again, so no content leaks.
  - Sending a message refetches the thread twice.
