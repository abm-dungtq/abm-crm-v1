# Phase 4 report: Worker Zalo OA channel

Phase: `plans/261014-0842-zalo-oa-into-crm/phase-04-worker-oa-channel.md`
Tasks: 4.1 through 4.8.

## What changed

The Worker now connects a Zalo Official Account, receives its webhook, replies through the OA Customer Service API, and blocks a registration confirmation that does not match the configured group link.

- OAuth v4 PKCE starts at `POST /api/inbox/channel-accounts/zalo-oa/connect` (admin). The public callback is `GET /api/channels/zalo-oa/oauth/callback`. `redirect_uri` is the constant `https://chatbot.abmedu.vn/api/zalo/oauth/callback`. The state row is consumed by one `DELETE ... RETURNING`. Tokens are stored with AES-GCM (12-byte IV, then ciphertext, base64). The key is base64 `ZALO_OA_TOKEN_KEY`, 32 bytes. A new OA account gets `agent_key = 'tu-van-oa'` and `bot_enabled = 1`. A reconnect keeps a non-null agent key and does not turn the bot back on.
- Access tokens refresh when they expire within 3 hours. The write matches the version read before the HTTP call. A stale version leaves the ciphertext as it is. A failure sets `status = 'error'` and `last_error = 'ZALO_OA_REFRESH_FAILED'`, and queues one Lark notice per account per Vietnam day. The every-minute cron runs this when `now.getUTCMinutes() % 10 === 0`, inside `step('zalo_oa_refresh')`, before worker commands.
- `POST /api/channels/zalo-oa/webhook` checks `SHA-256(app_id + raw body + timestamp + ZALO_OA_WEBHOOK_SECRET)` against `X-ZEvent-Signature`. Customer events enter the inbox the same way a Facebook message does. Attachments are stored as `{ url, name?, mimeType? }`. An image without a mime from Zalo is `image/jpeg`. `oa_send_*` that matches an outbound `external_msg_id` is an echo. Any other OA send is `staff_phone` and switches the conversation to `human`. Seen and delivered receipts set `seen_at` and `delivered_at`.
- Sends use `send_zalo_oa` with `target = 'worker'`. The bridge cannot claim them. Text is split at the last newline or space before 2000 characters. The access token is the `access_token` header. Codes -213, -217, -227, -230, and -232 are final (`ZALO_OA_OUTSIDE_WINDOW`). HTTP 401 or error -216 refreshes once and retries once. Other codes stay retryable (`ZALO_<code>`).
- A `zalo_oa` completion payload has `images` (at most 3 `https://*.zdn.vn` URLs whose mime starts with `image/`) and does not have `zaloUserId`. When the conversation has a real name, the first turn of a burst is prefixed with `[Hồ sơ Zalo của khách: tên "<display_name>"; giới tính: không rõ]`.
- `PUT /api/inbox/accounts/:id/registration-policy` (admin, OA only) sets `registration_policy` and `registration_group_url`. The URL must match `^https://zalo\.me/g/[A-Za-z0-9]+$` and is required while the policy is on. The guard reads that URL from the trusted line. A blocked reply is stored as a failed system message starting `Chưa gửi (kiểm tra 199k):` and the conversation is handed to a person.

`packages/contracts` was not edited. `CHANNEL_KINDS` and `COMMAND_KINDS` already contained `zalo_oa` and `send_zalo_oa`. Nothing was committed, pushed, deployed, or run with `wrangler`. No dev server was started. `apps/zalo-bridge/` and `apps/crm/src/web/` were not edited.

## Gender

The profile line always says `giới tính: không rõ`. `conversation` has no column for gender, and the only new column authorized on `channel_account` is `registration_group_url`. The user/detail field `user_gender` is not read and not stored.

## Guard port

`registrationGroupUrl`, `normalizeReply`, `hasAffirmativeRegistrationSuccess`, `zaloGroupLinks`, and `assertRegistrationPolicyOutput` come from the live VPS copy. The group link is data on the account, not a constant in the guard. `assertRecoveryReplySafe` and its tests were not ported. Indexed access is narrowed so the file typechecks under `noUncheckedIndexedAccess`; a real `matchAll` hit still takes the same regex path.

## Intake

Channel labels call `zalo_oa` "Zalo OA". Classifying an intake still sends `source: intake.channel`. `LEAD_SOURCES` has `facebook` and `zalo` only, so an OA intake is not a valid lead source. That mapping was left as it is.

## Verify

Commands from `D:\TQD\CRM`.

Before any phase 4 edit (full suite, already recorded):

- `pnpm -F @abm/crm test` — exit 0. **482 passed, 2 skipped** (484). Files: 39 passed, 1 skipped (40). Duration 44.26s. Start 11:50:49.

After the edits:

- `pnpm -F @abm/crm test zalo-oa` — exit 0. **23 passed** (23). Files: 3 passed. Duration 4.17s. Start 12:24:24. That is `zalo-oa-registration-guard` (1), `inbox-zalo-oa-schema` (3), and `inbox-zalo-oa` (19). The refresh-failure test logs the static line `zalo_oa_refresh_failed` and no token.
- `pnpm -F @abm/crm typecheck` — exit 0.
- `pnpm -F @abm/crm test` — exit 0. **502 passed, 2 skipped** (504). Files: 41 passed, 1 skipped (42). Duration 47.21s. Start 12:24:46.

The full suite gained 20 tests: 19 in `inbox-zalo-oa.test.ts` and 1 in `zalo-oa-registration-guard.test.ts`. The schema file was already in the before count. No previously passing test failed.

## Files changed

New:

- `apps/crm/src/worker/inbox/zalo-oa-oauth.ts`
- `apps/crm/src/worker/inbox/zalo-oa-webhook.ts`
- `apps/crm/src/worker/inbox/zalo-oa-send.ts`
- `apps/crm/src/worker/inbox/zalo-oa-registration-guard.ts`
- `apps/crm/test/inbox-zalo-oa.test.ts`
- `apps/crm/test/zalo-oa-registration-guard.test.ts`

Edited:

- `apps/crm/migrations/0020_zalo_oa.sql` — `registration_group_url TEXT` on the rebuilt `channel_account`. The backup insert does not list it, so existing rows get NULL.
- `apps/crm/test/inbox-zalo-oa-schema.test.ts`
- `apps/crm/test/helpers/reset-db.ts` — delete `zalo_oa_oauth_state` and `zalo_oa_credential` before `app_user` / `channel_account`.
- `apps/crm/src/worker/env.ts`
- `apps/crm/src/worker/index.ts`
- `apps/crm/src/worker/inbox/worker-commands.ts`
- `apps/crm/src/worker/inbox/conversation-flow.ts`
- `apps/crm/src/worker/inbox/dispatcher.ts`
- `apps/crm/src/worker/inbox/scheduled.ts`
- `apps/crm/src/worker/inbox/inbox-routes.ts`
- `apps/crm/src/worker/inbox/intake.ts`

`conversation-flow.ts`, `dispatcher.ts`, `inbox-routes.ts`, and `intake.ts` already had uncommitted group-bot edits. Those edits were left in place.

Status: DONE
