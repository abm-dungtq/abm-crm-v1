# Code review: Zalo OA pre-cutover (phase 4 fixes, phase 5 bridge images, GoClaw latency fix, phase 6 UI)

Date: 2026-10-14. Reviewer: code-reviewer (Opus). Review only; no source edits.

## Scope

- Phase 4 fixes: `apps/crm/src/worker/inbox/zalo-oa-webhook.ts`, `zalo-oa-send.ts`, `zalo-oa-oauth.ts`, `intake.ts`, `apps/crm/test/inbox-zalo-oa.test.ts`.
- Phase 5: `apps/zalo-bridge/src/image-fetch.ts`, `command-runner.ts`, `goclaw-client.ts`, `main.ts`, `.gitignore`.
- Latency fix: `apps/zalo-bridge/src/goclaw-client.ts` (+ `GatewayConnection` in `goclaw-session-cleanup.ts`).
- Phase 6: `apps/crm/src/web/pages/channel-accounts.tsx`, `inbox-format.ts`, `api.ts`, `types.ts`, `components/inbox-thread.tsx`, `pages/inbox.tsx`; server side `inbox-routes.ts:64-70, 400-428`.
- Checks run here (PowerShell): `pnpm -F @abm/crm typecheck` exit 0; `pnpm -F @abm/zalo-bridge typecheck` exit 0; `pnpm -F @abm/crm test` 508 passed / 2 skipped; `pnpm -F @abm/zalo-bridge test` 95 passed.

## Verdict

The C2, C4, M1 and M2 fixes are correct, and so are the bridge image path, the latency fix and the UI. The new echo classifier in `zalo-oa-webhook.ts` has two defects that will show up in normal traffic. One flips bot conversations to `human`. The other swallows staff messages and can mark an unsent bot reply as `sent`. Fix both before cutover. Both fixes are small and local.

---

## Must fix before cutover

### H1. An echo of a retried send is read as staff, so the conversation flips to `human` (High)

Where: `zalo-oa-webhook.ts:162-167`. The 120 s window is anchored on `message.created_at`, which is when the pending row was inserted, not when it was sent.

Scenario: the first `send_zalo_oa` attempt fails with a retryable error (`ZALO_HTTP_5xx`, `ZALO_OA_NETWORK`, `ZALO_OA_REFRESH_FAILED`, `ACCOUNT_PAUSED`). `failCommand` sets `next_run_at = now + 2^attempts min` (`dispatcher.ts:140`), so the retry runs at +2 min or later. A lease re-run after 300 s behaves the same way. The retry succeeds and Zalo echoes it. `messageExists` misses, because the id is not stored yet or the echo races `markMessageSent`. `linkOwnSend` misses, because `created_at` is older than 120 s. `isAutoReply` misses, because the customer message is older than 15 s. The echo goes to `ingest.ts:170-187`: a duplicate `staff_phone` row, `mode='human'`, and the bot stops for that customer. Staff `staff_web` replies retried the same way get a duplicate row.

Fix: anchor the window on send activity, not on insert time. For example, match rows whose send command was active recently:
```sql
... AND (m.created_at >= ?since OR m.id IN (
  SELECT json_extract(payload_json, '$.messageId') FROM channel_command
  WHERE kind = 'send_zalo_oa' AND conversation_id = ?conv AND updated_at >= ?since))
```
`recordProgress`, `completeCommand` and `failCommand` all bump `updated_at`. Add a test: the first attempt gets a 500, the clock moves 3 min, the retry succeeds and its echo is delivered inside the mocked fetch. Expect `mode='ai'` and no `staff_phone` row.

### H2. The "contains" rule swallows short staff replies and can mark an unsent bot reply as sent (High)

Where: `zalo-oa-webhook.ts:159-172`. The match is `instr(normalized body, echo) > 0` with no minimum length and no part boundary. On a match it calls `markMessageSent`, which sets `status='sent'` and fills `external_msg_id` (`conversation-flow.ts:116-120`).

Scenarios:
1. **A staff reply is lost.** The bot answered "Dạ, học phí khoá … ạ". Within 2 min, staff type "Dạ" (or "ạ", "anh", "ok"…) in the OA app. `instr` finds it, so the reply is classified as our own send. It is not stored, `mode` stays `ai`, there is no staff context, and the bot keeps answering over the human. Vietnamese bot replies contain these tokens almost every time.
2. **A bot reply is never delivered but shows `sent`.** The bot reply is still `pending`: queued, in the 2-min retry backoff, or the account is `send_paused`. A staff echo whose text is inside it marks the reply `sent` and gives it the staff `msg_id`. When the command is claimed, `zalo-oa-send.ts:126-129` sees `status='sent'` with no progress and calls `completeCommand(... { sent: true })` without posting anything. The customer never gets the reply, and the CRM shows it as sent, carrying a receipt id that belongs to the staff message.

Fix (both parts):
- Match exactly against parts, not by substring. Fetch the few candidate rows (same filters, `LIMIT 5`), run `splitZaloOaText(body)` in JS, and compare `normalizeEchoText(part) === normalizeEchoText(echo)`. This is exact for every part of a multi-part reply and rejects "Dạ". Keep the whole-body equality for single-part messages.
- On a match, do not change `status`. Only fill `external_msg_id` when it is NULL, so the send loop stays the only writer of `sent`. Matching alone is enough to drop the echo. Marking it sent closes no race that the match does not already close.
- Tests to add: (a) a bot reply is sent, then a staff echo "Dạ" 30 s later, expecting a `staff_phone` row and `mode='human'`; (b) a pending bot reply plus a staff echo of a substring, expecting the send command to still post to `/message/cs`.

---

## Should fix (soon after cutover, or before if cheap)

### M1. An echo marks the message `sent` before the send loop finishes (Medium; same root cause as H2, fixed by H2's second bullet)

`zalo-oa-send.ts:148-180` together with `linkOwnSend`. Part 1's echo flips the row to `sent` while the loop is still running.
- If part 2 then gets an outside-window code, `markFailed` (`:70-71`, `WHERE status='pending'`) does nothing. The thread shows the reply as `sent` next to a "Quá thời hạn…" note. The same happens when part 2 exhausts retries (`failSend`, `:73-76`).
- Worse: Zalo accepts part 1 but our `fetch` throws (connection reset, `ZALO_OA_NETWORK`) before `recordProgress`. The echo marks the row `sent`. On retry `progress` is null, so `unsentParts=false` and `:127-129` completes the command. Parts 2..n are never sent, and nothing records it.

### M2. 503 does not recover a failure that happens after the message insert (Medium)

`ingest.ts:170-198`: the insert, the conversation update and `scheduleCompletion` are separate statements. If the update batch or `scheduleCompletion` throws, the route answers 503 (`zalo-oa-webhook.ts:346-351`). Zalo redelivers, the insert hits `ON CONFLICT DO NOTHING`, and `:178` returns early. No completion and no SLA are ever scheduled, so the customer gets no answer. The test at `inbox-zalo-oa.test.ts:634` only injects the failure into the insert itself. The same shape exists for Facebook and personal Zalo, but the OA route now advertises redelivery as the recovery path.

Fix: when the insert conflicts on an inbound `ai`-mode message, check whether a `run_completion` for that message exists and schedule it if not. Alternatively, put the conversation update and the completion enqueue in the same `db.batch` as the insert.

### M3. The auto-reply rule misfires on event ordering and on fast staff (Medium, depends on the OA configuration)

`zalo-oa-webhook.ts:179-193`.
1. Zalo delivers `user_send_text` and the auto-reply `oa_send_text` as separate POSTs. If the echo is processed first, for a returning customer, the "latest customer message" is an old one. The echo goes down the staff path and sets `human`, and the customer message that arrives next gets no bot reply.
2. A staff member who answers in the OA app within 15 s is stored as `system`. The mode stays `ai` and the bot also answers.

This only matters if the ABM OA has an auto-reply or welcome message enabled. That is still unanswered from the previous review. If the auto-reply is on, consider matching it by text against the configured auto-reply instead of by timing. Otherwise, turn it off at cutover and record that in phase 9.

### M4. HTTP text retry: confirm that GoClaw cancels a run when the client disconnects, and that 25 s fits real turns (Medium, verify)

`goclaw-client.ts:14-17, 21, 85-100`. The empirical check covered WebSocket `chat.abort`. The HTTP path only aborts the client `fetch`. If GoClaw keeps running the turn after the disconnect:
- the session gets the question twice and possibly two assistant turns;
- or the retry queues behind the stalled run on the same session, hits its own 90 s timeout, and the whole command fails after about 115 s.

Also, 25 s was chosen from "normally 10 s". With the sale-tu-van v8 knowledge tools, check the actual p95 in the GoClaw logs. If tool turns often exceed 25 s, each one is aborted and paid for twice.

Fix: run one manual check (an HTTP turn with a 3 s client timeout, then list the session messages), or route text turns through WS `chat.send` + `chat.abort` like media.

### M5. The final OA error codes are still unverified (Medium, carried over)

`zalo-oa-send.ts:17`: `-213, -217, -227, -230, -232`. The raw code is now stored and staff see a note, which is good. A wrong entry still fails a retryable reply for good. Verify them against developers.zalo.me before relying on them.

---

## Low

- **L1. Temp images stay for up to 24 h, and the first sweep runs only after 1 h.** `main.ts` `imageTimer` has no startup run. A bridge that restarts more often than hourly never sweeps. Customer receipts (personal data) sit on disk. Unlink the files after `completeWithMedia` returns, once you confirm that GoClaw copies the media and does not re-read the path in later turns. Also call `cleanupOldImages` once at startup.
- **L2. `redirect: 'error'`** (`image-fetch.ts:85`). If Zalo's CDN answers with a redirect (even zdn → zdn), every image fails as `[Ảnh không tải được]`. Check one real `user_send_image` URL before cutover. The downloads are also sequential: worst case 3 × 15 s.
- **L3. A WS socket close during `chat.send` is not aborted.** `goclaw-client.ts:143-149` aborts only on timeout. `GOCLAW_WS_CLOSED` maps to `GOCLAW_NETWORK`, goes back to the Worker, and the Worker's retry may start a second run while the first is still alive server-side.
- **L4. The registration-policy checkbox shows "on" after a rejected enable.** `channel-accounts.tsx:452-466`. Turning the policy on with an empty link gets a 422, but `enabled` stays `true` and `dirty` stays `true`, so the server value (off) never syncs back. An admin can believe the policy is on. In `onError`, reset `enabled` to `account.registrationPolicy` and clear `dirty`.
- **L5. `refreshWasSuperseded` can throw out of the `catch`** (`zalo-oa-oauth.ts:312`) on a D1 error, so `refreshZaloOaAccount` throws instead of returning `failed`. The callers handle that as a command or cron error, so this is cosmetic.
- **L6. The connect redirect** (`channel-accounts.tsx:391`) navigates to whatever `url` the admin-only API returns. That is acceptable, because the URL is built server-side. Optionally assert `url.startsWith('https://oauth.zaloapp.com/')`.

---

## Checked and fine

- **C2 (lead source).** `intake.ts` maps `zalo_oa` to `zalo` only for the `source`, and labels the note "Zalo OA". There is a test. `zalo_uid` for the contact point (M6 of the previous review) is still open, as stated.
- **C4 (stale refresh).** The version is re-read only on the failure path. A null `startedVersion` gives `failed`, as it should. Callers treat only `failed` as a failure. A reconnect through `saveCredential` also bumps the version, so a refresh racing a reconnect is correctly `stale`.
- **The 503 path.** The signature check runs before processing. Events are idempotent by `msg_id` (`messageExists`, `ON CONFLICT`, `COALESCE` receipts). Error logs carry only the message, not the body.
- **`oa_send_*` without a conversation** is ignored (M3 of the previous review fixed).
- **Final send.** The stored error is `ZALO_OA_OUTSIDE_WINDOW:<code>`. The note is inserted only when `failCommand` still owns the claim. No consumer string-matches the old bare constant.
- **SSRF** (`image-fetch.ts:16-28`). Only `https`, no userinfo, port empty or 443, host `zdn.vn` / `*.zdn.vn` with the trailing dot stripped, no redirects. The Worker pre-filters to zdn too (`conversation-flow.ts:140-162`). Only Zalo controls the DNS.
- **Size and time limits.** A declared `content-length` over 10 MiB is rejected. The streaming cap stops at 10 MiB and the reader is cancelled. `AbortSignal.timeout(15 s)` also covers the body read. Images are recognised by magic bytes only. Names are `randomUUID()`, so no attacker-controlled path component exists. `join` with `fileURLToPath` is correct on Windows. The sweep uses `lstat`, skips non-files, and one locked file does not stop it. `media-tmp/` is now in `.gitignore`.
- **Retry logic.** `withRetry` retries only `GOCLAW_TIMEOUT`. WS `GOCLAW_WS_TIMEOUT` maps to `GOCLAW_TIMEOUT`, so `chat.abort` is sent before the retry, on the same socket, with its own 5 s budget. A deadline that passes before `chat.send` throws in `remaining()` before any run starts, so there is nothing to abort. Each attempt opens a fresh socket and closes it in `finally`.
- **Lease budget (300 s).** Text: 25 + 90 = 115 s, plus at most 5 s for the profile lookup on personal Zalo. Media: up to 45 s of downloads + (45 + 5 abort) + (90 + 5 abort) = 190 s. Both stay under 300 s. A command queued behind the same conversation can outlive its lease. `CommandRunner.dispatch` absorbs the re-claim through `inFlight`, so it does not run twice.
- **UI gating.** The page returns early for non-admins. The OA section and the policy form also check `isAdmin`. The server enforces `adminOnly` on both `/channel-accounts/zalo-oa/connect` and `/accounts/:id/registration-policy`. The route refuses non-OA accounts and validates the same `^https://zalo\.me/g/[A-Za-z0-9]+$` with zod (`inbox-routes.ts:64-70`). The `?zalo_oa=` toast accepts only `connected` / `error` and cleans the URL. Personal-Zalo rows exclude OA, so the OA never gets a QR login.

## Test gaps

- No test for a short staff echo within 120 s of a bot reply (H2-1).
- No test for a pending bot reply plus a substring echo (H2-2).
- No test for a retried send whose echo arrives more than 120 s after insert (H1).
- No test for a part-2 failure after part 1 was echoed (M1).
- No test for a 503 after a successful insert (M2).

## Plan follow-ups

- Phase 4 fixes: C2, C4, M1, M2 done. C1 is only partially done: the H1 and H2 regressions were introduced by the fix.
- Phase 5: done. L1 and L2 still need a live check.
- Phase 6: done (L4 is polish).
- Before phase 9: decide on the OA auto-reply (M3) and run the HTTP abort check (M4).

## Unresolved questions

1. Is an OA auto-reply or welcome message enabled on the ABM OA? This decides M3.
2. Does GoClaw cancel an HTTP `/chat/completions` run when the client disconnects? What is the real p95 turn time for `tu-van-oa` / sale-tu-van?
3. Does GoClaw copy `chat.send` media into its own storage, so the temp file can be deleted right after the turn?
4. Do real `user_send_image` URLs from Zalo redirect?

Status: DONE_WITH_CONCERNS
Summary: Bridge images, the latency fix, the UI and most phase 4 fixes are correct, and all suites and typechecks are green. The new echo classifier has two High regressions to fix before cutover: a retried send's echo flips the conversation to `human` (H1), and short staff replies are swallowed, which can also mark an unsent bot reply as sent (H2).
