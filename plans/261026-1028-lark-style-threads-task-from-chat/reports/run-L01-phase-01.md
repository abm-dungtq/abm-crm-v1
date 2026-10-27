# Run L01: phase 01, data model and quote reply (backend)

## Outcome
Every task of phase 01 (1.1 to 1.4) is done. Migration 0031 applies from scratch in the test D1. In the API, "Trả lời" is now a quote reply: it stays in the main flow and comes back with a quote preview. Old `parentMessageId` input is still accepted as an alias. The new `GET /api/chat/messages/:id/context` endpoint works. No source file reads `parent_message_id` any more. All acceptance gates exit 0.

## Files
Created:
- `apps/crm/migrations/0031_lark_threads_groups.sql`. It was copied from the phase file, and a scripted comparison of the phase's sql block against the file (CRLF normalised) printed `equal: True`.

Modified:
- `apps/crm/test/helpers/reset-db.ts`: `'chat_thread_follower', 'chat_thread'` added before `'chat_agent_member'`.
- `apps/crm/src/worker/chat.ts`:
  - New `ChatMessageItem` fields: `replyToMessageId`, `replyTo`, `threadRootId`, `alsoInMain`. New exported types `ChatQuotePreview` and `ChatMessageContext`.
  - `InsertMessageInput.replyToMessageId` replaces the old field. The insert guard now also requires that the quoted message has not been recalled (`deleted_at IS NULL`).
  - `listMessages` shows the main flow only, accepts `after`, and adds the quote preview through joins, still in a single query.
  - New `messageContext` function.
  - The unread counts in `listConversations`, `unreadTotal` and `agentVisibleConversations` now count main-flow messages only.
  - `postTaskComment` input field renamed.
  - In `AGENT_MESSAGE_SELECT`/`toAgentMessage`, `parent_id` is now `reply_to_message_id ?? thread_root_id`.
  - Small private helper `authorNameOrDefault`, shared by message authors, quote authors and agent messages.
- `apps/crm/src/worker/chat-routes.ts`: the POST messages route reads `replyToMessageId ?? parentMessageId` and type-checks it. New `GET /messages/:id/context` route, which returns 404 `notFound` when the result is null.
- `apps/crm/src/worker/index.ts`: in the task comment POST, `replyToMessageId ?? parentMessageId` is used.
- `apps/crm/src/worker/chat-agents.ts`:
  - `ChatCompletionPayload.replyToMessageId` replaces the old field.
  - A group or task turn quotes the question; a direct agent chat sends `null`.
  - The history query now takes the last 20 main-flow messages and has two binds.
  - Reply, offline and failure notices use `replyToMessageId`.
- `apps/crm/src/worker/notify.ts`: `'chat_thread'` added to `NotificationKind`.
- `apps/crm/test/chat.test.ts`: new describe block "quote replies and message context" with 7 tests, covering phase steps 1.4.1 to 1.4.7.
- `apps/crm/test/chat-agents.test.ts`: added assertions that the DM payload has `replyToMessageId: null`, the group payload has `replyToMessageId` equal to the question id, and the stored agent reply has `reply_to_message_id` equal to the question id (step 1.4.8).

Not modified: `apps/crm/test/mcp-chat-tools.test.ts`. Its only reply assertion is `parent_id: null` on a top-level message, and that is still correct.

## Verify results
| Step | Command | Result |
|------|---------|--------|
| 1.1 | `pnpm --filter @abm/crm test -- inbox-schema.test.ts chat.test.ts` | exit 0, 2 files, 17 tests passed |
| 1.2 | `pnpm --filter @abm/crm typecheck` | exit 1 at that point (see deviation 1), exit 0 after 1.3 |
| 1.3 | `pnpm --filter @abm/crm typecheck` | exit 0 |
| 1.3 | `Get-ChildItem apps/crm/src -Recurse -Include *.ts,*.tsx \| Select-String 'parent_message_id'` | prints nothing |
| 1.4 | `pnpm --filter @abm/crm test -- chat.test.ts chat-agents.test.ts mcp-chat-tools.test.ts` | exit 0, 3 files, 47 tests passed |
| Gate | `pnpm -r typecheck` | exit 0 |
| Gate | `pnpm --filter @abm/crm test` | exit 0, 56 files passed and 1 skipped; 681 tests passed and 2 skipped |
| Gate | `pnpm --filter @abm/crm build` | exit 0 (`✓ built`; the usual chunk-size warning only) |

## Deviations and why
1. **Typecheck after Task 1.2.** The phase lists a typecheck as the Verify step for 1.2. At that point it failed with 8 errors, all of them `parentMessageId` references in `chat-agents.ts`, `chat-routes.ts` and `index.ts`. Those are exactly the callers that Task 1.3 is meant to update, so removing the field in 1.2 makes this failure unavoidable. I treated it as a sequencing artifact of the plan, not a defect, and went on to 1.3, after which typecheck exited 0. I made no workaround and touched no out-of-scope file.
2. **`messageContext` query count.** It looks up the anchor (including the thread root's `created_at`, through a self LEFT JOIN) in one query, then calls `loadConversation`. Then it runs two `listMessages` calls, each making its own attachment query.
3. **Context test inserts rows directly.** Phase step 1.4.5 says to "post 60 messages". The test instead inserts the 60 rows with `db.batch`, one minute apart. Messages posted through the API can share the same millisecond, which would make the window assertion flaky. The endpoint itself is still exercised through HTTP. The test asserts the exact window: 9 older messages, the anchor and 25 newer ones, newest first.
4. **Existing test 4 in `chat.test.ts` was left unchanged.** It still posts with `parentMessageId` and expects 422 for a cross-conversation quote. It passes through the alias, so it now also covers the backward-compatible name.

## Things I was unsure about
- **An agent answer to a recalled question is dropped.** Because the insert guard now rejects a recalled quoted message (as the phase requires), recalling the question while the agent is still working means the agent's answer is not stored. The failure notice, which also quotes the question, is not stored either, so the "Trợ lý đang trả lời…" indicator would not be cleared by a message. This is a rare edge case and the phase text asks for this guard, so I left it as is. Opus may want phase 02 or 05 to fall back to an unquoted insert in that case.
- **Insert responses have no preview.** The item returned by `insertMessage` has `replyTo: null`, the same way `authorName` is null today. Only the GET endpoints fill in the preview. The web client (phase 06) should rely on the list or refetch for the preview.

Status: DONE_WITH_CONCERNS
Summary: Phase 01 is complete and every acceptance gate exits 0 (typecheck, full test suite with 681 passing, build). The migration was copied exactly, quote replies and the context endpoint work, and no source file reads parent_message_id.
Concerns/Blockers: The Task 1.2 typecheck could not pass until Task 1.3 updated the callers (a plan sequencing artifact). With the new recalled-message guard, an agent answer to a question recalled mid-turn is dropped.
