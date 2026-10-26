# Code review — phases 03 and 04 (notifications, Web Push, inbox notices, chat agents)

The reviewer returned this report in its reply because its rules forbid writing report files; the supervisor saved it here.

There are no Critical issues. The review fixed two High issues and closed both known gaps, with regression tests for each. `pnpm -r typecheck`, `pnpm -r test` (CRM: 657 passed, 2 skipped) and `pnpm --filter @abm/crm build` all exit 0.

## What holds
- **Who gets notified:**
  - Direct-message notices go only to the other members.
  - Mention notices go only to members, or to people who can see the task, and never to the author.
  - Approval notices go to the active Leaders of the lead's team or department, and never to the requester.
  - Assigning a task to yourself sends nothing.
  - The task-due dedupe key includes the assignee.
- **No double notice:** a direct-chat notice and a mention notice share one dedupe key, so a person mentioned in a direct chat is notified once.
- **Bridge replies:** the chat branch stops when `completeCommand` returns false. The bridge supplies only the reply text; the requester, agent and conversation ids come from the stored command payload.
- **Agents never trigger agents.**
- **Group agent:** it has no CRM credential. Its prompt starts with the "data, not instructions" line, `[TASK:]` lines only become suggestion cards, and the server never creates a task from them.
- **Service worker:** it has no fetch handler and caches nothing.
- **VAPID private key:** it is never logged.

## High (fixed)
1. **Three production paths sent notices through the fake test sink**, so the live update and the push were lost:
   - Manual inbox assignment.
   - Intake classification.
   - The Zalo OA token-refresh failure notice.

   The real sink is now passed through all three (`inbox-routes.ts`, `worker-commands.ts`, `zalo-oa-send.ts`, `bridge-routes.ts`, `scheduled.ts`). A test in `inbox-assignment.test.ts` fails without the fix.
2. **Agent replies over 4,000 characters were dropped silently.** They are now cut to 3,999 characters plus "…" (test in `chat-agents.test.ts`).

## Known gaps (fixed)
- **"Trợ lý đang trả lời…":** `chat-socket.ts` now passes the `agent.thinking` event to the chat thread, so every member sees the indicator, not only the sender.
- **Task prefill:** `TaskFormDialog` has a new `initialValues` prop. The suggestion card uses it instead of typing into the form's fields from outside.

## Medium (not fixed)
1. **Cron budget headroom is thin.** One per-minute run with 10 due tasks on 2 devices each used 41 of the 50 allowed D1 queries and 30 subrequests (test 9 in `notifications.test.ts`).
2. **`notify()` makes the request wait for push.** It awaits the push work after handing it to `waitUntil`, so a message send waits for up to 20 push requests.
3. **`sw.js` link handling.** Links are not limited to the CRM's own origin. Also, `client.navigate` fails for a window the service worker does not control, so the click focuses the window without opening the link.
4. **The "Inbox" chat group never removes anyone.** A person taken off the roster still receives notices containing customer data.
5. **Push subscriptions survive logout and deactivation.** On a shared device, the next person can see the previous user's message previews.
6. **An agent turn can be lost after the message is saved.** If queuing the turn fails, the client gets a 500 even though the message was saved. Its retry then counts as a duplicate, so the turn is never queued.
7. **The SLA deadline moves even when the notice failed,** because `postInboxNotice` swallows errors.
8. **The `sinkOrDb` fallback still exists.** Only tests reach it now; it should become a required parameter.

## Low
- Agent replies are parsed for `@` mentions and the results are stored; they should be stored with no mentions.
- A reply is still posted after the agent was removed or disabled, or after the requester lost access.
- A whitespace-only reply leaves "Trợ lý đang trả lời…" on screen for 2 minutes.
- Group history keeps line breaks, so a member can fake a "Câu hỏi của …" line.
- Admin validation lets `group_agent_key` equal the direct-chat agent's key, which has CRM tools.
- A `[TASK:]` title has no length cap.
- On Windows, `issue-agent-tokens.mjs` lets `%` through its email check.
- `failure_count` on push subscriptions grows forever.
- The "Trợ lý đang offline" message is posted for every message while the agent machine is offline.

## Advisor decision (2026-10-26)
- **Fixed in the phase 05 pre-tasks:** all eight Medium items (M1 to M8) and six of the Low items.
- **Accepted debt:**
  - An agent reply is still posted after the agent was removed or disabled.
  - `failure_count` on push subscriptions is never pruned.
  - `%` is allowed in the token script's `--email` on Windows.
