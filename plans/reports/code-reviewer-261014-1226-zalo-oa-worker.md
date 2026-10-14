# Code review: Zalo OA Worker channel (phase 4)

Date: 2026-10-14. Reviewer: code-reviewer (Opus). Review only; no source edits.

## Scope

- New: `apps/crm/src/worker/inbox/zalo-oa-oauth.ts`, `zalo-oa-webhook.ts`, `zalo-oa-send.ts`, `zalo-oa-registration-guard.ts`, `apps/crm/migrations/0020_zalo_oa.sql`, tests `inbox-zalo-oa.test.ts`, `zalo-oa-registration-guard.test.ts`, `inbox-zalo-oa-schema.test.ts`.
- Edited (OA parts only; the group-bot edits are out of scope): `env.ts`, `index.ts`, `worker-commands.ts`, `conversation-flow.ts`, `dispatcher.ts`, `scheduled.ts`, `inbox-routes.ts`, `intake.ts`, `test/helpers/reset-db.ts`.
- Compared against the old app: `webapp-chatbot-vps-src/src/routes/webhooks.ts`, `src/lib/staff-echo.ts`, `src/lib/agent-recovery.ts`.
- Checks run here: `pnpm -F @abm/crm typecheck` exit 0. `pnpm -F @abm/crm test`: 502 passed, 2 skipped (41 files passed, 1 skipped). This matches the implementer's report.

## Verdict

Not ready for cutover. Four issues must be fixed first. The worst is echo handling: under realistic timing, the bot's own replies are classified as staff messages and the conversation flips to `human`. That breaks acceptance criterion 3, and criterion 1 for any OA with an auto-reply. Crypto, OAuth state handling, the signature check, the guard port and the migration are sound.

---

## Must fix before cutover

### C1. Our own OA sends are read as staff replies, so the conversation flips to `human` (Critical)

Where:
- `zalo-oa-webhook.ts:130-137` (`matchOaEcho`) matches an echo **only** by `message.external_msg_id = msg_id`.
- `zalo-oa-send.ts:143-168`: only `firstMid` is ever stored, and it is written by `markMessageSent` **after the whole loop** (line 168).
- A non-matching `oa_send_*` then goes through `ingest.ts:181-188`, which inserts a `staff_phone` row, sets `mode='human'` and appends staff context.

Failure scenarios:
1. **Multi-part reply (deterministic).** A bot reply longer than 2000 characters is posted as parts 1 and 2. The `msg_id` of part 2 is never stored anywhere, so its `oa_send_text` echo never matches. A duplicate `staff_phone` row is created and the conversation becomes `human`. Every long answer kills the bot for that customer.
2. **Echo before persistence (race).** Zalo emits `oa_send_text` when the message is created. The webhook travels Zalo → Caddy → Worker in parallel with our `fetch` response, `recordProgress` and `markMessageSent`. If the webhook's `SELECT` runs before `markMessageSent` (for part 1 of a multi-part reply, before *all* parts finish), the echo is unmatched. Result: duplicate message plus `human` mode.
3. **OA auto-reply / welcome message.** An auto-reply configured in the OA admin is echoed as `oa_send_text` seconds after the customer's first message. It is classified as staff, so the conversation goes `human` before the 8-second completion runs. `applyCompletionResult` then cancels the bot's reply. The old app handled this explicitly (`staff-echo.ts:14-19`, `AUTO_REPLY_WINDOW`). The port dropped it.
4. Staff sends from the CRM web (`staff_web` → `send_zalo_oa`) hit the same race. The mode is already `human`, but each such send leaves a duplicate `staff_phone` row in the thread.

Facebook does not have this problem because `matchMessengerEcho` also matches on `metadata = message.id`, which is carried by every part and arrives even before the send response (`facebook-webhook.ts:60-72`). Zalo CS has no metadata field, which is why the old app matched by text within 120 s (`staff-echo.ts:53-97`).

The existing test (`inbox-zalo-oa.test.ts:406`) only sends the echo *after* `processWorkerCommands` has finished for a single-part message, so it cannot catch any of these cases.

Fix:
- In `matchOaEcho`, after the id match, fall back to a text match. Look for an `out` message of this conversation with `status IN ('pending','sent')`, `created_at` within 120 s, whose body contains the echo text. Reuse the whole-line `instr` approach from `ingest.ts:75-86` (`applyEcho`), extended to accept a part boundary at a space, since `splitZaloOaText` can cut at a space. Simplest: `instr(body, ?) > 0` with a minimum needle length, for example 20 characters, or an exact match for shorter texts.
- Mark the matched message sent without overwriting `external_msg_id` when it is already set.
- Port the auto-reply rule: an unmatched `oa_send_*` within 15 s of a customer message, with no `out` message after it, is stored but does **not** switch the mode. Alternatively, decide explicitly that OA auto-replies must be turned off at cutover and record that in phase 9.
- Add tests: (a) a two-part reply whose two echoes both leave `mode='ai'` and create no new rows; (b) an echo delivered while the send command is still `claimed`, before `markMessageSent` (simulate by calling the webhook from inside the mocked `/message/cs` fetch); (c) an auto-reply within 15 s.

### C2. An OA intake can never be classified into a lead (High, blocks a core workflow)

Where: `intake.ts:284` passes `source: intake.channel`, which is `'zalo_oa'`. `createLeadInput.source` and `createLearnerLeadInput.source` are `z.enum(LEAD_SOURCE_CODES)` (`packages/contracts/src/index.ts:273`, `:373`). `LEAD_SOURCES` (`:142-151`) has no `zalo_oa`.

Failure: every "Tạo lead" on an OA intake returns `VALIDATION_FAILED`, and the intake stays `pending` forever. Linking to an existing contact (`linkStatements`) still works, but it stores the OA-scoped user id as `contact_point.type='zalo_uid'` (`intake.ts:254`). That is a different id space from personal-Zalo uids.

The implementer's report notes this and leaves it "as it is". That is not acceptable for a channel going live, because staff will hit the error on the first OA lead.

Fix (needs a product decision; see the questions below):
- either map `zalo_oa` → `zalo` in `classifyIntake` (`source: intake.channel === 'zalo_oa' ? 'zalo' : intake.channel`);
- or add `{ code: 'zalo_oa', label: 'Zalo OA' }` to `LEAD_SOURCES`. Check first whether `lead.source` has a DB `CHECK` and whether reports group by source.

Add a test that classifies an OA intake end to end.

### C3. The phase-9 Caddy rewrites point to paths that do not exist (High, cutover blocker)

Where: the Worker app is `new Hono().basePath('/api')` (`index.ts:33`), so the routes are `/api/channels/zalo-oa/webhook` and `/api/channels/zalo-oa/oauth/callback`. The implementer's report states these paths correctly. But `phase-09-cutover.md:25` and `:39`, and `plan.md:15-16`, rewrite to `/channels/zalo-oa/...` without `/api`.

Failure: the OAuth callback and every webhook return 404 from the Worker. The OA connect fails, and after the webhook switch no OA messages arrive at all. Zalo may also disable a webhook that keeps failing.

Fix: in phase 9 use `rewrite * /api/channels/zalo-oa/oauth/callback?{query}` and `rewrite * /api/channels/zalo-oa/webhook`, and correct `plan.md`. Before switching the webhook, verify with a `curl` POST through Caddy that a body with a wrong signature gets **401**, not 404.

### C4. Concurrent refreshes cause a false `error` status and a Lark alarm (High)

Where:
- `zalo-oa-oauth.ts:277-300` (`refreshZaloOaAccount`) and `:320-329`;
- the send path, `zalo-oa-send.ts:134-141` and `:146-152`.

Zalo refresh tokens are single-use (plan decision). Two refreshers can run at the same time: the cron step, and `processWorkerCommands` started from bridge results or staff sends in another isolate, each handling a different `send_zalo_oa` for the same OA after a -216. In that case one succeeds and the other is **rejected by Zalo**, because the refresh token was already used. The loser returns `'failed'` (catch at `:296`), and `recordZaloOaRefreshFailure` sets `status='error'`, `last_error='ZALO_OA_REFRESH_FAILED'` and queues a Lark notice. The losing send also fails with `ZALO_OA_REFRESH_FAILED`, which costs a retry.

The `version` CAS only covers the case where *both* Zalo calls succeed. It does not cover this one. The `error` status persists until the next successful refresh, roughly 22 hours later, because the cleanup at `:293-294` only runs on success.

Fix: on any failure, re-read `version`. If it differs from the version read before the call, return `'stale'` (another run rotated the pair) and do not record a failure. In the send path, after `'stale'`, just re-read `accessToken`. Add a test where Zalo rejects the second refresh after the version was bumped.

---

## Should fix (before or shortly after cutover)

### M1. Webhook processing errors are swallowed after a 200, so messages are lost (Medium)

`zalo-oa-webhook.ts:238-240` and `:265-266`: the route always answers 200 and processes in `background()`. A transient D1 error drops a customer message for good, because Zalo does not redeliver after a 200. The old app returned `503 RETRY` on failure (`webhooks.ts:207-216`). Facebook uses the same fire-and-forget design, so this follows local convention. But OA is the main sales channel.

Option: process inline, since the work is small, and return 503 when any event throws. Replays are idempotent by `msg_id`.

### M2. Final-error code list is unverified (Medium)

`zalo-oa-send.ts:17`: the codes `-213, -217, -227, -230, -232` do not appear anywhere in the old source. They were chosen by the implementer, and I could not confirm them from a public Zalo error table. A wrong entry permanently fails a reply that would succeed on retry. A missing one just retries.

The plan also asked to "keep the raw code in `result_json`". The final path stores only `ZALO_OA_OUTSIDE_WINDOW` (`:93`, `:159`), so the evidence is lost. Unlike Facebook (`facebook-send.ts:115-124`), no system note tells staff why the reply did not go out.

Fix: store `{ error: 'ZALO_OA_OUTSIDE_WINDOW', code }`, insert the same kind of system note as Facebook, and verify the codes against developers.zalo.me before relying on them.

### M3. `oa_send_*` creates conversations, and flips them to `human`, for threads the customer never started (Medium)

`zalo-oa-webhook.ts:221-225` → `ingest.ts:165` upserts the conversation for any OA send. Broadcasts or sends from other OA tools create one `human` conversation per recipient in the inbox. The old app's rule was "an echo never creates a conversation" (`staff-echo.ts:43-47`).

Fix: in `handleOaSend`, skip when no conversation exists for `(account, recipient)`.

### M4. The guard blocks every affirmative registration reply while the policy is on (Medium, product)

`conversation-flow.ts:525-539` passes only the single line `Link nhóm Zalo chính xác: <url>` as trusted instructions. So `configuredGroups` holds just that URL, and `hasConfiguredAlternateGroup` (`zalo-oa-registration-guard.ts:79-80`) is always false. With the policy on, any reply containing an affirmative "đăng ký … thành công" for *another* course is blocked and handed off (see test line 62-63). This fails closed, so it is safe, but it may produce handoff noise if the OA sells other programs. Please confirm this is intended.

A related cutover note: `phase-09-cutover.md:33` says to "set `registration_policy = 1`". This must be done through `PUT /api/inbox/accounts/:id/registration-policy` with the group URL. If the column is set by SQL without `registration_group_url`, every confirmation is blocked.

### M5. The migration rehearsal is stale (Medium, process)

`plan.md:33` records the remote-copy rehearsal of 0020. Phase 4 then edited 0020 to add `registration_group_url` (`0020_zalo_oa.sql:36-37`). Re-run Task 3.4 on the final file.

Also confirm whether 0019 (untracked) is already applied on the eval D1. `phase-09-cutover.md:18` says "applies only 0020". If 0019 is not applied, it will run too, and 0020 depends on `zalo_staff_member` from 0019.

### M6. The OA user id is stored as `zalo_uid` (Medium)

`intake.ts:254`: OA user ids are OA-scoped and are not personal Zalo uids. Storing them under the same type pollutes contact data. Consider a new `contact_point` type (needs a migration on its CHECK) or skip the contact point for `zalo_oa`. Decide this together with C2.

---

## Low / nice to have

- L1. `zalo-oa-oauth.ts:226-240`: the browser gets raw JSON 400 for a missing or expired state. Redirect to `?zalo_oa=error` like the other failures.
- L2. `zalo_oa_oauth_state` rows are never pruned (`beginZaloOaConnect` inserts; only a successful callback deletes). Add a delete of expired rows in the 10-minute refresh step.
- L3. `refreshZaloOaTokens` retries a dead refresh token every 10 minutes for ever, rewriting `status='error'` each time. Lark is deduped per day. Consider skipping when `refresh_expires_at < now`.
- L4. Receipts (`recordReceipt`) only match `firstMid`, so `seen_at` / `delivered_at` for parts 2..n are dropped. This becomes harmless once C1 stores per-part ids, for example in a JSON column or an extra lookup.
- L5. The webhook has no timestamp freshness window. Replays are idempotent (`msg_id` unique, receipts use `COALESCE`), so the risk is low. The old app had none either.
- L6. A crash between a successful Zalo POST and `recordProgress` re-sends that part on lease re-run. This is the same at-least-once semantics as Facebook, so it is acceptable.

---

## Checked and fine

- **Signature** (`zalo-oa-webhook.ts:247-264`): `SHA-256(app_id + raw body + timestamp + secret)` over the raw text, matching the old formula. It strips `mac=`, compares with constant-time XOR (the length check leaks only the length), returns 503 when the secret is unset, 400 without `app_id`/`timestamp`, and 401 on a mismatch. The route is mounted before `originGuard` and sessions, like Facebook.
- **OAuth**:
  - the state is 128-bit random, single-use via `DELETE … WHERE expires_at > now RETURNING`;
  - PKCE S256 with a 43-character verifier;
  - the org-scoped upsert (`ON CONFLICT … WHERE organization_id = excluded.organization_id`) prevents taking over another org's OA;
  - a reconnect does not re-enable a disabled bot.
- **Tokens**: AES-256-GCM with a random 12-byte IV and a 32-byte key length check. Tokens travel only in headers. Logs carry static codes only. `result_json` contains no token (tests assert this).
- **199k guard**: a verbatim port of the live `assertRegistrationPolicyOutput` and its helpers. The only change is safe `noUncheckedIndexedAccess` narrowing. The group URL comes from `channel_account.registration_group_url`. A blocked reply is never queued: the code inserts a `system`/`failed` note and calls `handoff` (sets `human`, sends a Lark notice). No resend route exists that could push the blocked text out later.
- **Send**: target `worker`, so the bridge cannot claim it (tested). Progress and lease handling mirror Facebook. 401/-216 refreshes once. `bot_blocked` and `send_paused` are honored.
- **Migration 0020**:
  - copy, drop, recreate under the same name (not rename), with `defer_foreign_keys`;
  - `zalo_staff_member` (the only `ON DELETE CASCADE` child of `channel_account`) is parked and restored after the account rows are back;
  - `conversation` and `channel_command` FKs carry no cascade, so the deferred check passes;
  - every 0012 and 0017 column is copied, and the `channel_command_due` index is recreated;
  - no other table references `channel_command`.
- **Existing channels**:
  - `outgoingRoute` keeps `facebook→send_messenger/worker` and `zalo→send_zalo/bridge`;
  - `zaloUserId` is still added only for personal Zalo direct threads;
  - `queueSessionCommand` rejects non-`zalo` accounts, so an OA account never gets `zalo_login`;
  - creating `zalo_oa` by hand is refused;
  - the FB and Zalo suites pass unchanged.

## Plan task status (phase 4)

| Task | Status |
| --- | --- |
| 4.1 crypto/storage | done |
| 4.2 OAuth | done (L1 and L2 are polish) |
| 4.3 refresh | done, with defect C4 |
| 4.4 webhook | **incomplete**: echo handling (C1) and conversation creation (M3) |
| 4.5 send | done; raw code and system note missing (M2) |
| 4.6 images | done |
| 4.7 guard | done (product question M4) |
| 4.8 suite | green |

Outside phase 4: C2 (intake/lead source), C3 (phase 9 Caddy paths), M5 (re-rehearse the migration).

## Unresolved questions

1. Lead source for OA: map to `zalo`, or add a new `zalo_oa` source? Which `contact_point` type should OA user ids use?
2. Does the ABM OA have an auto-reply or welcome message enabled? If yes, C1's auto-reply rule is mandatory; otherwise turning it off at cutover is an alternative.
3. Should the guard tolerate confirmations for other programs (M4), or is fail-closed with handoff the intended behaviour?
4. Is 0019 already applied on the eval D1?

Status: DONE_WITH_CONCERNS
Summary: Crypto, OAuth, the signature check, the guard port and the migration are sound, and the suite is green (502 passed). The channel is not cutover-ready. Bot replies get misread as staff messages, so conversations flip to `human` (C1). OA intakes can't become leads (C2). The phase-9 Caddy rewrites miss `/api` (C3). Concurrent token refreshes falsely mark the OA as `error` (C4).
