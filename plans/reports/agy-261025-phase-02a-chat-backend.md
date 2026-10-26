# Phase 02a Report — Chat Backend, ChatHub, Attachments, ADR (Tasks 2.1–2.5 and 2.7)

## Tasks Completed
- **Task 2.2 — ChatHub Durable Object and binding** (executed first per brief): Created `apps/crm/src/worker/chat-hub.ts` with `ChatHub` Durable Object using hibernating WebSockets (`setWebSocketAutoResponse('ping', 'pong')`, tagged sockets, `/connect`, `/broadcast`, `/online`, and safe `webSocketClose` handling for reserved codes `1005`/`1006`). Added `durable_objects` and `migrations` (`new_sqlite_classes: ["ChatHub"]`) to `apps/crm/wrangler.jsonc`, added `CHAT_HUB: DurableObjectNamespace` to `apps/crm/src/worker/env.ts`, and exported `ChatHub` from `apps/crm/src/worker/index.ts`.
- **Task 2.5 (step 2) — ChatHub WebSocket test** (executed immediately after 2.2 per brief): Created `apps/crm/test/chat-hub.test.ts` verifying WebSocket upgrade (`101`), tagged user delivery (`{ delivered: 1 }` and message receipt), and zero delivery to non-connected user tags (`{ delivered: 0 }`).
- **Task 2.1 — Migration 0026**: Created `apps/crm/migrations/0026_chat_attachments.sql` byte-for-byte from the phase file (`chat_attachment` table and `chat_attachment_message` index) and inserted `'chat_attachment'` directly before `'chat_message'` in `apps/crm/test/helpers/reset-db.ts`.
- **Task 2.3 — Chat store: access, list, publish, duplicate & parent validation**: Added `Sink` and `sinkFrom` to `apps/crm/src/worker/env.ts`; updated `apps/crm/src/worker/chat.ts` to export `loadConversation`, `memberIds`, `listConversations`, `unreadTotal`, `findOrCreateDirect`, and `publish`, included message attachments in `listMessages`, and updated `insertMessage` per supervisor override 4b (checking `meta.changes`, rejecting `parentMessageId` from another conversation with `VALIDATION_FAILED`, returning `duplicate: true` on idempotent retry by the same author in the same conversation, and returning `CONFLICT` when an existing message ID belongs to another conversation or author). Also updated `updateTask` in `apps/crm/src/worker/commands.ts` per supervisor override 4c to prune `chat_member` rows of `task:<taskId>` when `memberUserIds` or `assigneeUserId` changes.
- **Task 2.4 — Chat routes**: Created `apps/crm/src/worker/chat-routes.ts` mounted at `/chat` in `apps/crm/src/worker/index.ts` implementing `GET /socket` (with WebSocket Upgrade check and Origin validation), `GET /conversations`, `GET /unread`, `POST /conversations` (group and direct), `GET /conversations/:id`, `PATCH /conversations/:id` (`title` and `agentReadable`), `POST /conversations/:id/members`, `DELETE /conversations/:id/members/:userId`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `DELETE /messages/:id`, `POST /conversations/:id/read`, `POST /conversations/:id/attachments` (10 MB limit, MIME allowlist), and `GET /attachments/:id` (`X-Content-Type-Options: nosniff`, `inline` only for safe images, `attachment` for all other types). All socket events carry IDs only (`message.created`, `message.deleted`, `conversation.updated`, `read`) and skip publish on duplicate messages. Updated `POST /tasks/:id/comments` in `apps/crm/src/worker/index.ts` to publish `message.created` (with `messageId` only) when not duplicate.
- **Task 2.5 (rest) — Chat integration tests**: Created `apps/crm/test/chat.test.ts` with 8 tests covering group chat creation/unread/read/access, direct chat uniqueness, `agentReadable` toggle on direct vs group, duplicate ID same author (`duplicate: true`) vs cross-conversation ID (`CONFLICT`) vs cross-conversation `parentMessageId` (`VALIDATION_FAILED`), message deletion permissions, 11 MB attachment rejection (`413`) and `text/html` safe headers (`Content-Disposition: attachment...` + `X-Content-Type-Options: nosniff`), cross-origin WebSocket rejection (`403`), and `updateTask` pruning of `chat_member` rows on `task:<taskId>`.
- **Task 2.7 — Docs: ADR-012 and decision update**: Created `docs/adr/adr-012-internal-chat-in-crm.md`, updated `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`, updated `docs/decisions/business-decisions-v1.md` (QĐ9 table row for `Chat nội bộ`), and added ADR-012 to `docs/README.md`.

## Files Changed
- Created: `apps/crm/src/worker/chat-hub.ts`
- Created: `apps/crm/test/chat-hub.test.ts`
- Created: `apps/crm/migrations/0026_chat_attachments.sql`
- Created: `apps/crm/src/worker/chat-routes.ts`
- Created: `apps/crm/test/chat.test.ts`
- Created: `docs/adr/adr-012-internal-chat-in-crm.md`
- Modified: `apps/crm/wrangler.jsonc`
- Modified: `apps/crm/src/worker/env.ts`
- Modified: `apps/crm/src/worker/index.ts`
- Modified: `apps/crm/src/worker/chat.ts`
- Modified: `apps/crm/src/worker/commands.ts`
- Modified: `apps/crm/test/helpers/reset-db.ts`
- Modified: `docs/adr/adr-001-stack-cloudflare-modular-monolith.md`
- Modified: `docs/decisions/business-decisions-v1.md`
- Modified: `docs/README.md`

## Verification Commands & Results
1. **Task 2.2 Verify (Typecheck)**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
2. **Task 2.2 Verify (Task Engine Tests)**: `pnpm --filter @abm/crm test -- task-engine.test.ts`
   - Exit code: `0`
   - Key output: `✓ test/task-engine.test.ts (7 tests) 546ms`
3. **Task 2.5 Step 2 Verify (ChatHub DO Test)**: `pnpm --filter @abm/crm test -- chat-hub.test.ts`
   - Exit code: `0`
   - Key output: `✓ test/chat-hub.test.ts (1 test) 17ms`
4. **Task 2.1 Verify (Migration 0026)**: `pnpm --filter @abm/crm test -- task-engine.test.ts`
   - Exit code: `0`
   - Key output: `✓ test/task-engine.test.ts (7 tests) 549ms`
5. **Task 2.3 Verify (Chat Store Typecheck)**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
6. **Task 2.4 Verify (Chat Routes Typecheck)**: `pnpm --filter @abm/crm typecheck`
   - Exit code: `0`
   - Key output: `$ tsc -p tsconfig.worker.json --noEmit && tsc -p tsconfig.web.json --noEmit`
7. **Task 2.5 Verify (Chat & ChatHub Tests)**: `pnpm --filter @abm/crm test -- chat.test.ts chat-hub.test.ts`
   - Exit code: `0`
   - Key output: `Test Files 2 passed (2) | Tests 9 passed (9)`
8. **Task 2.7 Verify (Docs Pattern Check)**: `Select-String -Path docs/decisions/business-decisions-v1.md -Pattern 'Chat nội bộ \| CRM là nguồn'`
   - Exit code: `0`
   - Key output: `docs\decisions\business-decisions-v1.md:129:| Chat nội bộ | CRM là nguồn (ADR-012, 2026-10-25); GoClaw giữ session/memory, không phải nguồn nghiệp vụ |`
9. **Final Check — Workspace Typecheck**: `pnpm -r typecheck`
   - Exit code: `0`
   - Key output: `apps/crm typecheck: Done` (all workspace packages passed)
10. **Final Check — Workspace Tests**: `pnpm -r test`
    - Exit code: `0`
    - Key output: `apps/crm test: Test Files 53 passed | 1 skipped (54) | Tests 637 passed | 2 skipped (639)`

## Notes / Uncertainties
- None. Task 2.6 (web UI) was intentionally omitted per `brief-02a.md`.

Status: DONE
Summary: Implemented the Phase 02 chat backend, `ChatHub` Durable Object with hibernating WebSockets, attachment storage/serving in R2/D1, task member pruning on `task:<taskId>`, ADR-012 documentation, and integration tests (`chat-hub.test.ts` and `chat.test.ts`). Both `pnpm -r typecheck` and `pnpm -r test` pass with exit code 0.
Concerns/Blockers: none
