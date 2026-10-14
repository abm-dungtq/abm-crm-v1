# Phase 4: Worker Zalo OA channel

Executor: Grok via Paseo. Supervisor: Opus. Phase 3 must be done (`zalo_oa`, `send_zalo_oa` and the OAuth tables exist).

**Rule: mirror the Facebook channel.**
- `apps/crm/src/worker/inbox/facebook-webhook.ts` is the model for receiving.
- `apps/crm/src/worker/inbox/facebook-send.ts` is the model for sending.

Port Zalo specifics from the old app (read only). Take `src/` from the **live VPS copy** at `C:\Users\ABM\AppData\Local\Temp\webapp-chatbot-vps-src`, which is newer than the GitHub clone (`agent-recovery.ts` differs). Take `tests/` from the clone at `C:\Users\ABM\AppData\Local\Temp\webapp-chatbot-src`, and check that the tests still match the live guard:

| What | Old source |
| --- | --- |
| Webhook signature | `src/routes/webhooks.ts`: `sha256Hex`, and lines 182–215. The formula is `SHA256(app_id + raw_body + timestamp + secret)`, compared with header `X-ZEvent-Signature`. `app_id` and `timestamp` come from the first event |
| Event shapes | `src/routes/webhooks.ts`: `ZaloEvent`, `zaloEvents()`, `describeZaloAttachment()`, `handleZaloEvent()`, `handleZaloOaSend()`, `recordZaloReceipt()` |
| Send | `src/lib/channels.ts`: about lines 84–100, `POST https://openapi.zalo.me/v3.0/oa/message/cs`. Header `access_token`. Body `{recipient:{user_id}, message:{text}}`. Error when `payload.error !== 0` |
| OAuth v4 PKCE | `src/lib/zalo-connect.ts`: `randomCodeVerifier`, `codeChallenge`, `buildPermissionUrl`, `exchangeCodeForTokens`, `refreshTokens` (header `secret_key`), `fetchOaName`, `refreshZaloTokenIfNeeded` (refresh when < 3 h left) |
| 199k guard | `src/lib/agent-recovery.ts`: `assertRegistrationPolicyOutput` and every helper it calls (`normalizeReply`, `hasAffirmativeRegistrationSuccess`, `zaloGroupLinks`, `REGISTRATION_GROUP_URL`). Test cases are in `tests/agent-recovery-safety.test.ts` |

## Context in CRM (verified)

- `apps/crm/src/worker/env.ts`, `Env`. Add `ZALO_OA_APP_ID?`, `ZALO_OA_APP_SECRET?`, `ZALO_OA_WEBHOOK_SECRET?` and `ZALO_OA_TOKEN_KEY?`, each with a one-line doc comment like the FB ones.
- `apps/crm/src/worker/index.ts`: `app.route('/channels/facebook', facebookWebhookRoutes)` at about line 45 is mounted before session checks. Mount `/channels/zalo-oa` right next to it.
- `apps/crm/src/worker/inbox/worker-commands.ts`: dispatch by kind (`send_messenger` → `sendMessengerCommand`) at about line 29. Add `send_zalo_oa` → `sendZaloOaCommand`.
- `apps/crm/src/worker/inbox/conversation-flow.ts`:
  - `queueOutgoing`: target is `conv.channel === 'facebook' ? 'worker' : 'bridge'` and kind is `'send_messenger' : 'send_zalo'`, at about lines 210–216. Change both to a small helper that maps `zalo_oa` to `worker` / `send_zalo_oa`.
  - `scheduleCompletion` builds the `run_completion` payload.
  - `applyCompletionResult` applies the GoClaw reply.
  - `HANDOFF_MARKER` is defined there.
- `apps/crm/src/worker/inbox/dispatcher.ts` `accountSendsToday`: add `'send_zalo_oa'` to the counted kinds.
- `apps/crm/src/worker/inbox/scheduled.ts` `runScheduled`: the every-minute cron. Add the token refresh there, throttled to run at most every 10 minutes. Use `now.getUTCMinutes() % 10 === 0`, or a stored timestamp.
- Bridge routes, `apps/crm/src/worker/inbox/bridge-routes.ts`: the bridge must never be handed `zalo_oa` sends. They use `target='worker'`, so they are not claimable by the bridge. Add a test for that.

## Files you may modify

- New:
  - `apps/crm/src/worker/inbox/zalo-oa-webhook.ts`
  - `zalo-oa-send.ts`
  - `zalo-oa-oauth.ts`
  - `zalo-oa-registration-guard.ts`
  
  All in `apps/crm/src/worker/inbox/`.
- `apps/crm/src/worker/env.ts`, `index.ts`
- `apps/crm/src/worker/inbox/worker-commands.ts`, `conversation-flow.ts`, `dispatcher.ts`, `scheduled.ts`, `inbox-routes.ts` (OAuth start, policy toggle, list accounts with `zalo_oa`), `intake.ts` (channel labels only)
- New tests:
  - `apps/crm/test/inbox-zalo-oa.test.ts`
  - `apps/crm/test/zalo-oa-registration-guard.test.ts`

## Tasks

### Task 4.1: Token crypto and storage

- Target: `zalo-oa-oauth.ts`.
- Steps:
  1. Add `encryptToken` / `decryptToken` with AES-GCM via `crypto.subtle`. The key is base64 `ZALO_OA_TOKEN_KEY` (32 bytes). Store a random 12-byte IV followed by the ciphertext, base64.
  2. `saveCredential(db, env, accountId, tokens)` upserts `zalo_oa_credential` and sets `version = version + 1`.
  3. `accessToken(db, env, accountId)` returns the decrypted access token, or null when it is missing or expired.
- Verify: a unit test round-trips encrypt → decrypt; a wrong key throws. `pnpm -F @abm/crm test -- inbox-zalo-oa` exits 0.

### Task 4.2: OAuth start and callback

- Target: `zalo-oa-oauth.ts` routes, and `inbox-routes.ts` for the start.
- Steps:
  1. Add `POST /inbox/channel-accounts/zalo-oa/connect` (admin only, same gate as the existing channel account admin routes). It:
     - creates a PKCE verifier and a state;
     - stores `zalo_oa_oauth_state` with a 10-minute expiry;
     - returns `{ url }` for the Zalo permission page, with `redirect_uri = https://chatbot.abmedu.vn/api/zalo/oauth/callback`.
     
     Keep that literal in one constant, `ZALO_OA_REDIRECT_URI`. It must equal the URL registered in the Zalo app.
  2. Add `GET /channels/zalo-oa/oauth/callback?code&state` (public, mounted before sessions). Caddy rewrites `/api/zalo/oauth/callback` to this path. It:
     - consumes the state row with a single `DELETE ... RETURNING` (rejects expired or unknown states);
     - exchanges the code;
     - fetches the OA id and name;
     - upserts `channel_account (channel='zalo_oa', external_id=<oa id>, display_name=<OA name>, status='connected', agent_key='tu-van-oa')` in the organization of the user who started;
     - saves the credential;
     - redirects (302) to `${APP_URL}/channel-accounts?zalo_oa=connected`, or `=error`.
     
     Never put a token in the URL or a log.
- Verify: with `fetch` mocked, the test proves:
  - an unknown state gets 400 and writes nothing;
  - a valid state creates the account and credential, and a second use of the same state gets 400.

### Task 4.3: Token refresh

- Steps:
  1. `refreshZaloOaTokens(db, env, now)`: for each `zalo_oa` credential whose access token expires in under 3 hours, call refresh.
  2. Write the new token pair with `UPDATE ... WHERE channel_account_id = ? AND version = ?`, using the version read before the call. Zero changed rows means another run won; do nothing.
  3. On refresh failure, set `channel_account.status='error'` and `last_error` to a short code (`ZALO_OA_REFRESH_FAILED`). Notify Lark once per day per account, with dedupe key `zalo-oa-refresh:<account>:<yyyy-mm-dd>`. Reuse the existing Lark notification helper used by handoff.
  4. Call this from `runScheduled` for the every-minute cron, at most every 10 minutes.
- Verify: tests prove:
  - near expiry triggers exactly one refresh;
  - a stale version writes nothing;
  - a failure sets `status='error'`.

### Task 4.4: Webhook

- Target: `zalo-oa-webhook.ts`, route `POST /channels/zalo-oa/webhook`. Caddy rewrites `/webhooks/zalo` to it.
- Steps:
  1. Apply the same body limit as the Facebook webhook. Read the raw text and verify the signature as in the old source. Return:
     - 503 with `Webhook Zalo chưa được cấu hình` when `ZALO_OA_WEBHOOK_SECRET` is unset;
     - 400 when `app_id` or `timestamp` is missing;
     - 401 on a mismatch;
     - 200 otherwise, with the work run through `background()`.
  2. Resolve the account by `channel='zalo_oa' AND external_id = oa_id`. Fall back to `recipient.id` for user events and `sender.id` for `oa_send_*`. An unknown OA is logged as `zalo_oa_unknown_oa` and skipped.
  3. `user_send_text`, `user_send_image`, `user_send_sticker`, `user_send_file` and similar user events:
     - upsert the `direct` conversation keyed by the customer's Zalo user id;
     - insert a `message` (`in`, `customer`, `external_msg_id = message.msg_id`), using the attachment description as the body when there is no text;
     - set `attachments_json` to `[{type, url}]` for images;
     - then trigger the reply exactly as the Facebook webhook does (same function calls, same `mode`/bot checks).
     
     A duplicate `external_msg_id` is ignored.
     
     When the conversation is new, look up the customer's name with `GET https://openapi.zalo.me/v3.0/oa/user/detail?data={"user_id":"<id>"}` (header `access_token`), the same way as the old `src/lib/profile-enrichment.ts`. Wait at most 5 s and put the name in `conversation.display_name`. If the lookup fails (for example `-212`, the permission is not on), keep `Khách Zalo OA` and carry on.
  4. `oa_send_*`:
     - if `external_msg_id` matches a message we sent, do nothing;
     - otherwise insert `out` / `staff_phone` and switch the conversation to `human` the way the Zalo bridge path does for a staff phone message (see `ingest.ts`).
  5. `user_received_message` / `user_seen_message`: set `message.delivered_at` / `seen_at` for the listed message ids of that conversation.
- Verify: tests prove:
  - a correct signature gets 200 and a wrong one 401;
  - a text event creates one customer message and one `run_completion`, and replaying the same event creates none;
  - an echo of our own message changes nothing;
  - an unknown `oa_send_text` switches the conversation to `human`;
  - a seen event sets `seen_at`.

### Task 4.5: Send

- Target: `zalo-oa-send.ts` `sendZaloOaCommand(env, command)`. Mirror `sendMessengerCommand` for loading, idempotency and failure handling.
- Steps:
  1. Split the text into parts of at most 2000 characters. Split at the last newline or space before the limit.
  2. POST each part. Store the first returned `message_id` as the message's `external_msg_id`, and mark it `sent`.
  3. Error handling:
     - Zalo error codes that mean outside the care window or user blocked are final, not retried. Record them as `ZALO_OA_OUTSIDE_WINDOW` (map the codes the old app saw; when unknown, keep the raw code in `result_json`).
     - An expired token gets one refresh and one retry.
     - Other errors use the normal `failCommand` retry.
- Verify: tests prove a long text sends multiple parts, the outside-window error is final, and a 401/-216 refreshes once.

### Task 4.6: Images in the completion payload

- Steps: in `scheduleCompletion`, for `zalo_oa` add `images: string[]` to the `run_completion` payload. It holds at most 3 `https://*.zdn.vn` image URLs, from the triggering customer messages' `attachments_json`.
- Verify: a test proves an image message yields one `images` entry, and a non-zdn URL is dropped.

### Task 4.7: 199k guard

- Target: `zalo-oa-registration-guard.ts`. Port `assertRegistrationPolicyOutput` and its helpers verbatim; only the types adapt.
- Steps:
  1. Input `{ reply: string, handoff: boolean }`, where `handoff` means the GoClaw reply had a HANDOFF marker. `trustedInstructions` is `''`.
  2. Port the matching test cases from `tests/agent-recovery-safety.test.ts` into `apps/crm/test/zalo-oa-registration-guard.test.ts`.
  3. In `applyCompletionResult`, for a `zalo_oa` conversation, call the guard with `channel_account.registration_policy === 1` before queueing the send. If it throws:
     - do not send;
     - store a `system` / `failed` message `Chưa gửi (kiểm tra 199k): <error message>` with the blocked reply text;
     - hand off with that reason (Lark notice, conversation goes to `human`).
- Verify:
  - `pnpm -F @abm/crm test -- zalo-oa-registration-guard` exits 0 with every ported case.
  - In `inbox-zalo-oa.test.ts`, a reply confirming registration with the wrong group link creates no `send_zalo_oa` and moves the conversation to `human`.

### Task 4.8: Whole suite

- Verify: `pnpm -F @abm/crm typecheck` exits 0. `pnpm -F @abm/crm test` exits 0, with no previously passing test now failing.

## Failure Protocol

If any Verify step does not meet its stated pass condition, STOP this phase.
Do not improvise a fix, retry blindly, or reason around the failure.
Report to the supervisor (Opus) with:
- the phase and task id,
- what you attempted (the steps you ran),
- the exact command and its full output,
- the pass condition it failed to meet.
Never continue by self-reasoning. Write the report to `plans/reports/grok-261014-zalo-oa-worker.md` ending with `Status: DONE | DONE_WITH_CONCERNS | BLOCKED`.
