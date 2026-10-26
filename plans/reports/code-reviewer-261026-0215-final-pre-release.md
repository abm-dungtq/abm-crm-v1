# Final pre-release review: internal chat, tasks, notifications, chat agents, Lark removal, MCP tokens

The supervisor condensed this from the code-reviewer's reply (the reviewer's rules forbid writing report files).

## Verdict
There are no Critical issues. The review fixed one High issue, with a regression test. `pnpm -r typecheck`, `pnpm -r test` (CRM: 674 passed, 2 skipped, after the supervisor's follow-ups) and `pnpm --filter @abm/crm build` all exit 0.

Migrations 0025–0030 apply cleanly to existing data. The reviewer checked this in an in-memory SQLite database with foreign keys on:
- Steps: apply 0001–0024, load `seed/demo.sql`, insert one script token, then apply 0025–0030 one transaction per file.
- The task count stays at 15.
- `foreign_key_check` returns 0 rows and `integrity_check` returns ok.
- The existing token becomes `scope='legacy'`, `created_via='script'`.

## High (fixed by the reviewer)
- **`issue-agent-tokens.mjs` revoked every live token the person had.** Running it in phase 07 step 7.5.3 would have revoked all self-service tokens and the LMS publish token. It now revokes only `label = 'goclaw' AND created_via = 'script'`. The regression test in `mcp-chat-tools.test.ts` runs the script's own UPDATE statement.

## Confirmed sound
- **Token secrecy:** only the sha256 hash is stored. The value is returned only by create and rotate, with `no-store`. Audit rows never contain it.
- **Expiry and revocation** are checked on both MCP and LMS publish. LMS publish also requires `scope='legacy'`.
- **Scope gating** is applied in both `toolsFor` and `callTool`. No tool posts to a group or direct chat.
- **`agent_readable`** is enforced by one SQL fragment for list, read and search.
- **The kill switch** blocks chat reads and `comment_task`.
- **D1 budget:** `list_conversations` uses 5 queries and `search_messages` uses 7.
- **`comment_task` is idempotent.**
- **Route order:**
  - `originGuard` and `requireActor` cover every new route.
  - `wrangler.jsonc` declares `CHAT_HUB` with `new_sqlite_classes`, contains no secrets and has no `LARK_*`.
  - The Lark grep (acceptance criterion 7) is clean.

## Medium
1. **The LMS publish token could read chat through MCP.** Supervisor fixed: `/api/mcp` now refuses tokens labelled `lms-publish` (test added).
2. **The GoClaw direct-chat assistant (legacy key) can read chat and still write leads.** This is a product decision for the advisor.
3. **The `/settings/agents` warning did not mention lead data.** Supervisor fixed.
4. **Parallel calls can get past the search rate limit.** The impact is cost only.
5. **The admin "bot token" count and revoke now include self-service tokens.** This is a product decision for the advisor.

## Low
- `get_task` returns comments from archived threads.
- Rotating an expired token works as a renewal.
- The guide wording on locks was imprecise. Supervisor fixed: the 15-minute login lock does not stop tokens.
- Approval outbox rows stay `pending`. This was already the case before this plan.
- Before step 7.6, confirm that Workers Logs do not keep Authorization headers.
- Search lower-cases only ASCII letters.

## Acceptance criteria still needing live checks in phase 07
- 1 and 2: Kanban drag and the next-action dialog (7.4.3).
- 3: the 2-second realtime update (7.4.1).
- 4: real push on a device (7.4.2).
- 5: a live handoff and the 21:00 summary (7.7).
- 6: real GoClaw (7.5).
- 7: deleting the Lark secrets (7.8).
- 8: real MCP clients (7.6).
- 9: rerun the gates (7.1).
