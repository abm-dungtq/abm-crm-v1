# Run L02: phase 02, threads backend

## Outcome
Phase 02 tasks 2.1 to 2.5 are done, along with the supervisor's extra requirement (an agent answer whose quoted question was recalled is stored without the quote). "Trả lời theo chuỗi" now works on the server. A thread reply stays out of the main flow unless `alsoSendToMain` is set. Each thread has a counter row and followers. Followers get `chat_thread` notifications and their own unread count. The followed-thread list, the thread page, read and subscription endpoints all work. An agent asked inside a thread answers in that thread, using only that thread as context. All acceptance gates exit 0. The `message_budget` line was logged with d1 = 14 and pushes = 6.

## Files
Created:
- `apps/crm/src/worker/chat-threads.ts` contains `ThreadSummary`, `FollowedThreadItem`, `ThreadPage`, `afterThreadMessage`, `threadSummaryStatements`/`buildThreadSummaries`/`loadThreadSummaries`, `resolveThreadRoot`, `getThread`, `listFollowedThreads`, `markThreadRead` and `setThreadSubscription`.
- `apps/crm/test/chat-threads.test.ts` has 11 tests.

Modified:
- `apps/crm/src/worker/chat.ts`:
  - `InsertMessageInput` gains `threadRootId` and `alsoInMain`. The insert stores both, and its guard is the new quote rule from the phase text.
  - `last_message_at` moves only for main-flow messages.
  - New exports: `threadTargetStatement`, `threadInputError`, `checkThreadRoot`, `validateThreadTarget` (one query) and `ThreadRootRow`.
  - Other new exports: `conversationTitleSql`, which is now used by `listConversations`, `agentVisibleConversations` and `listFollowedThreads`, and `clampReadAt`, which `markRead` and `markThreadRead` share.
  - The row mapper moved into `MESSAGE_ROW_SELECT`, `MessageRow` and `hydrateMessages`. These are shared by `listMessages` and `getThread`. One batch runs the attachments and the three summary reads, so `listMessages` stays at 2 queries.
  - `listMessages` takes an optional `actorId`. `messageContext` passes it.
  - `ChatMessageItem.thread`, `ChatConversationSummary.threadUnread`, `ChatConversationRow.mode`, and the new `ChatEvent` members.
  - `unreadTotal` = main-flow unread + thread-only unread in followed, unmuted threads of conversations the actor is still a member of.
  - `authorNameOrDefault` is now exported.
- `apps/crm/src/worker/chat-routes.ts`:
  - POST messages reads and validates `threadRootId` and `alsoSendToMain`. When there is a thread, it batches `memberIds` with the root lookup and calls `afterThreadMessage`. Otherwise it publishes `message.created`. Each person gets at most one notification. The route creates one sink per request.
  - New routes `GET /threads`, `GET /threads/:rootId`, `POST /threads/:rootId/read` and `PUT /threads/:rootId/subscription`.
  - DELETE recalls a thread reply in one batch with a guarded `reply_count - 1`. It then publishes `thread.updated`, plus `message.deleted` when the reply was visible in the main flow.
- `apps/crm/src/worker/chat-agents.ts`:
  - The payload gains `threadRootId`.
  - A thread turn uses thread-only history (the root and its replies, newest 20, without the question), has no quote, and sends `agent.thinking` with `rootId`. The offline notice goes into the thread.
  - `applyChatAgentReply` and `applyChatAgentFailure` load the conversation mode and the root author in their existing first batch. They insert into the thread and call `afterThreadMessage` with no author and no mentions, so nobody is notified.
  - New `insertAgentAnswer` retries without the quote when the quoted question was recalled.
- `apps/crm/src/worker/notify.ts`: there is now a shared allowance of 25 pushes per sink (`PUSH_ALLOWANCE_PER_SINK`), tracked in a `WeakMap<Sink, number>`. `notifyRows` caps each call at `min(pushLimit, remaining)`, and `queuePushes` returns how many pushes it queued. Recipients past the allowance still get the in-app row.
- `apps/crm/test/chat-agents.test.ts`: 2 new tests. One covers a thread turn and its answer (step 2.5.10). The other covers the recalled-question answer (the supervisor's requirement).

## Verify results
| Step | Command | Result |
|------|---------|--------|
| 2.1–2.4 | `pnpm --filter @abm/crm typecheck` | exit 0 |
| 2.5 | `pnpm --filter @abm/crm test -- chat-threads.test.ts chat-agents.test.ts chat.test.ts notifications.test.ts` | first run (before the new tests existed, with mcp-chat-tools): exit 1. `notifications.test.ts` test 1 expected `chat_direct` and got `chat_mention` (see deviation 1). After one fix: exit 0, 4 files, 52 tests passed |
| 2.5 | same with `--reporter=verbose` | `message_budget { d1: 14, pushes: 6, hubCalls: 5, subrequests: 11 }`; `cron_budget { d1: 35, pushes: 15, hubCalls: 5, subrequests: 20 }` |
| Gate | `pnpm -r typecheck` | exit 0 |
| Gate | `pnpm --filter @abm/crm test` | exit 0, 57 files passed and 1 skipped; 694 tests passed and 2 skipped (681 before) |

## Deviations and why
1. **Notification order in direct chats.** The phase says mention, then direct, then thread. The existing `notifications.test.ts` test 1 posts a main-flow direct message that mentions the other person and expects `chat_direct`. I may not edit that file, and the verify command must pass. The order only matters in a direct chat, because `chat_direct` is never sent in a group. So I made one fix: a main-flow direct message notifies `chat_direct` first, and mentions come after it. Everything else follows the phase: thread replies in a direct chat (not also in main) send `chat_mention` and then `chat_thread`, and each person still gets at most one notification.
2. **`threadUnread` in the conversation list leaves out `also_in_main` replies,** the same as `unreadTotal`. Those replies are already counted in that conversation's main `unread`. Leaving them out keeps `unread + threadUnread` equal to the conversation's share of the badge, with no double count. The summary `unread` (thread card and "Chuỗi" tab) counts every reply after the follower's thread read marker, as the phase says.
3. **`listFollowedThreads` makes 2 queries, not 1.** The phase asks for one list query with an unread subquery. `FollowedThreadItem` also needs `repliers` and `latest`, so the list query is followed by `loadThreadSummaries` (one batch). That batch already returns `unread`, so the list query has no separate unread subquery.
4. **`validateThreadTarget` is split into parts.** `threadInputError` (no query), `threadTargetStatement` and `checkThreadRoot` are exported so that the route can batch the root lookup with `memberIds`, as Task 2.3.1 requires. `validateThreadTarget` itself still exists with the specified signature and makes one query.
5. **Offline notice id.** Inside a thread, the id hashes `conversationId#rootId`. Without this, a main-flow notice from the same 10 minutes would leave the thread with no notice.
6. **Recalled thread replies** are left out of the summary's `latest` and `repliers`, which matches the decremented `reply_count`.
7. **Budget test setup.** Test 9 measures one request that sets `alsoSendToMain`, mentions 3 users and `@Trợ lý`, with the bridge offline and 2 devices per member. Before the measurement, one earlier reply from u-huy creates the thread. The test also asserts that the work really happened: 6 pushes, 3 `chat_mention` rows, 1 queued turn, and `reply_count` 3 (the earlier reply, the measured reply and the offline notice). A separate test proves the shared allowance: three `notify` calls on one sink with 8 users × 2 devices give exactly 25 pushes (16 + 9 + 0), and all 24 in-app rows are stored.

## Things I was unsure about
- `setThreadSubscription('following')` stores `last_read_at = NULL`, so every existing reply by others counts as unread for a manual follower. The phase does not say otherwise. Phase 06 can mark the thread read when it is opened.
- `GET /threads/:rootId` and `POST /threads/:rootId/read` also accept a top-level message of a task conversation the actor can see. There are no thread rows there, so these calls only return the root with `thread: null` or do nothing. `PUT …/subscription` returns 404 for task conversations.
- The `isTopic` value for a new thread comes from `chat_thread.is_topic` when the row exists. Otherwise it comes from `conversation.mode === 'topic'`. Phase 03 owns topic behaviour.

Status: DONE_WITH_CONCERNS
Summary: Phase 02 is complete. The new tests and the full suite pass (694 tests), typecheck is clean, and message_budget logged d1 14 and pushes 6. The supervisor's recalled-question fallback is implemented and tested.
Concerns/Blockers: In a main-flow direct message, `chat_direct` is sent before `chat_mention`, which reverses the phase's stated order, to keep the existing notifications test passing. `threadUnread` leaves out also-in-main replies so the badge does not double count.
