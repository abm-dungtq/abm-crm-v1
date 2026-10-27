---
phase: 6
title: "Web: quote reply, thread panel, thread card, Chuỗi tab"
status: pending
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 06: Web quote reply and threads

## Goal
The chat screen behaves like Lark's normal group:
- **Message action menu.** Every message gets a "⋯" button on hover or focus, and a long press on touch. It offers: **Trả lời** (quote), **Trả lời theo chuỗi** (not in task comments, not on thread replies), and **Thu hồi** (own messages). Phase 08 adds "Tạo việc từ tin này".
- **Quote reply.** The composer shows "Đang trả lời <tên>: <đoạn đầu>" with ×. In groups it inserts the `@` mention chip of the original author (removable; not for one's own, agent or system messages). The sent message shows a quote block. Clicking the block jumps to the original and highlights it for 2 s, loading the context window when the original is not on screen. When the original is a thread reply, the click opens its thread.
- **Thread card** under a root with replies. It shows "N trả lời", the last reply time (`HH:mm` today, otherwise `DD/MM`), up to 3 replier initials in small circles, and **Xem chuỗi**.
- **Thread panel.** On screens wider than 860px it is a right-hand column next to the conversation. On phone width it is a full screen with a back button. It contains the root message, the replies oldest first with "Tải trả lời cũ hơn", and a composer with the checkbox **Cũng gửi vào nhóm**, hidden in topic mode. The header has **Theo dõi / Bỏ theo dõi** and **Tắt thông báo / Bật thông báo**. The URL carries `?thread=<rootId>` so Back closes the panel and links can open it.
- **"Chuỗi" tab** in the conversation list ("Tất cả | Chuỗi"). It lists the followed threads with the conversation name, root snippet, reply count, last activity and an unread badge. Muted threads show a muted icon and no badge. Clicking opens the conversation with the panel.
- **Deep links:** `/chat/<id>?thread=<root>` and `/chat/<id>?message=<id>`, used by notifications. Phase 08 uses them from tasks.
- The old inline nested replies are removed.

Proves acceptance criteria 1–5 (UI side).

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server (no `pnpm dev`).
- Modify only the files listed below. **Web files only**: this phase may run in parallel with phases 03–05, which own every worker file.
- Reuse existing classes in `apps/crm/src/web/styles.css`: `.msg*`, `.inbox-side`, `.drawer*`, `.conv-*`, `.btn*`, `.menu-item`, `.chip` and `.small/.muted`. New classes get the prefix `chat-` and sit in one new section `/* ---------- chat: quote, thread card, thread panel ---------- */` in `styles.css`, following the variables already used (`--border`, `--surface-2`, `--accent-weak`, `--muted`).
- UI text is Vietnamese. Keep it accessible: menu buttons have `aria-label`, the panel has `role="complementary"` and `aria-label="Chuỗi trả lời"`, and focus moves to the panel composer when the panel opens.
- Do not put plan or phase ids in comments or test names.

## Context (verified 2026-10-26)
- `apps/crm/src/web/components/chat-thread.tsx` (910 lines):
  - `ChatThread` (line 91) renders the messages and the composer.
  - The nested reply logic is at lines ~176-192 and ~405-420.
  - The send mutation (~line 256) posts `parentMessageId`.
  - Task suggestion cards are at ~lines 432-520, and `TaskFormDialog` at ~782.
  - It is used by `pages/chat.tsx:380` and `pages/task-detail.tsx:428` (embedded task comments).
- `apps/crm/src/web/pages/chat.tsx`:
  - `ChatPage` (line 45) has the list sections "Nhóm"/"Tin riêng" and `ChatConversationPane` (line 248).
  - `useIsPhoneWidth` is at line 26.
  - It uses `inbox-workspace`/`inbox-list`/`inbox-main`, with `data-view` switching list and thread on phone.
- `apps/crm/src/web/chat-socket.ts` handles `message.created/deleted`, `conversation.updated`, `read`, `agent.thinking` and `notification` (lines ~98-130) by invalidating `['chat', …]` queries.
- `apps/crm/src/web/types.ts:105-180` holds `ChatMessage`, `ChatConversationSummary`, `ChatConversationDetail` and `ChatTaskSuggestion`.
- `apps/crm/src/web/router.tsx:167-168` defines the `/chat` and `/chat/$conversationId` routes.
- `components/notification-bell.tsx:11` holds the notification kind union.
- The API contract comes from phase 01 (`replyTo`, `GET /chat/messages/:id/context`) and phase 02 (`thread`, `/chat/threads*`, `thread.updated`).

## Files to Create / Modify
- Create:
  - `apps/crm/src/web/components/chat-message-item.tsx`: one message with its action menu, quote block, thread card, attachments, mentions and legacy suggestion cards.
  - `apps/crm/src/web/components/chat-composer.tsx`: the `MentionInput`, attachments and quote banner, moved out of `chat-thread.tsx` so the main view and the thread panel share it.
  - `apps/crm/src/web/components/chat-thread-panel.tsx`
  - `apps/crm/src/web/chat-links.ts`: pure helpers.
- Modify:
  - `apps/crm/src/web/components/chat-thread.tsx`: use the new components and remove the nesting.
  - `apps/crm/src/web/pages/chat.tsx`: the tab, the panel column and the search params.
  - `apps/crm/src/web/router.tsx`: `validateSearch` for `thread` and `message`.
  - `apps/crm/src/web/chat-socket.ts`
  - `apps/crm/src/web/types.ts`
  - `apps/crm/src/web/components/notification-bell.tsx`: the kind union.
  - `apps/crm/src/web/styles.css`
- Create: `apps/crm/test/web-chat.test.ts`

## Tasks

### Task 6.1 — Types, links, socket
- Steps:
  1. `types.ts`:
     - `ChatMessage`: replace `parentMessageId` with `replyToMessageId`, `replyTo`, `threadRootId`, `alsoInMain` and `thread: ChatThreadSummary | null`.
     - Add `ChatThreadSummary`, `ChatThreadDetail { root, thread, replies, hasMore }`, `ChatFollowedThread` and `ChatMessageContext`, exactly as the phase 02 API contract.
     - `ChatConversationSummary` gains `threadUnread`.
     - Notification kind gains `'chat_thread'`.
  2. `chat-links.ts`:
     - `chatLink({ conversationId, threadRootId?, messageId? })` returns `/chat/<encoded id>` plus a `?thread=` or `?message=` query.
     - `parseChatSearch(search)` returns `{ thread?: string; message?: string }` and drops empty or over-long values (> 64 characters).
     - `replierInitials(name)`: the first letter of the last word, uppercase, Vietnamese-safe (`Đỗ Ngọc Lan` gives `L`).
     - `formatThreadTime(iso, now)` uses Asia/Saigon: `HH:mm` for the same day, `DD/MM` otherwise.
  3. `chat-socket.ts`:
     - `thread.updated` invalidates `['chat', conversationId]` (the main list, for the cards), `['chat', 'thread', rootId]`, `['chat', 'threads']` and `['chat', 'unread']`.
     - `read` with `rootId` invalidates `['chat', 'threads']` and `['chat', 'unread']`.
     - `agent.thinking` with `rootId` marks thinking on the thread panel as well.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 6.2 — Message item, composer, quote
- Steps:
  1. Move the per-message render from `chat-thread.tsx` into `chat-message-item.tsx`. Props: `message`, `context: 'main' | 'thread' | 'task'`, `conversationKind`, `conversationMode`, `onQuote`, `onOpenThread`, `onJumpTo` and `canRecall`. The legacy `meta.taskSuggestions` card and the existing "Tạo việc" behavior move with it unchanged.
  2. Action menu with a "⋯" button (`btn btn-ghost btn-sm icon-btn`, `aria-label="Thao tác với tin"`), using a `menu-item` list:
     - **Trả lời**: always, when the message is not deleted.
     - **Trả lời theo chuỗi**: only when `context === 'main'`, the conversation kind is `group` or `direct`, the conversation mode is `'chat'`, and the message is top-level.
     - **Thu hồi**: own messages, using the existing recall call.

     On touch devices a long press of 500 ms opens the same menu.
  3. Quote block above the body: `.chat-quote` with a left border, the author in bold and the snippet clamped to 2 lines, or "Tin đã thu hồi" in italics. It is a `button` that calls `onJumpTo(replyTo)`.
  4. `chat-composer.tsx`:
     - Holds the existing `MentionInput`, the attachment flow and the agent-thinking hint, plus a quote banner `.chat-quote-banner` (× clears it).
     - Props: `conversationId`, `threadRootId?`, `showAlsoSend`, `quote`, `onSent`.
     - Payload: `{ id, body, replyToMessageId?, threadRootId?, alsoSendToMain?, attachmentIds? }`.
     - In a group, starting a quote of another person's message inserts `@[Tên](user:<id>)` at the start of the text if it is not already there.
  5. Jump to the original:
     - If the original is in the loaded main list, scroll it into view and add `data-highlight="true"` for 2 s (CSS outline using `--accent`).
     - Else if `replyTo.threadRootId` is set and the original is not visible in the main flow, open the thread panel with `message` highlight.
     - Else call `GET /chat/messages/<id>/context`, render that window in "context mode" with a banner `Đang xem tin cũ · Về tin mới nhất` (button), and highlight the message.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 6.3 — Thread card and thread panel
- Steps:
  1. Thread card `.chat-thread-card` under a root with `thread.replyCount > 0`: `N trả lời · <time>`, up to 3 initials circles (`.chat-avatar-mini`, with the title = full name), and a link button **Xem chuỗi**. A dot shows when `thread.unread > 0`.
  2. `chat-thread-panel.tsx`:
     - Data: `useQuery(['chat', 'thread', rootId])` on `GET /chat/threads/<rootId>`. "Tải trả lời cũ hơn" uses `before` = the oldest reply's time and prepends.
     - Header: "Chuỗi" plus the conversation name, the follow and mute buttons (`PUT /subscription`), and close × (desktop) or back ← (phone).
     - Body: the root (`context 'thread'`), then the replies.
     - Composer: `threadRootId` set; checkbox **Cũng gửi vào nhóm** shown when the conversation mode is `'chat'`.
     - When the thread is closed, show the banner "Chủ đề đã đóng" and disable the composer.
     - Mark read: 2 s after open, and after each new reply while open, `POST /chat/threads/<rootId>/read { at: <newest reply createdAt> }`, using the same debounce helper as the main read.
  3. `pages/chat.tsx`:
     - Read `thread` and `message` from the search (`router.tsx` `validateSearch` via `parseChatSearch`).
     - Desktop: render the panel as a third column (`.chat-thread-panel` inside `.inbox-main`, a flex row, width 380px, `border-left`).
     - Phone width: the panel replaces the conversation view (`data-view="thread-panel"`).
     - Opening sets `?thread=`; closing removes it with `navigate({ search: … , replace: false })` so Back works.
     - `?message=` triggers the jump logic once the messages load.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 6.4 — Chuỗi tab and the list
- Steps:
  1. Above the list sections, add a two-button segmented control (`chips`/`chip`): **Tất cả** and **Chuỗi**. The Chuỗi chip has a badge: the number of followed, unmuted threads with unread > 0.
  2. The Chuỗi view uses `useQuery(['chat', 'threads'])` on `GET /chat/threads`, with "Tải thêm" via `before`. Rows use `.conv-row` with the conversation title, `rootAuthorName: rootSnippet`, `N trả lời · time`, an unread badge, and a muted icon when muted. A click navigates to `chatLink({ conversationId, threadRootId })`. Empty state: "Bạn chưa theo dõi chuỗi nào. Trả lời theo chuỗi hoặc bấm Theo dõi để thấy ở đây."
  3. Conversation rows show a small dot when `threadUnread > 0` and `unread === 0`.
  4. `ChatThread` embedded in task detail (`context 'task'`) shows only Trả lời and Thu hồi, and no thread card.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 6.5 — Tests and build
- Target: `apps/crm/test/web-chat.test.ts` (new, pure functions like `test/web-bugfixes.test.ts`).
- Steps: test
  - `chatLink`: encoding, thread and message parameters.
  - `parseChatSearch`: empty and too-long values are dropped.
  - `replierInitials('Đỗ Ngọc Lan') === 'L'` and `replierInitials('trợ lý') === 'L'`.
  - `formatThreadTime`: same day gives `HH:mm`, another day gives `DD/MM`, in Asia/Saigon (e.g. `2026-10-26T16:30:00Z` with now `2026-10-26T16:45:00Z` gives `23:30`; with now `2026-10-26T17:30:00Z`, which is already 27/10 in Saigon, it gives `26/10`).
- Verify:
  1. `pnpm --filter @abm/crm test -- web-chat.test.ts` exits 0.
  2. `pnpm --filter @abm/crm typecheck` exits 0.
  3. `pnpm --filter @abm/crm build` exits 0.
  4. `Get-ChildItem apps/crm/src/web -Recurse -Include *.ts,*.tsx | Select-String 'parentMessageId'` prints nothing.

## Success criteria
- Typecheck, build and the tests pass. No nested inline replies remain. Every UI string listed above is present. The panel works at both widths (checked live in phase 10).

## Risk
- **`chat-thread.tsx` is large.** Splitting it is part of the work. Keep behavior identical for attachments, mentions and agent thinking; phase 10 checks them live.
- **UI checks are manual** (no browser tests in the repo). Each behavior is listed in the phase 10 check list.

## Rollback
Opus only, from the snapshot diff: Opus restores the files changed by this run from the pre-run snapshot tree and deletes the files it created. Executors never run git commands that change the work tree or index.

## Failure Protocol
If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure. Never spawn `kongming`.
Report `Status: BLOCKED` to Opus with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Wait for Opus's instruction before doing anything else.
