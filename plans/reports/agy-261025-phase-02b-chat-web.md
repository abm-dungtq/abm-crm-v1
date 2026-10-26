# Phase 02b Report — Chat Web UI and Realtime Client (Task 2.6)

## Tasks Completed
- **Task 2.6 — Web: socket client, chat page, mentions, realtime thread**:
  - Updated `apps/crm/vite.config.ts` to add `ws: true` to the `/api` proxy entry without modifying any other part of the file.
  - Added `ChatAttachment`, `ChatConversationSummary`, `ChatMember`, and `ChatConversationDetail` types (plus `attachments` and `duplicate` on `ChatMessage`) in `apps/crm/src/web/types.ts`.
  - Created `apps/crm/src/web/chat-socket.ts` with `useChatSocket()` and `useChatSocketConnected()`: opens a single WebSocket to `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chat/socket`, sends `'ping'` every 30 s, reconnects with backoff (`1 s, 2 s, 5 s, 10 s, 30 s`), invalidates matching React Query keys on ID-only events (`message.created`, `message.deleted`, `conversation.updated`, `read`), and invalidates all `['chat']` queries on reconnect.
  - Created `apps/crm/src/web/components/mention-input.tsx` with `MentionInput` (`@` trigger with NFD + `đ/Đ` diacritic-folded filtering over `useApi('/directory')`, inserting `@[Name](user:<id>)`), `renderMessageBody` (highlighting `@Name` badges in rendered messages), and `formatMentionText`.
  - Updated `apps/crm/src/web/components/chat-thread.tsx` to use the generic `/chat/conversations/:id/messages`, `/read`, and `/attachments` endpoints (while also supporting `listPath` bootstrap for task detail comments `/tasks/:id/comments` returning `conversationId`), query key `['chat', conversationId]`, `refetchInterval: connected ? false : 60_000` (no polling while socket is connected; 60 s polling only while disconnected), nested thread replies under their parent with a `"Trả lời"` action, inline image attachments with lightbox and file links, and a paperclip upload button that uploads files first and then sends `attachmentIds`.
  - Created `apps/crm/src/web/pages/chat.tsx` with left-column `"Nhóm"` and `"Tin riêng"` sections with unread badges, `"Tạo nhóm"` (title + members) and `"Nhắn riêng"` (colleague picker) modals, right-column header with members and group member management, `<ChatThread>`, the `"Cho agent đọc hội thoại này"` switch bound to `agentReadable` on direct chats, the footnote `"Tin nhắn có thể được agent mà thành viên đã kết nối đọc."`, and responsive phone-width stacking (`data-view="list" | "thread"` and `.inbox-back` link from thread to `/chat`).
  - Updated `apps/crm/src/web/components/layout.tsx` to mount `useChatSocket()` once in `Shell` and add the `"Chat"` sidebar navigation item for every role with the `['chat', 'unread']` total as a badge.
  - Updated `apps/crm/src/web/router.tsx` to register `/chat` and `/chat/$conversationId`.

## Files Changed
- Created: `apps/crm/src/web/chat-socket.ts`
- Created: `apps/crm/src/web/components/mention-input.tsx`
- Created: `apps/crm/src/web/pages/chat.tsx`
- Modified: `apps/crm/vite.config.ts`
- Modified: `apps/crm/src/web/types.ts`
- Modified: `apps/crm/src/web/components/chat-thread.tsx`
- Modified: `apps/crm/src/web/components/layout.tsx`
- Modified: `apps/crm/src/web/router.tsx`

## Verification Commands & Results
1. **Task 2.6 Verify — CRM Typecheck**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
2. **Final Check — Workspace Typecheck**: `pnpm -r typecheck`
   - Exit code: `0`
   - Key output: `apps/crm typecheck: Done` (all workspace projects passed)
3. **Final Check — Workspace Tests**: `pnpm -r test`
   - Exit code: `0`
   - Key output: `apps/crm test: Test Files 53 passed | 1 skipped (54) | Tests 637 passed | 2 skipped (639)`
4. **Final Check — CRM Production Build**: `pnpm --filter @abm/crm build`
   - Exit code: `0`
   - Key output: `✓ 313 modules transformed. ... ✓ built in 3.58s`

## Notes / Uncertainties
- `apps/crm/src/web/pages/task-detail.tsx` (from Phase 01b, not in the Phase 02 modified files list) passes `listPath="/tasks/${task.id}/comments"` to `<ChatThread>`. `ChatThread` accepts both `conversationId` (used by `pages/chat.tsx`) and `listPath` (used by `task-detail.tsx` to obtain `conversationId` from `GET /tasks/:id/comments` and then use query key `['chat', conversationId]` and the `/chat/conversations/:id/*` endpoints), keeping `task-detail.tsx` untouched.

Status: DONE
Summary: Implemented the Phase 02b internal chat web UI (`chat.tsx`, `mention-input.tsx`, `chat-thread.tsx`), WebSocket client (`chat-socket.ts`), navigation/router integration (`layout.tsx`, `router.tsx`), and Vite WebSocket proxy config (`vite.config.ts`). All verification checks (`pnpm -r typecheck`, `pnpm -r test`, and `pnpm --filter @abm/crm build`) passed with exit code 0.
Concerns/Blockers: none
