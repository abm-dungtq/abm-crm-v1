# Run L06: phase 06, web quote reply and threads

## Outcome
Tasks 6.1 to 6.5 are done, and so is the extra requirement: opening the thread panel marks the thread read. The chat screen now works like a normal Lark group:
- Every message has a "⋯" action menu (a long press opens it on touch).
- Quote replies show a quote block that jumps to the original message.
- A thread card sits under each root that has replies.
- A thread panel opens on the right on desktop and full screen on phone.
- The conversation list has a "Tất cả | Chuỗi" switch.
- `?thread=` and `?message=` deep links work.

The old nested inline replies are gone. Typecheck, the new test file and the build all exit 0. No file outside `apps/crm/src/web/**` and `apps/crm/test/web-chat.test.ts` was touched.

## Files
Created:
- `apps/crm/src/web/chat-links.ts` (66 lines) contains `chatLink`, `parseChatSearch` (plus the `ChatSearch` type), `replierInitials` and `formatThreadTime`.
- `apps/crm/src/web/components/chat-composer.tsx` contains `ChatComposer`, which has the MentionInput, the attachment upload, the quote banner, the "Cũng gửi vào nhóm" checkbox and the agent-thinking hint. Two shared hooks live here too:
  - `useAgentThinking(conversationId, rootId, newest)`
  - `useDebouncedMarkRead(path, at, onDone)`, the 2 s read helper used by both the main view and the panel.
- `apps/crm/src/web/components/chat-message-item.tsx` contains:
  - `ChatMessageItem`: the action menu, quote block, thread card, attachments with the lightbox, and the legacy `meta.taskSuggestions` card with its "Tạo việc" → `TaskFormDialog` (unchanged behaviour).
  - Helpers `fmtFileSize` and `scrollToMessage`.
- `apps/crm/src/web/components/chat-thread-panel.tsx` contains `ChatThreadPanel`.
- `apps/crm/test/web-chat.test.ts` has 9 tests.

Modified:
- `src/web/types.ts`:
  - `ChatMessage` drops `parentMessageId`. It gains `replyToMessageId`, `replyTo`, `threadRootId`, `alsoInMain` and `thread`.
  - New types: `ChatQuotePreview`, `ChatThreadSummary`, `ChatThreadDetail`, `ChatFollowedThread`, `ChatMessageContext` and `ChatThreadSubscriptionState`. They copy the worker's `ThreadSummary`, `ThreadPage`, `FollowedThreadItem` and `ChatMessageContext`.
  - `ChatConversationSummary.threadUnread` is added. `ChatConversationDetail.mode?` is optional; see deviation 3.
- `src/web/chat-socket.ts`:
  - `thread.updated` invalidates `['chat', convId]`, `['chat','thread',rootId]`, `['chat','threads']`, `['chat','conversations']` and `['chat','unread']`.
  - `read` with `rootId` also invalidates `['chat','threads']`.
  - `agent.thinking` passes `rootId` in the window event.
- `src/web/router.tsx`: `/chat/$conversationId` gets `validateSearch` through `parseChatSearch`.
- `src/web/components/notification-bell.tsx`: `'chat_thread'` is added to the kind union. A notification click now uses `navigate({ href })`; see deviation 2.
- `src/web/components/chat-thread.tsx`: the `ChatThread` function block was replaced. `ConversationAgentsDialog` was not touched.
  - The nesting logic, the inline render and the inline composer were removed. The view now uses `ChatMessageItem` and `ChatComposer`.
  - New props `onOpenThread` and `focusMessageId`.
  - Jump logic: the message is highlighted if loaded, its thread is opened if it is a thread reply, and otherwise `GET /chat/messages/:id/context` loads an older-window "context mode" with the banner "Đang xem tin cũ · Về tin mới nhất".
  - The send uses `replyToMessageId`.
- `src/web/pages/chat.tsx`:
  - The "Tất cả | Chuỗi" chips. The Chuỗi chip has a badge counting followed, unmuted threads with unread replies.
  - The Chuỗi list uses `useInfiniteQuery(['chat','threads'])` with "Tải thêm" and the phase's empty-state text.
  - Conversation rows show a dot when `threadUnread > 0 && unread === 0`.
  - The pane is now `.chat-main-row` holding the conversation column and `ChatThreadPanel`.
  - `data-view="thread-panel"` is used on phone.
  - Open and close go through `navigate` with `search`, so they push history entries.
- `src/web/styles.css`: one new section, `/* ---------- chat: quote, thread card, thread panel ---------- */`, appended at the end. Nothing else in the file changed.

## Verify results
| Step | Command | Result |
|------|---------|--------|
| 6.1–6.4 | `pnpm --filter @abm/crm typecheck` | exit 0 (worker and web tsconfig) |
| 6.5.1 | `pnpm --filter @abm/crm test -- web-chat.test.ts` | exit 0, 1 file, 9 tests passed |
| 6.5.2 | `pnpm --filter @abm/crm typecheck` | exit 0 |
| 6.5.3 | `pnpm --filter @abm/crm build` | exit 0, `✓ built in 3.48s` (only the usual chunk-size warning) |
| 6.5.4 | `Get-ChildItem apps/crm/src/web -Recurse -Include *.ts,*.tsx \| Select-String 'parentMessageId'` | prints nothing |

The parallel worker changes did not break typecheck at the time of these runs.

## Extra requirement: the panel marks the thread read
`ChatThreadPanel` calls `useDebouncedMarkRead` with `POST /api/chat/threads/:rootId/read { at }`:
- 2 s after the thread data loads, which covers a thread just followed by hand whose `last_read_at` is NULL.
- Again after every new stored reply while the panel is open.

`at` is the newest stored reply's `createdAt`, or the root's when there are no replies. After it succeeds, it invalidates `threads`, `unread`, `conversations` and the main list, so the "Chuỗi" badge, the conversation dot and the thread card dot all clear.

## Deviations and why
1. **Phone breakpoint is 900px, not 860px.** The page already switches to its one-column phone layout at 900px (`useIsPhoneWidth` and the existing `@media (max-width: 900px)`). Putting a 380px side column inside that one-column layout between 860 and 900px would break it. So the panel is a right column above 900px and full screen at 900px or below.
2. **Notification bell navigation.** Thread notifications carry links like `/chat/<id>?thread=<root>` (see `chat-routes.ts`). `navigate({ to: link })` treats the query as part of the path, so the bell now calls `navigate({ href: item.link })`. This is a one-line change in a file listed for this phase, and it is what makes the notification deep links work.
3. **`ChatConversationDetail.mode` is optional, defaulting to `'chat'`.** `GET /api/chat/conversations/:id` does not return `mode` yet (phase 03 owns that route). Until it does, "Trả lời theo chuỗi" and "Cũng gửi vào nhóm" behave as in chat mode.
4. **Agent-thinking routing.** The main view shows "Trợ lý đang trả lời…" only for events without `rootId`. The thread panel shows it only for events with its own `rootId`. A thread answer never lands in the main flow, so a main-view hint would never clear, which is why I read the phase's "as well" this way.
5. **One small extra in the main flow.** A reply that was also sent to the group shows a link "Đã trả lời trong chuỗi · Xem chuỗi", which opens its thread. Without it, such a reply looks like an ordinary message with no way to reach its thread.
6. **Recall errors** now show as a danger toast from the message item, because the recall call moved into the item. Before, they showed in the composer's FormError.
7. **The send response has `replyTo: null`** (see the L01 report). The composer builds a local quote preview for the pending message, and `onSent` keeps that preview until the invalidated list or thread refetch brings the server's version.
8. **Mute when not following.** "Tắt thông báo" is always shown. When the user does not follow the thread, it sends `state: 'muted'`, which the server treats as following with notifications off.

## Things I was unsure about
- The UI was only typechecked and built. As the phase says, there are no browser tests in the repo; phase 10 checks both widths live.
- Highlighting a reply that is older than the first loaded page of the thread does nothing. There is no auto-load of older pages for a highlight.

Status: DONE_WITH_CONCERNS
Summary: Phase 06 is complete. The action menu, quote block and jump, thread card, thread panel (which marks the thread read on open), Chuỗi tab and deep links are in place. Typecheck, web-chat.test.ts (9 tests) and the build exit 0, and no `parentMessageId` remains in src/web.
Concerns/Blockers: The phone breakpoint follows the existing 900px instead of 860px. `mode` is optional until phase 03 adds it to the conversation detail. The notification bell now navigates with `href` so `?thread=` links work.
