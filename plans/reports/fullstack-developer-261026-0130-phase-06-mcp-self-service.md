# Phase 06 report: self-service MCP tokens and chat/task tools

Plan: `plans/261025-1500-internal-chat-tasks-agents/` (phase 06, tasks 6.1–6.7). Date: 2026-10-26.

A Claude fullstack-developer subagent did this run instead of Agy, because Agy's quota ran out. No subagents were spawned. I ran no git command that changes the index or working tree, deployed nothing, used no `--remote`, and started no background server. No token value was printed, logged or written anywhere.

## Outcome

Tasks 6.1–6.7 are done. The final checks `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter @abm/crm build` all exit 0. There is one security concern outside my file list (the LMS publish route; see Concerns), and two small deliberate deviations, which are listed below.

## Files changed

Created:
- `apps/crm/migrations/0030_agent_token_scope.sql`. I copied it byte for byte from the phase file and checked it with `diff` against the extracted block.
- `apps/crm/src/worker/agent-token-routes.ts`: `GET /`, `POST /`, `POST /:id/rotate` and `DELETE /:id`.
- `apps/crm/src/web/pages/agent-connect.tsx`: the `/settings/agents` page, with `CLIENT_SNIPPETS` as one constant.
- `apps/crm/test/mcp-chat-tools.test.ts`: 15 tests.
- `docs/guides/connect-ai-agents.md`.

Modified (targeted edits only):
- `apps/crm/src/worker/env.ts`: `TokenScope` type, plus the `tokenScope` and `tokenId` context variables.
- `apps/crm/src/worker/mcp-routes.ts`:
  - The token lookup now selects `scope` and rejects expired tokens with `expires_at IS NULL OR expires_at > now`. The 401 body is the same as before.
  - It sets the scope and token id, and passes a `ToolContext` that includes a `Sink`.
- `apps/crm/src/worker/mcp-tools.ts`:
  - 7 new tools and the scope gating (`scopeAllows`).
  - `toolsFor(actor, scope)` and `callTool(ctx, name, args)`.
  - The kill-switch check, read audit, search rate limit and `comment_task` id derivation.
- `apps/crm/src/worker/chat.ts`:
  - New functions: `agentVisibleConversationSql`, `agentVisibleConversations`, `agentCanReadConversation`, `agentMessages` and `agentSearchMessages`.
  - `postTaskComment`, which holds the task-comment flow moved out of `index.ts`: ensure the thread, filter mentions, insert, add members, publish, notify.
- `apps/crm/src/worker/index.ts`:
  - `POST /tasks/:id/comments` now calls `postTaskComment`.
  - Mounted `/agent-tokens`.
  - Removed the imports that became unused after the move.
- `apps/crm/src/web/router.tsx`: the `/settings/agents` route.
- `apps/crm/src/web/components/layout.tsx`: a "Kết nối agent" item in the account menu, right above "Đổi mật khẩu".
- `apps/crm/test/mcp-gateway.test.ts`: the two tool-list expectations now list the new tools exactly. They were extended, not loosened.
- `docs/security/permission-matrix-v1.md`: new section "Token MCP".
- `docs/adr/adr-012-internal-chat-in-crm.md`: new section "Agent bên ngoài qua MCP".
- `docs/README.md`: link to the new guide.

## Verify commands

| Step | Command | Exit | Key output |
| --- | --- | --- | --- |
| 6.1 | `pnpm --filter @abm/crm test -- mcp-gateway.test.ts` | 0 | 27 passed |
| 6.2/6.3 | `pnpm --filter @abm/crm typecheck` | 0 | clean |
| 6.4 | `pnpm --filter @abm/crm typecheck` | 0 | clean |
| 6.5 | `pnpm --filter @abm/crm test -- mcp-chat-tools.test.ts mcp-gateway.test.ts` | 0 | 2 files, 42 passed |
| 6.6 | `pnpm --filter @abm/crm typecheck` | 0 | clean |
| 6.7 | `Test-Path docs/guides/connect-ai-agents.md` | 0 | `True` |
| Final | `pnpm -r typecheck` | 0 | all 5 packages Done |
| Final | `pnpm -r test` | 0 | crm 56 files passed, 1 skipped; 671 tests passed, 2 skipped. lms-core 12, zalo-bridge 114, goclaw-identity 8, d1-guard 8, lms 17 |
| Final | `pnpm --filter @abm/crm build` | 0 | `✓ built` (only the existing chunk-size warning) |

The first 6.5 run failed on one assertion of mine: the test env sets `APP_URL`, so `mcpUrl` correctly used it. I fixed the expectation to `(APP_URL || origin) + '/api/mcp'`; the code did not change. After the last edit, which only wraps the segmented controls so they scroll sideways at phone width, I re-ran `pnpm --filter @abm/crm typecheck` and `build`, and both exit 0.

## Measured D1 counts

These come from the test "list_conversations over 30 conversations and search_messages each stay within 10 D1 queries". It counts the whole `/api/mcp` request, gateway included, and each `db.batch` counts as 1.

| Call | Queries | Limit | Breakdown |
| --- | --- | --- | --- |
| `list_conversations` (30 groups, 1 unread each) | 5 | 10 | token lookup, actor, `last_used_at` update, kill switch, one list query (visibility subquery plus per-row unread subquery) |
| `search_messages` (20 hits) | 7 | 10 | token lookup, actor, `last_used_at`, kill switch, rate-limit count, one search query (visibility as subquery), audit insert |

## `comment_task` idempotency design

The message id is `mcp:` followed by the first 40 hex characters of a SHA-256. It is deterministic, so a retry hits the `chat_message` primary key, and `insertMessage` returns the existing row with `duplicate: true`. A duplicate does not publish or notify a second time.

- **With a client `request_id`** (optional, 1–100 characters): the hash covers `tokenId`, `taskId` and `request_id`. This is the exact form: the same request id never duplicates, at any time.
- **Without `request_id`**, which is what most agents will send: the hash covers `tokenId`, `taskId`, the trimmed body and the minute bucket `floor(now / 60s)`. Before inserting, one query checks whether the id for the previous minute exists, and reuses it if so. A retry that crosses a minute boundary is therefore still caught. The same words posted again after about 1–2 minutes become a new comment, which is the intended behaviour for a deliberate repeat.

I chose this because MCP clients do not send idempotency keys. The fallback covers ordinary network retries, and `request_id` gives exactness to clients that want it. The token id goes into the hash, not the id, so neither the token nor its id appears in the message id; a test checks this. The comment goes through the same `postTaskComment` helper as the web route, which means the same `filterMentions`, `addConversationMembers`, `publish` and `notify` calls. It runs only after `canSeeTask` and the kill-switch check, and it stores `meta_json = {"via":"mcp"}`.

## Supervisor notes

- **a. Token secrecy.** The token value appears only in the POST and rotate responses, and both send `Cache-Control: no-store`. D1 stores only `sha256(token)`. Audit rows hold label, scope and expiry, never the value. Tests keep tokens in memory and assert that neither the audit rows nor `GET /agent-tokens` contains them. The web page keeps the token in component state only (plain `api.post`, not `useMutation` and not `useQuery`) and clears it when the dialog closes.
- **b. No chat writes.** No tool posts to a group or direct chat. A test checks that the `read_tasks` tool list is exactly the read set plus the 4 task writes.
- **d. D1 budget.** See the table above.
- **e. Kill switch.** It is read with `SELECT (${AGENT_WRITES_OPEN})`, the same constant `commands.ts` uses. It blocks `list_conversations`, `read_messages`, `search_messages`, `get_task` and `comment_task`. The task commands are already blocked by `runCommand`. When it blocks, no audit row is written, and a test checks this.
- **f. Legacy tokens.** Script tokens default to `scope = 'legacy'` and keep every tool their role allows, plus the new tools. The gateway expectations now list all 18 names in order for a sale.
- **g. Self-service limits.**
  - At most 5 active self tokens. The insert is conditional, so a concurrent request cannot exceed the limit.
  - Expired tokens do not count, and a test checks this.
  - Disabled users get 401 on both MCP and token creation, and a test checks this.
  - Users locked after failed logins get 403 on create and rotate.
- **h. Agent connect page.**
  - It lives at `/settings/agents` and is linked in the account menu next to "Đổi mật khẩu".
  - It has the list (label, quyền, tạo lúc, dùng lần cuối, hết hạn) with "Xoay token" and "Thu hồi", the create form, and the token shown once with "Sao chép".
  - Three client tabs come from `CLIENT_SNIPPETS`, and the warning text is shown.
  - It uses the responsive table, wrapping `pre` blocks and scrollable segmented controls for phone width.

## Deviations and decisions

1. **`my_tasks` and `complete_task` roles were widened to every role.** Before, they were staff only. The phase lists `my_tasks` under "roles: every role" and says it should return internal tasks. A `read_tasks` token for an academic, teacher or accountant would otherwise get create, update and comment but not complete. The contracts already allow `completeTask` for every role. The accountant expectation in `mcp-gateway.test.ts` now lists these tools exactly.
2. **The tools take emails, not user ids.** `create_task` and `update_task` take `assignee_email` and `member_emails`, matching the existing `assign_lead` tool, because agents have no directory tool. `create_task` defaults to an internal task assigned to the caller.
3. **The search rate-limit error uses code `VALIDATION_FAILED`.** The message is exactly "Tìm quá nhiều lần, thử lại sau ít phút". `ERROR_CODES` lives in `packages/contracts`, which is outside my file list.

## Concerns

1. **Self-service tokens can call the LMS publish API.** This is a security issue outside my file list. `apps/crm/src/worker/lms-publish-routes.ts` (around line 71) accepts any non-revoked `agent_token` for an `academic` or `admin` user. It does not check `scope` or `expires_at`. As a result:
   - an academic or admin user's self-created `read` token can publish LMS content, which contradicts "read only";
   - an expired self token still works there.

   The fix is one line: `AND scope = 'legacy' AND (expires_at IS NULL OR expires_at > ?)`. I did not touch that file. Please assign it before phase 07 deploys.
2. **A temporary login lock does not stop existing tokens.** Note g says existing tokens "already fail at actor resolution". That is true for disabled users, and a test checks it. It is not true for a temporary login lockout (`locked_until`): `loadAgentActor` checks only `status = 'active'`, so existing tokens keep working during the 15-minute brute-force lock. I left this as it is, because cutting agent access whenever someone mistypes a password would let anyone who knows an email lock that person's agents. Admin "Khóa" sets `status = 'disabled'` and revokes tokens through `admin-routes.ts`, so a real suspension is covered.
3. **Admin page text is now inaccurate.** `apps/crm/src/web/pages/admin-users.tsx` says "Bot vẫn đọc được dữ liệu" next to the kill switch. Chat reads are now blocked by the switch, so that text is partly wrong. The file is outside my list.
4. **`search_messages` uses SQLite `lower()`, which folds only ASCII.** "ABC" matches "abc", but an upper-case Vietnamese vowel with a diacritic ("Á") does not match "á". This is the `instr(lower(), lower())` approach the phase specified.

Status: DONE_WITH_CONCERNS
Summary: Tasks 6.1–6.7 are done and all final checks exit 0; list_conversations uses 5 and search_messages 7 D1 queries per request. One security gap remains outside my file list: self-service read tokens still work on the LMS publish API.
Concerns/Blockers: Add the scope and expiry checks to `lms-publish-routes.ts` before phase 07; decide whether a temporary login lock should also block tokens (I left it off); update the kill-switch text in `admin-users.tsx`.
