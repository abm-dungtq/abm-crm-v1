---
phase: 2
title: "Threads: followers, unread, notifications, realtime (backend)"
status: pending
priority: P1
effort: "1.5d"
dependencies: [1]
---

# Phase 02: Threads backend

## Goal
"Trả lời theo chuỗi" works on the server, the way Lark does it:
- A message with `threadRootId` goes into that root's thread. It is left out of the main flow unless `alsoSendToMain` is set ("Cũng gửi vào nhóm").
- `chat_thread` keeps the reply count and the last activity. `chat_thread_follower` keeps who follows: the root author, every replier and every person @mentioned in the thread follow automatically. Anyone can follow, unfollow or mute.
- Followers who have not muted get a `chat_thread` notification. Nobody else in the group is notified.
- Per-follower thread unread, a followed-thread list (the "Chuỗi" tab), and a chat badge equal to main-flow unread plus unread in followed, unmuted threads.
- Realtime events stay id-only. New event: `thread.updated { conversationId, rootId, messageId? }`.
- `@Trợ lý` inside a thread answers in the same thread, using only that thread as context.

Proves acceptance criteria 2–5 (server side), 10 (context and placement), 13.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below. Work from `D:\TQD\CRM`; PowerShell; `pnpm` on PATH.
- At most 40 D1 queries per request (a `db.batch` counts as one) and at most 40 subrequests (ChatHub fetches + push fetches). Put the thread writes in ONE `db.batch`.
- Threads exist only in `kind IN ('group','direct')`. Task comment conversations (`kind 'task'`) keep quote replies only.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26, after phase 01)
- `insertMessage`, `listMessages`, `messageContext`, `markRead`, `listConversations`, `unreadTotal` and `publish` live in `apps/crm/src/worker/chat.ts`. `ChatEvent` union: `chat.ts` ~line 72.
- The POST message route is `apps/crm/src/worker/chat-routes.ts` (`chatRoutes.post('/conversations/:id/messages'`). Today it runs `loadConversation`, `memberIds`, `filterMentions`, `insertMessage`, the attachment update, `publish`, then `notify` (`chat_direct` and `chat_mention`), then `scheduleAgentTurns`.
- The DELETE message route is in `chat-routes.ts` (`chatRoutes.delete('/messages/:id'`).
- `notify(sink, input)` is in `notify.ts`. It inserts one batch, reads subscriptions in one query, and does pushes in `waitUntil` (at most 20 per call).
- **Shared push allowance (required in this phase).** One request can call `notify` several times (direct, mention, thread). Add a per-request allowance of 25 pushes on the sink, shared by every `notify` call made with that sink (for example a `pushBudget` counter created with the sink). Once it is used up, further recipients still get the in-app `notification` row but no push.
- Agent turns are in `chat-agents.ts`: `scheduleAgentTurns` (history query and payload), `applyChatAgentReply`, `applyChatAgentFailure`, and the offline notice.
- The D1 counting pattern is in `apps/crm/test/notifications.test.ts:517-531`: wrap `db.prepare`/`db.batch`, a batch counts as one, and the env uses a stub `CHAT_HUB` whose `fetch` counts calls.
- The chat test harness is in `apps/crm/test/chat.test.ts:1-35`: `app.fetch(new Request(...), { ...env, DEMO_MODE: '1' })` with the `X-Demo-User` header.

## Files to Create / Modify
- Create: `apps/crm/src/worker/chat-threads.ts`
- Modify: `apps/crm/src/worker/chat.ts`, `apps/crm/src/worker/chat-routes.ts`, `apps/crm/src/worker/chat-agents.ts`, `apps/crm/src/worker/notify.ts` (shared push allowance)
- Create: `apps/crm/test/chat-threads.test.ts`
- Modify: `apps/crm/test/chat-agents.test.ts` (thread turn cases only)

## API contract (this phase)
- `POST /api/chat/conversations/:id/messages` accepts `{ id, body, replyToMessageId?, threadRootId?, alsoSendToMain?: boolean, attachmentIds? }`.
- `GET /api/chat/threads/:rootId?before=&limit=` returns `{ root: ChatMessageItem, thread: ThreadSummary | null, replies: ChatMessageItem[] (oldest first), hasMore: boolean }`.
- `POST /api/chat/threads/:rootId/read { at }` returns `{ rootId }`.
- `PUT /api/chat/threads/:rootId/subscription { state: 'following' | 'muted' | 'none' }` returns `{ rootId, following, muted }`.
- `GET /api/chat/threads?before=&limit=` returns `FollowedThreadItem[]`, newest activity first, at most 50.
- `ChatMessageItem` gains `thread: ThreadSummary | null`. It is set on a root that has a `chat_thread` row.
- `ThreadSummary = { rootId, conversationId, replyCount, lastReplyAt, lastActivityAt, isTopic, closed, closedAt, repliers: {userId, name}[] (≤3, newest first), latest: {id, authorName, snippet, createdAt}[] (≤3, newest first), following, muted, unread }`.
- `FollowedThreadItem = ThreadSummary & { conversationTitle, conversationKind, rootAuthorName, rootSnippet, rootDeleted }`.
- `ChatConversationSummary` gains `threadUnread: number`: unread in that conversation's followed, unmuted threads.

## Tasks

### Task 2.1 — Insert rules for thread replies
- Target: `chat.ts` (`InsertMessageInput`, `insertMessage`).
- Steps:
  1. Add `threadRootId?: string | null` and `alsoInMain?: boolean` to `InsertMessageInput`. Store them in `thread_root_id` and `also_in_main`.
  2. The quote guard becomes: `?6 IS NULL OR EXISTS (SELECT 1 FROM chat_message p WHERE p.id = ?6 AND p.conversation_id = ?2 AND p.deleted_at IS NULL AND (CASE WHEN ?11 IS NULL THEN (p.thread_root_id IS NULL OR p.also_in_main = 1) ELSE (p.id = ?11 OR p.thread_root_id = ?11) END))`, where `?11` is the thread root. A main-flow quote must target a message visible in the main flow. A quote inside a thread must target the root or a reply of that same thread.
  3. `UPDATE chat_conversation SET last_message_at …` runs only for main-flow messages (`threadRootId` null, or `alsoInMain` true). Thread-only replies do not move the conversation in the list.
  4. New exported `validateThreadTarget(db, conversation, threadRootId, authorKind, alsoInMain)` makes one query: `SELECT r.id, r.conversation_id, r.thread_root_id, r.author_kind, r.author_user_id, r.created_at, t.closed_at, t.is_topic FROM chat_message r LEFT JOIN chat_thread t ON t.root_message_id = r.id WHERE r.id = ?`. It returns the root, or an error with a Vietnamese message (all 422 `VALIDATION_FAILED`):
     - conversation kind `task`: `'Bình luận việc không trả lời theo chuỗi'`
     - root not found, or in another conversation: `'Không tìm thấy tin gốc của chuỗi'`
     - root is itself a reply (`thread_root_id` not null): `'Chỉ trả lời theo chuỗi cho tin gốc'`
     - thread closed and `authorKind === 'user'`: `'Chủ đề đã đóng'`
     - `alsoInMain` without `threadRootId`, or with conversation `mode = 'topic'`: `'Không gửi vào nhóm được ở đây'`

     Agent and system messages may post into a closed thread, so a task card can still be added.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.2 — Thread module
- Target: `apps/crm/src/worker/chat-threads.ts` (new).
- Steps: export
  1. `afterThreadMessage(sink, db, { organizationId, conversationId, rootId, rootAuthorUserId, isTopic, message, authorUserId, mentionIds, memberIds }) → Promise<string[]>`. It runs ONE `db.batch`:
     - (a) `INSERT OR IGNORE INTO chat_thread (root_message_id, conversation_id, is_topic, reply_count, last_activity_at, created_at) VALUES (?, ?, ?, 0, ?, ?)`
     - (b) `UPDATE chat_thread SET reply_count = reply_count + 1, last_reply_at = ?, last_activity_at = ? WHERE root_message_id = ?`
     - (c) one `INSERT OR IGNORE INTO chat_thread_follower (root_message_id, user_id, via, muted, last_read_at, followed_at) SELECT ?1, json_extract(value, '$.u'), json_extract(value, '$.v'), 0, NULL, ?2 FROM json_each(?3)` with the root author (`author`, only when it is a user who is still a member), the replier (`reply`, only for user authors) and the mentions (`mention`)
     - (d) `UPDATE chat_thread_follower SET last_read_at = MAX(COALESCE(last_read_at, ''), ?) WHERE root_message_id = ? AND user_id = ?` for the replier (skip it for non-user authors)
     - (e) `SELECT f.user_id FROM chat_thread_follower f JOIN chat_member cm ON cm.conversation_id = ? AND cm.user_id = f.user_id WHERE f.root_message_id = ? AND f.muted = 0`. The JOIN means a follower who has left the conversation is never notified.

     It then publishes `{ type: 'thread.updated', conversationId, rootId, messageId }` to `memberIds`. When `message.alsoInMain` is true it also publishes `message.created`. It returns the result of (e).
  2. `loadThreadSummaries(db, actorId, rootIds) → Map<string, ThreadSummary>`. It returns an empty map without a query when `rootIds` is empty. Otherwise ONE `db.batch` of three statements, each restricted with `IN (SELECT value FROM json_each(?))`:
     - thread rows `LEFT JOIN chat_thread_follower f ON f.root_message_id = t.root_message_id AND f.user_id = ?`, with `unread` = the count of replies `created_at > COALESCE(f.last_read_at, '')`, `author_user_id IS NOT ?actor`, not deleted (0 when not following)
     - the latest 3 replies per root: `ROW_NUMBER() OVER (PARTITION BY r.thread_root_id ORDER BY r.created_at DESC, r.id DESC) AS rn` and keep `rn <= 3`, with the author name fallbacks of `listMessages`
     - repliers: `SELECT r.thread_root_id, r.author_user_id, u.display_name, MAX(r.created_at) AS at … WHERE r.author_kind = 'user' AND r.deleted_at IS NULL GROUP BY r.thread_root_id, r.author_user_id`, of which the newest 3 are kept per root in JS

     `snippet` = rendered mention text cut to 120 characters.
  3. `getThread(db, actor, rootId, { before?, limit? })` (limit 1–100, default 50). Load the root and `loadConversation(db, actor, root.conversation_id)`, and return null when either is missing or the root is itself a reply. Replies are `thread_root_id = ?` newest first, with `before`, then reversed. Use the same row mapper and attachment loading as `listMessages`: move that mapper into a shared function in `chat.ts` rather than copying it. Add `loadThreadSummaries` for the root. `hasMore` = replies returned equal the limit.
  4. `listFollowedThreads(db, actor, { before?, limit })`, ONE query: `chat_thread_follower f JOIN chat_thread t JOIN chat_conversation c (archived_at IS NULL) JOIN chat_member cm (cm.conversation_id = c.id AND cm.user_id = f.user_id) JOIN chat_message r ON r.id = t.root_message_id`, with `WHERE f.user_id = ?` (and `t.last_activity_at < ?` when `before` is given) and `ORDER BY t.last_activity_at DESC, t.root_message_id DESC LIMIT ?`. Add the unread subquery and the conversation title. Extract the title `CASE` from `listConversations` into one exported helper in `chat.ts` (`conversationTitleSql(alias, actorParam)`) and use it in `listConversations`, `agentVisibleConversations` and here.
  5. `markThreadRead(db, rootId, userId, at)`. It moves the follower's `last_read_at` forward with the same clamp as `markRead`. Extract the clamp into a shared `clampReadAt(at)` in `chat.ts`; do not copy it.
  6. `setThreadSubscription(db, actor, root, state)`:
     - `following`: `INSERT OR IGNORE` the thread row (count 0), `INSERT OR IGNORE` the follower with via `manual`, then `UPDATE … SET muted = 0`
     - `muted`: the same, ending with `muted = 1`
     - `none`: `DELETE` the follower

     All in one batch. Only a top-level message of a group or direct chat the actor belongs to can be followed.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.3 — Routes, unread, recall
- Target: `chat-routes.ts`, `chat.ts`.
- Steps:
  1. POST messages: read `threadRootId` and `alsoSendToMain` (it must be a boolean when present). Run `memberIds` and `validateThreadTarget` in one `db.batch` when `threadRootId` is set. Call `insertMessage`, then the attachment update. For a thread reply, call `afterThreadMessage`. For a main-flow message, call `publish message.created` as today.
  2. Notifications. The order is mention, then direct, then thread, and each person gets at most one notification:
     - `chat_mention`: mentioned members except the author. The link is `/chat/<conv>?thread=<root>` when in a thread, otherwise as today.
     - `chat_direct`: only for direct chats when the message is in the main flow (top-level or `alsoInMain`), for the other member, unless already notified above.
     - `chat_thread`: followers from `afterThreadMessage` minus the author and minus anyone already notified. Title `${actor.displayName} trả lời trong chuỗi`, body = rendered text, link `/chat/<conv>?thread=<root>`, dedupe `msg:<id>`.

     A thread-only reply in a group never notifies non-followers.
  3. Routes: `GET /threads`, `GET /threads/:rootId`, `POST /threads/:rootId/read`, `PUT /threads/:rootId/subscription`, as in the API contract. 404 `notFound` when access fails. After a read or a subscription change, publish `{ type: 'read', conversationId, rootId }` or `thread.updated` to the actor only.
  4. `listMessages`: after the page query, call `loadThreadSummaries` for the page's top-level ids, in the SAME batch as the attachment query. Merge both batches into one `db.batch`, so `listMessages` stays at 2 queries. Set `thread` on each item.
  5. Unread:
     - `listConversations` adds `threadUnread`: the count of replies in followed, unmuted threads of that conversation, newer than the follower's `last_read_at`, not by the actor, not deleted.
     - `unreadTotal` = main-flow unread + the same count over all conversations the actor is still a member of, excluding replies with `also_in_main = 1` (they are already counted in the main flow).
  6. DELETE `/messages/:id`: select `thread_root_id, also_in_main, deleted_at` too. When the message is a thread reply that is not yet deleted, batch the `deleted_at` update with `UPDATE chat_thread SET reply_count = MAX(reply_count - 1, 0) WHERE root_message_id = ?`. Publish `thread.updated` to members, and also `message.deleted` when it was visible in the main flow.
  7. `ChatEvent` union: add `{ type: 'thread.updated'; conversationId; rootId; messageId? }`, `read` with optional `rootId`, and `agent.thinking` with optional `rootId`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.4 — Agent inside a thread
- Target: `chat-agents.ts`.
- Steps:
  1. `ChatCompletionPayload` gains `threadRootId: string | null`.
  2. In `scheduleAgentTurns` for a group or direct message with `threadRootId`:
     - History: `m.id = ?root OR m.thread_root_id = ?root`, the newest 20 excluding the question.
     - Payload: `threadRootId = message.threadRootId` and `replyToMessageId = null`.
     - `agent.thinking` carries `rootId`.
     - The offline notice goes into the same thread.

     Main-flow turns keep the phase 01 behavior (main-flow history, quote the question).
  3. `applyChatAgentReply` and `applyChatAgentFailure`: when the payload has `threadRootId`, insert with `threadRootId`, then call `afterThreadMessage` with `authorUserId = null` and no mentions. Agent messages notify nobody. Load the root author with the conversation in the existing first batch.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.5 — Tests
- Target: `apps/crm/test/chat-threads.test.ts` (new; copy the harness from `chat.test.ts:1-35`), plus thread cases in `chat-agents.test.ts`.
- Steps (seed users `u-lan`, `u-long`, `u-huy`, `u-mai`, all in group G created by `u-lan`):
  1. `u-lan` posts root R. `u-long` replies in a thread. The main-flow `GET messages` does not include the reply, and R carries `thread.replyCount = 1`, `repliers[0].userId = 'u-long'` and `latest[0].snippet`. `GET /threads/R` returns R plus the reply.
  2. Followers after that reply are exactly `{u-lan (author), u-long (reply)}`. `u-lan` has one `chat_thread` notification with link `/chat/<G>?thread=R`. `u-huy` and `u-mai` have none.
  3. A reply that mentions `u-mai` makes `u-mai` follow with via `mention`. `u-mai` gets `chat_mention`, not `chat_thread`.
  4. `alsoSendToMain: true` puts the reply in both the main list and the thread. `u-huy` (not following) gets main-flow unread +1 and no notification.
  5. Unread, after a third person posts thread replies:
     - `u-lan`'s main unread does not change.
     - `GET /threads` lists R with `unread = 2`.
     - `GET /chat/unread` adds 2.
     - After `POST /threads/R/read` the counts drop to 0.
  6. Subscription:
     - `muted` stops notifications but keeps R in `GET /threads` with its unread count, and removes that count from `/chat/unread`.
     - `none` removes R from the list.
     - `following` on a root with no replies creates the thread row (`replyCount 0`).
  7. Errors, all 422:
     - `threadRootId` pointing to a reply
     - `threadRootId` from another conversation
     - a thread reply in a task conversation
     - `alsoSendToMain` without `threadRootId`
     - quoting a main-flow message from inside a thread
  8. Recalling a thread reply drops `replyCount` by 1.
  9. Budget. Set up group G with Trợ lý as a member, the bridge offline (`inbox_setting.bridge_last_seen_at` = 1 hour ago), 2 push subscriptions for every member of G, and VAPID vars as in `notifications.test.ts`. Use the counting wrapper from `notifications.test.ts:517-531` with a stub `CHAT_HUB`. Then `u-long` sends one thread reply with `alsoSendToMain: true`, 3 user mentions and `@Trợ lý`. Assert `d1 <= 40`, `pushes <= 25` and `hubCalls + pushes <= 40`, and log the numbers (`console.log('message_budget', …)`).
  11. A user who followed thread R and was then removed from the conversation gets no `chat_thread` notification when someone replies in R.
  10. `chat-agents.test.ts`: `@Trợ lý` inside thread R queues a payload with `threadRootId = R` and a history that contains only R and its replies. Applying the reply stores it with `thread_root_id = R` and increments `reply_count`.
- Verify: `pnpm --filter @abm/crm test -- chat-threads.test.ts chat-agents.test.ts chat.test.ts notifications.test.ts` exits 0 (the cron budget test in `notifications.test.ts` stays ≤40). Then `pnpm --filter @abm/crm typecheck` and `pnpm --filter @abm/crm test` both exit 0.

## Success criteria
- All tests above pass. The message budget is logged and ≤40. No existing test was weakened.

## Risk
- **Double counting in the badge** (High impact on trust, medium likelihood). Replies with `also_in_main = 1` are excluded from the thread part of `unreadTotal`. Test 5 checks both numbers.
- **Racing replies.** The counters use `reply_count + 1`, so they are atomic. Repliers and latest replies are computed when read, never stored, so they cannot drift.
- **A follower who has left the conversation.** Every follower query joins `chat_member`, so access is re-checked on each read.

## Rollback
Opus only, from the snapshot diff: Opus restores the files changed by this run from the pre-run snapshot tree and deletes the files it created. Executors never run git commands that change the work tree or index. The schema came from phase 01.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to Opus with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Wait for Opus's instruction before doing anything else.
