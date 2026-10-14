# Zalo OA Worker fixes (phase 4 review)

Date: 2026-10-14. Fixes the items the supervisor locked in `plans/reports/code-reviewer-261014-1226-zalo-oa-worker.md`. C3, M4, M5, M6 and the low items were not in this task and were not changed.

## What changed

### 1. Own replies are not staff messages

`oa_send_*` in `zalo-oa-webhook.ts` now follows the old app's order:

1. No conversation for that customer on this OA: ignore. An echo never creates a conversation, so a broadcast does not open a thread.
2. A message with that `external_msg_id` already exists: ignore.
3. An outbound `bot`, `staff_web`, or `system` message of this conversation, still `pending` or `sent`, created within 120 seconds, whose normalized text is the echo or contains it: our own send. Nothing new is stored and the mode is unchanged. Normalization drops `\r`, replaces each pair of spaces once, and trims, in JavaScript and in the SQL comparison. If that message has no `external_msg_id`, `markMessageSent` fills it in and does not overwrite one that is already set. It also marks the row `sent`, which is what closes the race where the echo arrives before the send response.
4. Otherwise, if the latest customer message arrived within 15 seconds and no outbound message was inserted after it: OA auto-reply. Stored as an outbound `system` message with status `sent`. `last_message_at` moves. `mode`, `last_staff_reply_at`, and the staff context do not.
5. Otherwise: the previous staff path (`staff_phone`, `mode = 'human'`).

`system` is the outbound kind that is neither staff nor the bot. The thread lists it (the inbox message query does not filter it out). The extractor transcript skips `sender_kind <> 'system'`, which is the same idea as the old app's `import` source: visible, and not one of the bot's own turns. A `bot` row would look like a reply we composed and would be quoted back to the agent as `Bot:`.

A short staff reply whose text sits inside a bot or system message from the last 120 seconds is treated as our own send. That is the contains rule as specified, including each part of a reply longer than 2000 characters.

### 2. OA intakes can become leads

`classifyIntake` maps channel `zalo_oa` to lead source `zalo`. Other channels are unchanged. `packages/contracts` was not edited. The OA user id is still stored as `zalo_uid`; that was M6 and was not part of this decision.

### 3. A losing token refresh is not an error

When `refreshZaloOaAccount` throws, it re-reads `zalo_oa_credential.version`. If that version is not the one this run started from, the result is `stale`: no `status = 'error'`, no `last_error`, no Lark notice. Callers already re-read the access token after `stale` and record a failure only for `failed`. A rejection that still sees the original version is a real error, as before.

### 4. A processing error is 503

After the signature check, the webhook awaits processing. A throw answers `503` with `Tạm thời không xử lý được`, and the error name is logged without the body. Zalo can send the batch again. The message insert is still `ON CONFLICT (conversation_id, external_msg_id) DO NOTHING`, so the second delivery stores one message. An invalid signature stays `401`. An unknown event name stays `200` and writes nothing.

### 5. A final Zalo send keeps the code and tells staff

The final codes are still `-213`, `-217`, `-227`, `-230`, and `-232`. The stored command error is `ZALO_OA_OUTSIDE_WINDOW:<code>`, for example `ZALO_OA_OUTSIDE_WINDOW:-213`. The same string is the body of a failed `system` note: `Quá thời hạn trả lời của Zalo OA (ZALO_OA_OUTSIDE_WINDOW:-230)`. That note matches the Facebook outside-window note: an outbound `system` row with status `failed`, written in the same batch as marking the reply failed. Retryable codes are unchanged.

## Files

- `apps/crm/src/worker/inbox/zalo-oa-webhook.ts`
- `apps/crm/src/worker/inbox/zalo-oa-send.ts`
- `apps/crm/src/worker/inbox/zalo-oa-oauth.ts`
- `apps/crm/src/worker/inbox/intake.ts`
- `apps/crm/test/inbox-zalo-oa.test.ts`

`apps/crm/src/web/`, `apps/zalo-bridge/`, `packages/`, and migrations were not edited. Nothing was committed, pushed, deployed, or run with `wrangler`. No dev server was started.

## Verify

Commands from `D:\TQD\CRM`.

- `pnpm -F @abm/crm test zalo-oa` — exit 0. **29 passed** (3 files). Duration 4.77s.
- `pnpm -F @abm/crm typecheck` — exit 0.
- `pnpm -F @abm/crm test` — exit 0. **508 passed, 2 skipped** (510). Files: 41 passed, 1 skipped (42). Duration 47.33s. The previous review run was 502 passed and 2 skipped. The six new tests are the two-part echo, the echo before the Zalo id is stored, the 3-second auto-reply, the staff reply five minutes later, the 503 plus one stored message on a resent event, and the OA lead. The unknown-customer case replaced the old test that expected an `oa_send_*` to create a conversation.

The new cases covered here: both parts of a split reply leave `mode = 'ai'` and add no row; an echo inside the mocked `/message/cs` fetch links `external_msg_id` before the response is returned; a welcome 3 seconds after the customer is `system` / `sent` and leaves `mode = 'ai'`; a staff reply 5 minutes later is `staff_phone` and `human`; an `oa_send_*` for an unknown customer writes nothing; a refresh Zalo rejects after `version` was bumped leaves the account `connected` with no Lark notice; a forced D1 throw on insert returns 503 and the same event twice stores one message; classifying an OA intake with form source `zalo_oa` creates a lead with source `zalo`; code `-230` is stored as `ZALO_OA_OUTSIDE_WINDOW:-230` with the system note.

Status: DONE
