---
phase: 2
title: "Chat: groups, direct messages, realtime ChatHub, attachments, ADR"
status: pending
priority: P1
effort: "2.5d"
dependencies: [1]
---

# Phase 02: Chat — groups, direct messages, realtime ChatHub, attachments, ADR

## Goal
Staff chat in group conversations and 1-1 direct messages inside the CRM web app, reply in threads, @mention people, attach files, and see new messages within 2 seconds without reloading. Task comments from phase 01 become realtime too. A single SQLite-backed Durable Object `ChatHub` per organization relays events over hibernating WebSockets; D1 stays the only message store. Docs record that internal chat moved from Lark into the CRM.

## Rules for the executor
- Never run `git commit`, deploy, `wrangler --remote`, or a background dev server.
- Modify only the files listed below.
- Work from `D:\TQD\CRM`. Shell is PowerShell; `pnpm` is on PATH.
- Workers Free limit: one request or cron run may use at most 50 D1 queries (a `db.batch` counts as one) and at most 50 subrequests (DO fetch, R2, push `fetch`). Batch writes; never loop `.run()` per row.
- The Durable Object must never store messages (no `ctx.storage.put` of message data). It only holds sockets.

## Files to Create / Modify
- Create: `apps/crm/migrations/0026_chat_attachments.sql`
- Create: `apps/crm/src/worker/chat-hub.ts` (Durable Object class `ChatHub`)
- Create: `apps/crm/src/worker/chat-routes.ts` (Hono sub-app mounted at `/chat`)
- Modify: `apps/crm/src/worker/chat.ts` (access check, conversation list, publish helper)
- Modify: `apps/crm/src/worker/index.ts` (mount `/chat`, export `ChatHub`, publish from task comment routes)
- Modify: `apps/crm/src/worker/env.ts` (binding `CHAT_HUB: DurableObjectNamespace`, `Sink`, `sinkFrom`)
- Modify: `apps/crm/wrangler.jsonc` (`durable_objects` binding + `migrations` with `new_sqlite_classes`)
- Modify: `apps/crm/vite.config.ts` (proxy `ws: true`)
- Modify: `apps/crm/test/helpers/reset-db.ts` (`TABLES`)
- Create: `apps/crm/src/web/chat-socket.ts`
- Create: `apps/crm/src/web/pages/chat.tsx`, `apps/crm/src/web/components/mention-input.tsx`
- Modify: `apps/crm/src/web/components/chat-thread.tsx`, `apps/crm/src/web/components/layout.tsx`, `apps/crm/src/web/router.tsx`, `apps/crm/src/web/types.ts`
- Create: `apps/crm/test/chat.test.ts`, `apps/crm/test/chat-hub.test.ts`
- Create: `docs/adr/adr-012-internal-chat-in-crm.md`
- Modify: `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`, `docs/decisions/business-decisions-v1.md` (line ~129), `docs/README.md` (ADR list)

## Tasks

### Task 2.1 — Migration 0026
- Goal: attachments of chat messages are tracked in D1; files live in R2 `MEDIA`.
- Target: `apps/crm/migrations/0026_chat_attachments.sql` (new).
- Steps: create the file with exactly this content:

```sql
-- Files attached to internal chat messages and task comments. Bytes live in R2 MEDIA under chat/<conversation>/<id>.
-- message_id is NULL between upload and the message that uses it.
CREATE TABLE chat_attachment (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversation(id),
  message_id TEXT REFERENCES chat_message(id),
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by_user_id TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL
);
CREATE INDEX chat_attachment_message ON chat_attachment(message_id);
```

- Then in `apps/crm/test/helpers/reset-db.ts` `TABLES`, insert `'chat_attachment',` directly before `'chat_message'`.
- Verify: `pnpm --filter @abm/crm test -- task-engine.test.ts` exits 0.

### Task 2.2 — ChatHub Durable Object and binding
- Goal: one hub per organization accepts authenticated sockets and fans out events by user id.
- Target: `apps/crm/src/worker/chat-hub.ts` (new), `apps/crm/wrangler.jsonc`, `apps/crm/src/worker/env.ts`, `apps/crm/src/worker/index.ts`.
- Steps:
  1. `chat-hub.ts`:
     ```ts
     import { DurableObject } from 'cloudflare:workers';

     /**
      * Relays internal chat events to connected browsers. One instance per organization; every socket is tagged
      * with its user id. Holds no data: D1 is the message store, so a reconnecting client reloads from D1.
      */
     export class ChatHub extends DurableObject {
       constructor(ctx: DurableObjectState, env: unknown) {
         super(ctx, env);
         // Answered by the runtime without waking the object, so idle keep-alives cost nothing.
         ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
       }

       async fetch(request: Request): Promise<Response> {
         const url = new URL(request.url);
         if (url.pathname === '/connect') {
           const userId = request.headers.get('X-Chat-User');
           if (!userId || request.headers.get('Upgrade') !== 'websocket') return new Response('bad request', { status: 400 });
           const pair = new WebSocketPair();
           this.ctx.acceptWebSocket(pair[1], [userId]);
           return new Response(null, { status: 101, webSocket: pair[0] });
         }
         if (url.pathname === '/broadcast' && request.method === 'POST') {
           const { userIds, event } = await request.json<{ userIds: string[]; event: unknown }>();
           const text = JSON.stringify(event);
           let delivered = 0;
           for (const id of new Set(userIds)) {
             for (const ws of this.ctx.getWebSockets(id)) {
               try { ws.send(text); delivered += 1; } catch { /* closed socket; the runtime drops it */ }
             }
           }
           return Response.json({ delivered });
         }
         if (url.pathname === '/online') {
           const ids = new Set(this.ctx.getWebSockets().flatMap((ws) => this.ctx.getTags(ws)));
           return Response.json({ userIds: [...ids] });
         }
         return new Response('not found', { status: 404 });
       }

       async webSocketMessage() { /* clients only send 'ping', answered by auto-response */ }
       async webSocketClose(ws: WebSocket, code: number) {
         // 1005/1006 are reserved and make close() throw.
         try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closed'); } catch { /* already closed */ }
       }
     }
     ```
  2. `wrangler.jsonc`: add at top level
     ```jsonc
     // Internal chat relay (docs/adr/adr-012-internal-chat-in-crm.md). SQLite-backed so it runs on the Workers Free plan.
     "durable_objects": { "bindings": [{ "name": "CHAT_HUB", "class_name": "ChatHub" }] },
     "migrations": [{ "tag": "v1-chat-hub", "new_sqlite_classes": ["ChatHub"] }],
     ```
  3. `env.ts`: add `CHAT_HUB: DurableObjectNamespace;` to the bindings type.
  4. `index.ts`: `export { ChatHub } from './chat-hub';` beside the default export.
- Success criteria: typecheck passes; tests still start (the vitest pool reads `wrangler.jsonc`).
- Verify: `pnpm --filter @abm/crm typecheck` exits 0 and `pnpm --filter @abm/crm test -- task-engine.test.ts` exits 0.

### Task 2.3 — Chat store: access, list, publish
- Goal: one access rule and one publish helper used by every chat route.
- Target: `apps/crm/src/worker/chat.ts`.
- Steps: add and export:
  1. `loadConversation(db, actor, id)`: row of `chat_conversation` in `actor.organizationId`, not archived; access = `kind='task'` → `canSeeTask(db, actor, task_id)`; otherwise a `chat_member` row for `actor.id`. Return null when no access.
  2. `memberIds(db, conversationId)`: user ids from `chat_member`.
  3. `listConversations(db, actor)`: group and direct conversations where actor is a member, newest `last_message_at` first, each with `title` (direct: the other member's display name), `lastMessage` preview (first 120 chars, `''` if deleted), `unread` = count of messages with `created_at > COALESCE(last_read_at,'')`, `author_user_id IS NOT actor.id`, `deleted_at IS NULL`.
  4. `unreadTotal(db, actor)`: sum of `unread` across group, direct and task conversations of the actor.
  5. `findOrCreateDirect(db, actor, otherUserId)`: other user must be active in the same organization and not the actor; `direct_key = [a,b].sort().join(':')`; `INSERT OR IGNORE` conversation (`id = 'dm:' + direct_key`) and both `chat_member` rows; return id.
  6. A delivery sink usable from requests and from cron: in `env.ts` export `interface Sink { env: Env; waitUntil(work: Promise<unknown>): void }` and `sinkFrom(c: Context<AppBindings>): Sink` (`waitUntil: (w) => { void background(c, w); }`). In `chat.ts` export `publish(sink: Sink, organizationId, userIds, event)`: `sink.waitUntil(hub.fetch('https://chat-hub/broadcast', { method: 'POST', body: JSON.stringify({ userIds, event }) }).catch(() => undefined))` where `hub = sink.env.CHAT_HUB.get(sink.env.CHAT_HUB.idFromName(organizationId))`. Never throw to the caller. Routes call `publish(sinkFrom(c), ...)`; the cron handler (phase 03-04) builds a sink from its `ExecutionContext`.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.4 — Chat routes
- Goal: REST API for conversations, messages, members, read markers, attachments, and the socket.
- Target: `apps/crm/src/worker/chat-routes.ts` (new, `export const chatRoutes = new Hono<AppBindings>()`), mounted in `index.ts` with `app.route('/chat', chatRoutes)` after `app.use('*', requireActor)`.
- Steps: implement exactly these routes (all use `c.get('actor')`; return `{ ok, data }` / `fail` like other routes):
  1. `GET /socket`: reject unless `c.req.header('Upgrade') === 'websocket'` (426); whenever an `Origin` header is present it must equal the request origin (403; cookie-authenticated sockets must come from this site). Forward `new Request('https://chat-hub/connect', { headers: { Upgrade: 'websocket', 'X-Chat-User': actor.id } })` to the hub of `actor.organizationId` and return its response.
  2. `GET /conversations` → `listConversations`. `GET /unread` → `{ total }`.
  3. `POST /conversations`: body `{ kind: 'group', title (1-80), memberUserIds (1-50) }` → new id `crypto.randomUUID()`, creator gets `role='owner'`, all members active and same org; or `{ kind: 'direct', userId }` → `findOrCreateDirect`. Publish `conversation.updated` to members.
  4. `GET /conversations/:id` → conversation + members `{id,name,role}`.
  5. `PATCH /conversations/:id`: `title` (group; owner, director or admin); `agentReadable: boolean` (direct only; any member). Publish `conversation.updated`.
  6. `POST /conversations/:id/members` `{ userIds }` and `DELETE /conversations/:id/members/:userId` (group only; owner/director/admin, or the user removing themself). Publish `conversation.updated` to old and new members.
  7. `GET /conversations/:id/messages?before=&limit=` → `listMessages` plus each message's attachments `{id,fileName,contentType,size}`.
  8. `POST /conversations/:id/messages` `{ id: uuid, body, parentMessageId?, attachmentIds?: string[] (max 5) }` → `insertMessage` with `mentions = parseMentions(body)` (keep at most 10) filtered to members (for task conversations: users who `canSeeTask`), set `chat_attachment.message_id` for the given ids that belong to this conversation and the author; publish `{ type: 'message.created', conversationId, message }` to members.
  9. `DELETE /messages/:id`: author only; set `deleted_at`; publish `message.deleted`.
  10. `POST /conversations/:id/read` `{ at }` → `markRead`; publish `{ type: 'read', conversationId }` to the actor only (other tabs).
  11. `POST /conversations/:id/attachments`: `multipart/form-data` field `file`, max 10 MB (`413` otherwise), store in `c.env.MEDIA` key `chat/<conversationId>/<uuid>`, insert `chat_attachment`, return `{ id }`. Store `content_type` as given only if it is in the allowlist `image/png, image/jpeg, image/gif, image/webp, application/pdf, text/plain, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.openxmlformats-officedocument.presentationml.presentation, application/zip`; otherwise store `application/octet-stream`. `GET /attachments/:id`: access through the conversation; stream the R2 object with header `X-Content-Type-Options: nosniff` (copy the media response headers in `inbox/bridge-routes.ts` ~lines 150-156); `Content-Disposition: inline; filename*=UTF-8''<encoded>` only for `image/png|jpeg|gif|webp`, every other type `attachment; filename*=UTF-8''<encoded>` (an uploaded HTML/SVG file must never render on the CRM origin).
  12. In `index.ts`, make the phase 01 task comment POST also call `publish(... 'message.created' ...)` to the task conversation members.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0.

### Task 2.5 — Tests
- Goal: prove access rules, direct uniqueness, the agent toggle and hub fan-out.
- Target: `apps/crm/test/chat.test.ts`, `apps/crm/test/chat-hub.test.ts` (new). Reuse the helpers header from `apps/crm/test/commands.test.ts` lines 1-33; add `CHAT_HUB: DurableObjectNamespace` to the `Cloudflare.Env` declaration.
- Steps:
  1. `chat.test.ts`:
     - `u-lan` creates a group with `u-long`; `u-long` posts; `u-lan` sees `unread: 1`, reads, sees `0`; `u-huy` gets 404 on messages.
     - Direct `u-lan`→`u-huy` twice returns the same id; `u-huy`→`u-lan` returns the same id.
     - `PATCH agentReadable:false` by either member → column `agent_readable` = 0; on a group → 400/VALIDATION_FAILED.
     - Posting the same message id twice stores one row.
     - Deleting someone else's message → 403/404; own → `deleted: true` in list.
     - Attachment upload of 11 MB → 413.
  2. `chat-hub.test.ts`: get the hub stub `env.CHAT_HUB.get(env.CHAT_HUB.idFromName('org-abm'))`; `stub.fetch('https://chat-hub/connect', { headers: { Upgrade: 'websocket', 'X-Chat-User': 'u-lan' } })` → status 101; `ws = res.webSocket!; ws.accept();` collect messages; `stub.fetch('https://chat-hub/broadcast', { method: 'POST', body: JSON.stringify({ userIds: ['u-lan'], event: { type: 'x' } }) })` → `{ delivered: 1 }` and the socket receives `{"type":"x"}`; broadcasting to `['u-huy']` → `{ delivered: 0 }`.
  3. `GET /api/chat/socket` with headers `Upgrade: websocket` and `Origin: https://evil.example` → 403.
  4. Upload a file with content type `text/html` → `GET /attachments/:id` responds with `Content-Disposition` starting `attachment` and `X-Content-Type-Options: nosniff`.
- Verify: `pnpm --filter @abm/crm test -- chat.test.ts chat-hub.test.ts` exits 0.

### Task 2.6 — Web: socket client, chat page, mentions, realtime thread
- Goal: a chat screen with group and direct conversations and live updates everywhere.
- Target: `apps/crm/src/web/chat-socket.ts`, `pages/chat.tsx`, `components/mention-input.tsx`, `components/chat-thread.tsx`, `components/layout.tsx`, `router.tsx`, `types.ts`, `apps/crm/vite.config.ts`.
- Steps:
  1. `vite.config.ts`: proxy entry becomes `'/api': { target: 'http://127.0.0.1:8787', changeOrigin: false, ws: true }`.
  2. `chat-socket.ts`: `useChatSocket()` opens one `WebSocket` to `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chat/socket`; sends `'ping'` every 30 s; reconnects with backoff 1 s, 2 s, 5 s, 10 s, 30 s; exposes `connected` state. On `message.created` / `message.deleted` → `queryClient.invalidateQueries({ queryKey: ['chat', conversationId] })` and `['chat', 'conversations']` and `['chat', 'unread']`; on `conversation.updated` → invalidate conversations; on reconnect → invalidate every `['chat']` query. Mount it once in `layout.tsx`.
  3. `chat-thread.tsx`: switch to the generic routes (`/chat/conversations/:id/messages`, `/read`, `/attachments`) given a `conversationId` prop; task detail obtains the id from `GET /tasks/:id/comments` response (return `conversationId` there). Use query key `['chat', conversationId]`; `refetchInterval` 60000 only while the socket is disconnected. Show thread replies under their parent with a "Trả lời" action; show attachments (images inline, others as links); paperclip button uploads first, then sends `attachmentIds`.
  4. `mention-input.tsx`: textarea; typing `@` opens a list from `useApi('/directory')` filtered by typed text (fold diacritics with the existing helper used for search, or `normalize('NFD')`); choosing inserts `@[Name](user:<id>)`; rendered messages show `@Name` highlighted.
  5. `pages/chat.tsx`: left column sections "Nhóm" and "Tin riêng" with unread badges, buttons "Tạo nhóm" (title + members) and "Nhắn riêng" (pick a person); right column `<ChatThread>` and a header with members; for direct chats a switch "Cho agent đọc hội thoại này" bound to `agentReadable`; footnote "Tin nhắn có thể được agent mà thành viên đã kết nối đọc."
  6. `router.tsx`: routes `/chat` and `/chat/$conversationId`. `layout.tsx`: nav item "Chat" for every role with the `['chat','unread']` total as a badge.
- Verify: `pnpm --filter @abm/crm typecheck` exits 0 and `pnpm --filter @abm/crm test` exits 0.

### Task 2.7 — Docs: ADR-012 and decision update
- Goal: the move from Lark to in-CRM chat is recorded.
- Target: `docs/adr/adr-012-internal-chat-in-crm.md` (new), `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`, `docs/decisions/business-decisions-v1.md`, `docs/README.md`.
- Steps:
  1. ADR-012 in Vietnamese, same headings as ADR-011 (`Trạng thái`, `Ngày`, `Bối cảnh`, `Quyết định`, `Phương án đã xét`, `Hệ quả`). Status `accepted`, date 2026-10-25. Content: user decision 2026-10-25 to put internal chat, tasks and agents in the CRM and drop Lark; D1 is the store; one `ChatHub` DO per organization with hibernating WebSockets relays events only; polling rejected (18 users × 5 s exceeds 100k requests/day); options considered: keep Lark, self-host Huly/Rocket.Chat/Mattermost, Lark as the platform. Link `plans/reports/brainstorm-261025-1447-internal-chat-task-repos.md`.
  2. ADR-001: append to the `Cập nhật:` line ", ADR-012 (Durable Object `ChatHub` cho chat nội bộ, ngoài phạm vi MVP3)".
  3. business-decisions-v1.md: change the row `| Chat nội bộ | Lark là nguồn, ... |` to `| Chat nội bộ | CRM là nguồn (ADR-012, 2026-10-25); GoClaw giữ session/memory, không phải nguồn nghiệp vụ |`.
  4. docs/README.md: add `[chat nội bộ trong CRM](adr/adr-012-internal-chat-in-crm.md)` to the ADR list.
- Verify: `Select-String -Path docs/decisions/business-decisions-v1.md -Pattern 'Chat nội bộ \| CRM là nguồn'` prints one match.

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
